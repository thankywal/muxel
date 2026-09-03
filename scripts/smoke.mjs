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
 * Setup is proved end to end on every run. A console key is a string the owner
 * makes up, so this script can make one up too, and the door the deploy form
 * asks for is the one a real deployment gets tested through. SMOKE_BOT_TOKEN
 * and SMOKE_OWNER_ID add the other door, which needs an account this script
 * cannot invent.
 *
 * Required: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID.
 * Optional: SMOKE_BOT_TOKEN, SMOKE_OWNER_ID to also prove the Telegram console.
 */

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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

/** Sends a JSON body to a path, the way the console signs in. */
async function post(path, body) {
  try {
    const response = await fetch(`${url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
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
async function until(path, predicate, deadlineMs = 150_000, send = get) {
  const deadline = Date.now() + deadlineMs;
  let last = { status: 0, body: "" };
  for (;;) {
    last = await send(path);
    if (predicate(last) || Date.now() > deadline) {
      return last;
    }
    await new Promise((resolvePoll) => setTimeout(resolvePoll, 5000));
  }
}

/**
 * The deployment's own record of where it has got to.
 *
 * /health publishes it as JSON: a status, and the names of the settings still
 * wanted. The checks below used to wait for the page to contain the string
 * ADMIN_BOT_TOKEN, so the day a console key became the first thing a
 * deployment asks for, a correct deployment failed the smoke and the script
 * that exists to catch mistakes was reporting one of its own. A record
 * survives its wording; a sentence does not.
 */
function record(body) {
  try {
    const parsed = JSON.parse(body);
    return parsed !== null && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** The setting names a record carries, or null when it carries no such list. */
function missingIn(body) {
  const missing = record(body)?.missing;
  return Array.isArray(missing) && missing.every((name) => typeof name === "string" && name !== "")
    ? missing
    : null;
}

// The page a person actually opens is the first thing that happens, because
// opening it is what runs setup: the Worker cannot learn its own address any
// other way. It has to carry the key too, being the only place its owner can
// learn it.
const firstScreen = await until("/setup", (r) => r.status === 200, 60_000);
const issued = /<p class="key"><code>([A-Za-z0-9_-]+)<\/code><\/p>/.exec(firstScreen.body)?.[1];
check(
  "the first screen is a finished setup",
  firstScreen.status === 200,
  `status ${firstScreen.status}: ${firstScreen.body.slice(0, 80).replace(/\n/g, " ")}`,
);
check(
  "it hands over a console key long enough to be one",
  typeof issued === "string" && issued.length >= 16,
  issued === undefined ? "no key on the page" : `${issued.length} characters`,
);

// And the record agrees with the page.
//
// /health reports what has already happened rather than causing it, so this
// comes second: opening the address above is what ran setup. What it used to
// report first was the opposite — a 503 naming the secret its owner still had
// to invent — and that state no longer exists for a deployment given nothing.
const ready = await until("/health", (r) => record(r.body)?.status === "ready", 150_000);
check(
  "a deployment given nothing is ready",
  ready.status === 200 &&
    record(ready.body)?.status === "ready" &&
    (missingIn(ready.body) ?? []).length === 0,
  `status ${ready.status}: ${ready.body.slice(0, 120).replace(/\n/g, " ")}`,
);

// The whole of what a new owner does: take the key off that page and sign in.
const claimed = await post("/admin/claim", { key: issued ?? "" });
check(
  "the key on the page signs the owner in",
  claimed.status === 200 && typeof record(claimed.body)?.token === "string",
  `status ${claimed.status}: ${claimed.body.slice(0, 120)}`,
);

// And once somebody has, the public page stops printing it.
const afterClaim = await until("/setup", (r) => r.status === 200 && !r.body.includes('class="key"'));
check(
  "the page stops printing the key once it has been used",
  issued !== undefined && !afterClaim.body.includes(issued),
  afterClaim.body.includes('class="key"') ? "still printed" : "",
);

// Choosing your own key is the override, and the one recovery path there is.
// Setting it has to end the session the issued key opened, or a leaked key
// could not be taken back.
const consoleKey = randomUUID();
wrangler(["secret", "put", "CONSOLE_KEY", "--config", configPath], { input: `${consoleKey}\n` });

// Polled: putting a secret redeploys the Worker, and the old code answers
// until the new one takes over.
const chosen = await until("/admin/claim", (r) => r.status === 200, 60_000, (path) =>
  post(path, { key: consoleKey }),
);
check(
  "a key the owner chose replaces the one that was issued",
  chosen.status === 200,
  `status ${chosen.status}: ${chosen.body.slice(0, 120)}`,
);
const displaced = await post("/admin/claim", { key: issued ?? "" });
check(
  "and the issued key stops working",
  displaced.status === 401,
  `status ${displaced.status}`,
);

// Telegram is the other door, and it is optional, so it is proved only when
// this run was handed a bot to prove it with: no string this script invents
// can stand in for an account BotFather has to issue.
const botToken = process.env.SMOKE_BOT_TOKEN;
const ownerId = process.env.SMOKE_OWNER_ID;

if (botToken && ownerId) {
  wrangler(["secret", "put", "ADMIN_BOT_TOKEN", "--config", configPath], { input: `${botToken}\n` });
  wrangler(["secret", "put", "OWNER_TELEGRAM_ID", "--config", configPath], { input: `${ownerId}\n` });
  // The bot's username is a field of the page, not a phrase in it: the setup
  // page prints it into the definition list whatever else the page says.
  const connected = (body) => /<dd>@[A-Za-z0-9_]+<\/dd>/.test(body);
  const telegram = await until("/setup", (r) => r.status === 200 && connected(r.body));
  check(
    "the Telegram console connects too",
    telegram.status === 200 && connected(telegram.body),
    `status ${telegram.status}`,
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
