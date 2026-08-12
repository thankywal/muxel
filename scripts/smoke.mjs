#!/usr/bin/env node
/**
 * Deploys Muxel for real and proves a new user's first minutes work.
 *
 * Unit tests never caught the failures that reached people, because every one
 * of them lived in the seam this script exercises: the wrangler config, the
 * bindings, the first request, the setup path. Three times a change that
 * passed every test broke the next person who pressed the deploy button. The
 * only test that stands between that person and the code is an actual deploy,
 * so that is what runs.
 *
 * It provisions scratch resources under unique names in a throwaway Cloudflare
 * account, deploys the Worker against them, drives the same requests a new
 * deployment sees, and tears everything down. It costs nothing: every resource
 * is inside the free tier and is deleted before the script exits.
 *
 * Required: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID.
 * Optional: SMOKE_BOT_TOKEN, SMOKE_OWNER_ID to also prove /setup end to end.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) {
  console.log("smoke: CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID not set, skipping.");
  process.exit(0);
}

const STAMP = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const NAME = `muxel-smoke-${STAMP}`;

function wrangler(args, opts = {}) {
  const result = spawnSync("npx", ["--yes", "wrangler", ...args], {
    encoding: "utf8",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" },
    input: opts.input,
    timeout: 180_000,
  });
  return { code: result.status ?? 1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

async function api(method, path, body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return response.json().catch(() => ({}));
}

const failures = [];
function check(label, ok, detail = "") {
  console.log(`${ok ? "  ok " : "  FAIL"} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) {
    failures.push(label);
  }
}

// Provision -------------------------------------------------------------------

console.log(`smoke: provisioning as ${NAME}`);

const d1 = await api("POST", "d1/database", { name: NAME });
const d1Id = d1?.result?.uuid;
check("create D1", typeof d1Id === "string", d1Id ?? JSON.stringify(d1.errors ?? ""));

const kv = await api("POST", "storage/kv/namespaces", { title: NAME });
const kvId = kv?.result?.id;
check("create KV", typeof kvId === "string", kvId ?? JSON.stringify(kv.errors ?? ""));

const vec = await api("POST", "vectorize/v2/indexes", {
  name: NAME,
  config: { dimensions: 1024, metric: "cosine" },
});
check("create Vectorize", vec?.success === true, JSON.stringify(vec?.errors ?? "").slice(0, 120));

// Teardown runs whatever happens after this point.
async function teardown() {
  console.log("smoke: tearing down");
  await api("DELETE", `workers/scripts/${NAME}?force=true`);
  if (d1Id) {
    await api("DELETE", `d1/database/${d1Id}`);
  }
  if (kvId) {
    await api("DELETE", `storage/kv/namespaces/${kvId}`);
  }
  await api("DELETE", `vectorize/v2/indexes/${NAME}`);
}

if (failures.length > 0) {
  await teardown();
  // An expired credential and a broken Worker both arrive here as a red build,
  // and they need opposite responses: one is fixed by replacing a secret, the
  // other by fixing the code. Saying which has already cost two investigations,
  // so the difference is stated rather than left to be rediscovered.
  const authenticationFailed = [d1, kv, vec].some((response) =>
    (response?.errors ?? []).some((error) => error?.code === 10000),
  );
  if (authenticationFailed) {
    console.error(
      [
        "",
        "smoke: Cloudflare rejected the credential, so nothing was tested.",
        "",
        "This is not a fault in the code under test. CLOUDFLARE_API_TOKEN has",
        "expired or been revoked. Replace it with a token from the Cloudflare",
        "account that exists for this purpose, not one borrowed from a user's",
        "account, and rerun. Until then main cannot advance, which is the",
        "intended behaviour: an untested commit must not become a release.",
      ].join("\n"),
    );
    process.exit(1);
  }
  console.error("smoke: could not provision, failing.");
  process.exit(1);
}

// Deploy ----------------------------------------------------------------------

const scratch = mkdtempSync(join(tmpdir(), "muxel-smoke-"));
const config = {
  name: NAME,
  // Absolute, because wrangler resolves the entry point relative to the
  // config file, and the config lives in a scratch directory.
  main: resolve("packages/runtime/src/index.ts"),
  compatibility_date: "2026-05-01",
  triggers: { crons: ["*/15 * * * *"] },
  observability: { enabled: true },
  d1_databases: [{ binding: "DB", database_name: NAME, database_id: d1Id }],
  kv_namespaces: [{ binding: "STATE", id: kvId }],
  vectorize: [{ binding: "KNOWLEDGE", index_name: NAME }],
  ai: { binding: "AI" },
  vars: {
    MUXEL_ENV: "smoke",
    EMBEDDING_MODEL: "@cf/baai/bge-m3",
    DEFAULT_MODEL: "workers-ai/@cf/google/gemma-4-26b-a4b-it",
    AI_GATEWAY_ID: "muxel",
    BUSINESS_LOCALE: "en",
  },
};
const configPath = join(scratch, "wrangler.json");
writeFileSync(configPath, JSON.stringify(config));

