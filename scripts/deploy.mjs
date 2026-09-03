#!/usr/bin/env node
/**
 * Deploy, then finish setup.
 *
 * The Worker cannot discover its own public address until a request arrives, so
 * finishing setup needs someone to open the deployed URL once: applying the
 * schema, installing the owner, and registering the Telegram webhook if there
 * is a bot to register. Expecting a shop owner to notice that step and act on
 * it does not work: the deploy reports success, nothing appears broken, and the
 * console simply never lets them in.
 *
 * This script closes the gap by making the first request itself. Cloudflare
 * Workers Builds runs it as the deploy command, so a one click deploy finishes
 * fully configured.
 *
 * It also writes the address into KV before trying, which matters more than the
 * request does. A workers.dev address on a brand new account is not routable
 * for a minute or two after the upload, and the edge answers 404 in the
 * meantime. With the address recorded, the Worker's own scheduled run finishes
 * setup as soon as it starts serving, so a slow address costs a quarter of an
 * hour rather than a bot that never answers.
 *
 * Only a fault the operator has to fix, such as a missing setting, fails the
 * build. An address that is not serving yet does not: the deployment is good,
 * and reporting it red teaches people to distrust a red build.
 */

import { spawn } from "node:child_process";

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["--yes", "wrangler", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    });

    let combined = "";
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on("data", (chunk) => {
        const text = chunk.toString();
        combined += text;
        // Pass wrangler's own output through so the build log is unchanged.
        process.stdout.write(text);
      });
    }

    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, combined }));
  });
}

const { code, combined } = await run(["deploy"]);
if (code !== 0) {
  process.exit(code);
}

const url = combined.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0];
if (url === undefined) {
  console.log("\nDeployed. Open your Worker address once to finish setup.");
  process.exit(0);
}

/**
 * Records the address so the Worker can finish setting itself up.
 *
 * Written before the first request rather than after a failure, because the
 * case this exists for is the one where no request ever succeeds.
 */
async function recordOrigin(target) {
  const { code: kvCode } = await run([
    "kv",
    "key",
    "put",
    "system:origin",
    target,
    "--binding",
    "STATE",
    "--remote",
  ]);
  return kvCode === 0;
}

const recorded = await recordOrigin(url);
console.log(
  recorded
    ? `\nRecorded ${url} so the Worker can finish setup on its own if it has to.`
    : `\nCould not record the address. Setup will need the request below to succeed.`,
);

/**
 * Asks the deployment what it is still waiting for.
 *
 * The setup page turns this into a sentence for a person; /health publishes the
 * list itself, as JSON, names only and never values, so it is safe in a build
 * log. A record that cannot be read is not an empty one — an edge that has not
 * started serving answers with a page of its own — so that answers null and is
 * read as "not known" rather than "nothing missing".
 */
async function missingSettings(target) {
  try {
    const response = await fetch(`${target}/health`, { signal: AbortSignal.timeout(30_000) });
    const record = await response.json();
    const missing = record?.missing;
    return Array.isArray(missing) ? missing.filter((name) => typeof name === "string") : null;
  } catch {
    return null;
  }
}

/**
 * Attempts setup, reporting whether it is worth trying again.
 *
 * A first deploy finishes before its address is serving and moments after the
 * resources were created, so an early attempt can fail for reasons that pass on
 * their own. Only a definite answer from the Worker ends the loop.
 */
