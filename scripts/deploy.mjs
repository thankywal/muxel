#!/usr/bin/env node
/**
 * Deploy, then finish setup.
 *
 * The Worker cannot discover its own public address until a request arrives, so
 * registering the Telegram webhook needs someone to open the deployed URL once.
 * Expecting a shop owner to notice that step and act on it does not work: the
 * deploy reports success, nothing appears broken, and the bot simply never
 * answers.
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
  console.log(
    "\nDeployed. Open your Worker address once to finish setup and register the Telegram webhook.",
  );
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
    const bot = body.match(/<dd>@([A-Za-z0-9_]+)<\/dd>/)?.[1];
    return {
      done: true,
      note:
        bot === undefined
          ? "Setup complete."
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

  // The page explains what is wrong in prose; surface just that line.
  const note = body.match(/<p>([^<]{10,300})<\/p>/)?.[1] ?? `the Worker answered ${response.status}`;
  // A missing setting will not fix itself, so there is no point waiting.
  const permanent = /missing|OWNER_TELEGRAM_ID|dimensions/i.test(note);
  return { done: permanent, note, failed: true };
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
console.error(`The Worker is deployed but not connected to Telegram yet.`);
console.error(`Open ${url}/setup in a browser to finish it and see the full message.`);
process.exit(1);