const deploy = wrangler(["deploy", "--config", configPath]);
check("wrangler deploy", deploy.code === 0, deploy.out.split("\n").find((l) => l.includes("Error")) ?? "");
const url = deploy.out.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0];
check("deployment has an address", typeof url === "string", url ?? "");

if (failures.length > 0) {
  await teardown();
  rmSync(scratch, { recursive: true, force: true });
  process.exit(1);
}

// Exercise the first minutes -------------------------------------------------

async function get(path) {
  try {
    const response = await fetch(`${url}${path}`, { signal: AbortSignal.timeout(20_000) });
    return { status: response.status, body: await response.text() };
  } catch (error) {
    return { status: 0, body: String(error) };
  }
}

/**
 * Polls until the answer settles or time runs out, and judges only the final
 * state. A brand new workers.dev address flaps while it propagates, answering
 * 404 from one edge and a generic 500 page from another, sometimes after a
 * first success. A worker that genuinely crashes still crashes at the
 * deadline, so nothing real is masked by waiting; a flap that resolves was
 * never a failure to begin with.
 */
async function until(path, predicate, deadlineMs = 150_000) {
  const deadline = Date.now() + deadlineMs;
  let last = { status: 0, body: "" };
  for (;;) {
    last = await get(path);
    if (predicate(last) || Date.now() > deadline) {
      return last;
    }
    await new Promise((resolvePoll) => setTimeout(resolvePoll, 5000));
  }
}

const botToken = process.env.SMOKE_BOT_TOKEN;
const ownerId = process.env.SMOKE_OWNER_ID;

if (botToken && ownerId) {
  // With credentials the deployment must become fully ready, exactly as a new
  // user's does.
  wrangler(["secret", "put", "ADMIN_BOT_TOKEN", "--config", configPath], { input: botToken });
  wrangler(["secret", "put", "OWNER_TELEGRAM_ID", "--config", configPath], { input: ownerId });
  const setup = await until("/setup", (r) => r.status === 200 && r.body.includes("console is connected"));
  check("setup completes", setup.status === 200 && setup.body.includes("console is connected"),
    `status ${setup.status}`);
  const ready = await until("/health", (r) => r.body.includes('"ready"'), 60_000);
  check("health reports ready", ready.body.includes('"ready"'), ready.body.slice(0, 100));
} else {
  // Without credentials the deployment must say precisely what is missing,
  // which proves the Worker boots, the bundle runs, and the bindings resolve.
  const health = await until(
    "/health",
    (r) => r.status === 503 && r.body.includes("ADMIN_BOT_TOKEN"),
  );
  check(
    "health names the missing settings",
    health.status === 503 && health.body.includes("ADMIN_BOT_TOKEN"),
    `status ${health.status}: ${health.body.slice(0, 120).replace(/\n/g, " ")}`,
  );
  const setup = await until(
    "/setup",
    (r) => r.status === 503 && r.body.includes("Missing"),
    60_000,
  );
  check(
    "setup explains instead of crashing",
    setup.status === 503 && setup.body.includes("Missing"),
    `status ${setup.status}: ${setup.body.slice(0, 80).replace(/\n/g, " ")}`,
  );
}

// A webhook probe must 404 without leaking whether the path exists. By now the
// address is serving, so this 404 is the Worker's own.
const probe = await get("/tg/not-a-real-path");
check("webhook path stays closed", probe.status === 404, `status ${probe.status}`);

// The website channel is public, so an unknown key must be indistinguishable
// from a disabled one and neither may reach the assistant.
const unknown = await get("/w/nosuchkey1234/widget.js");
check("unknown web key is closed", unknown.status === 404, `status ${unknown.status}`);

await teardown();
rmSync(scratch, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`smoke: FAILED ${failures.length} check(s): ${failures.join(", ")}`);
  process.exit(1);
}
console.log("smoke: a real deployment came up, answered correctly, and was removed.");