async function attemptSetup(target) {
  let response;
  try {
    response = await fetch(`${target}/setup`, { signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    return { done: false, note: error.message };
  }

  const body = await response.text();
  if (response.ok) {
    // The bot's username is a field of the page rather than a phrase in it, and
    // a deployment need not have one: a console key is a finished deployment,
    // and its owner is told where that key is typed rather than sent looking
    // for a bot nobody asked them for.
    const bot = body.match(/<dd>@([A-Za-z0-9_]+)<\/dd>/)?.[1];
    return {
      done: true,
      note:
        bot === undefined
          ? "Setup complete. Open app.muxel.site, paste this address, and enter your console key."
          : `Setup complete. Open @${bot} in Telegram and send /start.`,
    };
  }

  // A 404 is the edge saying the address is not routable yet, not the Worker
  // saying anything: every path the Worker serves is answered, and setup is one
  // of them. A brand new address can also flap through generic Cloudflare
  // error pages while it propagates; those pages are not ours, so any 5xx that
  // did not come from Muxel's own page gets the same treatment. The one 5xx
  // that is real is a crash, and Cloudflare's page names it.
  if (body.includes("Worker threw exception")) {
    return { done: true, note: "the Worker crashed while serving setup", failed: true };
  }
  if (response.status === 404 || (response.status >= 500 && !body.includes("Muxel"))) {
    return { done: false, note: "the address is not serving yet", unreachable: true };
  }

  // The page explains what is wrong in prose; surface just that line. It is
  // carried to the operator and decides nothing.
  const note = body.match(/<p>([^<]{10,300})<\/p>/)?.[1] ?? `the Worker answered ${response.status}`;

  // A missing setting will not fix itself, so there is no point waiting. Which
  // one this is comes from the deployment's own record, never from that
  // sentence. Looking for the words "missing" or "OWNER_TELEGRAM_ID" in the
  // page was guessing at wording this script does not own, and it was already
  // wrong: a console key that is too short is named in a sentence with none of
  // those words in it, so a fault that could be reported at once was retried
  // for three minutes first.
  const missing = await missingSettings(target);
  if (missing !== null && missing.length > 0) {
    return { done: true, failed: true, missing, note };
  }

  // The record says every setting is there, so what went wrong is either a
  // value only somebody else can judge — a bot token Telegram has to accept —
  // or a resource still settling seconds after it was created. Nothing here
  // can tell those apart, and one of them passes on its own, so this waits.
  return { done: false, note, failed: true };
}

// Roughly three minutes in total. A new address usually starts serving inside
// one, and waiting is cheaper than a deployment that needs a person.
const DELAYS_MS = [
  0, 2000, 3000, 5000, 8000, 10_000, 10_000, 15_000, 15_000, 20_000, 20_000, 30_000, 30_000,
];

console.log(`\nFinishing setup at ${url}/setup`);
let outcome = { done: false, note: "not attempted" };
for (const [attempt, delay] of DELAYS_MS.entries()) {
  if (delay > 0) {
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  outcome = await attemptSetup(url);
  if (outcome.done) {
    break;
  }
  console.log(`  attempt ${attempt + 1} did not finish: ${outcome.note}`);
}

if (outcome.done && outcome.failed !== true) {
  console.log(outcome.note);
  process.exit(0);
}

// An address that has not started serving is not a broken deployment, and
// calling it one trains people to ignore a red build. The Worker finishes
// setting itself up on its next scheduled run, within fifteen minutes, because
// the address was recorded above.
if (outcome.unreachable === true && recorded) {
  console.log(`\nThe address is not serving yet, which is normal for a new one.`);
  console.log(`Setup will finish by itself within fifteen minutes.`);
  console.log(`To have it now, open ${url}/setup in a browser.`);
  process.exit(0);
}

// Anything else is a fault a person has to clear, and a red build carrying the
// reason is worth more than a green one that lies. Both were learned the hard
// way, in that order.
console.error(`\nSetup did not finish: ${outcome.note}`);
if (outcome.missing !== undefined && outcome.missing.length > 0) {
  // Names the deployment gave, printed as it gave them, so the build log says
  // exactly what to add and this script keeps no second opinion about it.
  console.error(`Add ${outcome.missing.join(" and ")} under Settings, Variables and Secrets.`);
}
console.error(`The Worker is deployed but has not finished setting itself up.`);
console.error(`Open ${url}/setup in a browser to finish it and see the full message.`);
process.exit(1);
