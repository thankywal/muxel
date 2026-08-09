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

console.log(`\nFinishing setup at ${url}/setup`);
try {
  const response = await fetch(`${url}/setup`, { signal: AbortSignal.timeout(30_000) });
  const body = await response.text();
  if (response.ok) {
    const bot = body.match(/<dd>@([A-Za-z0-9_]+)<\/dd>/)?.[1];
    console.log(
      bot === undefined
        ? "Setup complete."
        : `Setup complete. Open @${bot} in Telegram and send /start.`,
    );
  } else {
    // The page explains what is wrong in prose; surface just that line.
    const note = body.match(/<p>([^<]{10,300})<\/p>/)?.[1];
    console.log(`Setup did not finish: ${note ?? `the Worker answered ${response.status}`}`);
    console.log(`Open ${url}/setup in a browser for the full message.`);
  }
} catch (error) {
  console.log(`Could not reach the Worker to finish setup: ${error.message}`);
  console.log(`Open ${url}/setup in a browser to complete it.`);
}
