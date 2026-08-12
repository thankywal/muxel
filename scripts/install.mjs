#!/usr/bin/env node
/**
 * Installs Muxel into a Cloudflare account directly, without GitHub.
 *
 * The one click deploy hands the work to Cloudflare's source importer, which
 * copies this repository into the operator's own GitHub account and lets
 * Workers Builds build it. When that import fails it fails quietly: the
 * dashboard reports success, the new repository holds nothing but a parsed
 * wrangler.jsonc, no build is ever queued, and what stays deployed is
 * Cloudflare's own placeholder Worker answering "Hello world". Nothing of ours
 * runs, so nothing of ours can notice or report it.
 *
 * That leaves the operator with no way forward from inside the product. This
 * script is that way forward. It provisions the same resources under the same
 * names and deploys this working copy against them, so a deployment can always
 * be completed or repaired regardless of what GitHub and the importer did.
 *
 * It is safe to run against a half finished account, which is the state a
 * failed import leaves behind. Every resource is adopted if it already exists
 * and created only if it does not, and the Worker is overwritten in place, so
 * running it twice is the same as running it once.
 *
 * Required: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID.
 * Optional: ADMIN_BOT_TOKEN, OWNER_TELEGRAM_ID to finish setup in one pass.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { installConfig } from "./installConfig.mjs";

const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;

if (!token || !account) {
  console.error(
    [
      "install: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are both required.",
      "",
      "Create a token at dash.cloudflare.com/profile/api-tokens with the",
      "Edit Cloudflare Workers template, then add D1, Vectorize and Workers AI",
      "edit permissions to it. The account id is on the right of any account",
      "page in the dashboard.",
      "",
      "  CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node scripts/install.mjs",
    ].join("\n"),
  );
  process.exit(2);
}

const WORKER = "muxel";
const D1_NAME = "muxel";
const KV_NAME = "muxel";
const VECTORIZE_NAME = "muxel-knowledge";

async function api(method, path, body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return response.json().catch(() => ({}));
}

function fail(what, payload) {
  const detail = JSON.stringify(payload?.errors ?? payload ?? "").slice(0, 300);
  console.error(`install: could not ${what}. Cloudflare said: ${detail}`);
  process.exit(1);
}

/**
 * Finds a resource by name so a rerun adopts what is already there.
 *
 * Each of these listings names the resource under a different key, and the
 * identifier the bindings need is a different key again, so the caller states
 * both rather than the shapes being guessed at.
 */
async function adoptOrCreate(label, listPath, createPath, createBody, nameKey, idKey) {
  const listed = await api("GET", listPath);
  const existing = (listed?.result ?? []).find((row) => row[nameKey] === createBody[nameKey]);
  if (existing) {
    console.log(`  reusing ${label} ${createBody[nameKey]}`);
    return existing[idKey];
  }
  const created = await api("POST", createPath, createBody);
  if (created?.success !== true) {
    fail(`create ${label}`, created);
  }
  console.log(`  created ${label} ${createBody[nameKey]}`);
  return created.result?.[idKey];
}

