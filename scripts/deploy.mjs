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
 * A setup failure is reported but does not fail the deploy. The code is live at
 * that point, and /setup can be opened by hand to see the reason.
 */

import { spawn } from "node:child_process";

function runWrangler() {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["--yes", "wrangler", "deploy"], {
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

const { code, combined } = await runWrangler();
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

  // The page explains what is wrong in prose; surface just that line.
  const note = body.match(/<p>([^<]{10,300})<\/p>/)?.[1] ?? `the Worker answered ${response.status}`;
  // A missing setting will not fix itself, so there is no point waiting.
  const permanent = /missing|OWNER_TELEGRAM_ID|dimensions/i.test(note);
  return { done: permanent, note, failed: true };
}

const DELAYS_MS = [0, 2000, 3000, 5000, 8000, 10_000, 10_000, 15_000];

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
} else {
  console.log(`Setup did not finish: ${outcome.note}`);
  console.log(`Open ${url}/setup in a browser to complete it and see the full message.`);
}