function wrangler(args, opts = {}) {
  const result = spawnSync("npx", ["--yes", "wrangler", ...args], {
    encoding: "utf8",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" },
    input: opts.input,
    timeout: 300_000,
  });
  return { code: result.status ?? 1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

// Read the configuration first ------------------------------------------------

// The shipped configuration is the source of the compatibility date, flags,
// cron and vars, so a hand install and a button install run the same Worker.
// Only the identifiers, which are placeholder zeros in the file, are replaced,
// and that happens once the resources below exist.
//
// It is read before anything is provisioned. A configuration this cannot parse
// is a fault in the checkout, and finding that out after creating a database
// leaves debris in someone's account for no reason.
let shipped;
try {
  shipped = readFileSync("wrangler.jsonc", "utf8");
  const preview = installConfig(shipped, {
    name: WORKER,
    main: "",
    d1Id: "",
    kvId: "",
    d1Name: D1_NAME,
    kvName: KV_NAME,
    vectorizeName: VECTORIZE_NAME,
  });
  console.log(`install: read wrangler.jsonc (compatibility date ${preview.compatibility_date})`);
} catch (error) {
  console.error(`install: wrangler.jsonc could not be read. ${error}`);
  console.error("Run this from the root of a Muxel checkout.");
  process.exit(1);
}

// Provision -------------------------------------------------------------------

console.log(`install: preparing account ${account}`);

const d1Id = await adoptOrCreate(
  "D1 database",
  "d1/database",
  "d1/database",
  { name: D1_NAME },
  "name",
  "uuid",
);

const kvId = await adoptOrCreate(
  "KV namespace",
  "storage/kv/namespaces",
  "storage/kv/namespaces",
  { title: KV_NAME },
  "title",
  "id",
);

// Vectorize is the one resource the deploy form cannot fill in for the
// operator, and the one most often created wrong. Created here it is always
// 1024 dimensions and cosine, which is what bge-m3 produces.
const vectorizeList = await api("GET", "vectorize/v2/indexes");
const vectorize = (vectorizeList?.result ?? []).find((row) => row.name === VECTORIZE_NAME);
if (vectorize) {
  const dimensions = vectorize.config?.dimensions;
  const metric = vectorize.config?.metric;
  console.log(`  reusing Vectorize index ${VECTORIZE_NAME} (${dimensions}, ${metric})`);
  if (dimensions !== 1024 || metric !== "cosine") {
    console.log(
      `  note: this index is ${dimensions}/${metric}, not 1024/cosine. Search still works,\n` +
        "        but delete the index and rerun this script for the best results.",
    );
  }
} else {
  const created = await api("POST", "vectorize/v2/indexes", {
    name: VECTORIZE_NAME,
    config: { dimensions: 1024, metric: "cosine" },
  });
  if (created?.success !== true) {
    fail("create the Vectorize index", created);
  }
  console.log(`  created Vectorize index ${VECTORIZE_NAME} (1024, cosine)`);
}

// Deploy ----------------------------------------------------------------------

const config = installConfig(shipped, {
  name: WORKER,
  main: resolve("packages/runtime/src/index.ts"),
  d1Id,
  kvId,
  d1Name: D1_NAME,
  kvName: KV_NAME,
  vectorizeName: VECTORIZE_NAME,
});

const scratch = mkdtempSync(join(tmpdir(), "muxel-install-"));
const configPath = join(scratch, "wrangler.json");
writeFileSync(configPath, JSON.stringify(config, null, 2));

function cleanup() {
  rmSync(scratch, { recursive: true, force: true });
}

// Secrets go on before the deploy so the Worker's first run already has them
// and setup finishes without a second pass. Putting a secret on a Worker that
// does not exist yet creates it, which is why this order works at all.
const adminBotToken = process.env.ADMIN_BOT_TOKEN;
const ownerTelegramId = process.env.OWNER_TELEGRAM_ID;
if (adminBotToken && ownerTelegramId) {
  for (const [key, value] of [
    ["ADMIN_BOT_TOKEN", adminBotToken],
    ["OWNER_TELEGRAM_ID", ownerTelegramId],
  ]) {
    const put = wrangler(["secret", "put", key, "--config", configPath], { input: `${value}\n` });
    console.log(`  ${put.code === 0 ? "set" : "could not set"} ${key}`);
  }
}

console.log("install: deploying");
const deploy = wrangler(["deploy", "--config", configPath]);
if (deploy.code !== 0) {
  cleanup();
  console.error(deploy.out.trim());
  console.error("\ninstall: the deploy failed. The output above is wrangler's.");
  process.exit(1);
}

const url = deploy.out.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0];
cleanup();

if (!url) {
  console.log("install: deployed, but no workers.dev address was reported.");
  console.log("Enable the workers.dev route for the Worker in the dashboard, then open /setup.");
  process.exit(0);
}

// Confirm ---------------------------------------------------------------------

// A workers.dev address on a new account is not routable for a minute or two
// and answers 404 from the edge in the meantime, so the answer is polled until
// it settles rather than read once and judged.
async function get(path) {
  try {
    const response = await fetch(`${url}${path}`, { signal: AbortSignal.timeout(20_000) });
    return { status: response.status, body: await response.text() };
  } catch (error) {
    return { status: 0, body: String(error) };
  }
}

async function until(path, predicate, deadlineMs = 180_000) {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    const answer = await get(path);
    if (predicate(answer) || Date.now() > deadline) {
      return answer;
    }
    await new Promise((tick) => setTimeout(tick, 5000));
  }
}

console.log(`install: waiting for ${url} to answer`);
const health = await until("/health", (r) => r.status === 200 || r.status === 503);

console.log("");
if (health.status === 200) {
  await get("/setup");
  console.log(`Muxel is running at ${url}`);
  console.log("Open your console bot in Telegram and send /start.");
} else if (health.status === 503) {
  console.log(`Muxel is deployed at ${url} and is waiting for its two settings.`);
  console.log("Add ADMIN_BOT_TOKEN and OWNER_TELEGRAM_ID as secrets, or rerun this");
  console.log("script with both set in the environment.");
} else {
  console.log(`Muxel is deployed at ${url} but the address is not serving yet.`);
  console.log("New addresses can take a few minutes. The Worker finishes its own");
  console.log("setup on the next quarter hourly run, so no further action is needed.");
}
