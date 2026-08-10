/**
 * Update notices.
 *
 * A deployment made with the one click button is a copy with no link back here,
 * and the copy arrives without the `.github` directory because the import
 * cannot create workflow files. So the scheduled update job never reaches most
 * deployments, and a fix can sit upstream indefinitely while a shop runs an old
 * build and nobody knows.
 *
 * This closes the loop from the other side. The deployment checks for itself
 * and tells its owner, once per version, in the console they already use.
 * Applying the update is still a human action, but nobody has to remember to
 * look for one.
 */

import { open } from "./crypto.js";
import { findOwner, getConsoleBot } from "./db/queries.js";
import type { Env } from "./env.js";
import { peekMasterKey } from "./secrets.js";
import { TelegramClient } from "./telegram/api.js";
import { MUXEL_VERSION, UPSTREAM_REPO, UPSTREAM_VERSION_URL } from "./version.js";

/** Remembers which version the owner has already been told about. */
const NOTIFIED_KEY = "system:update_notified";

function message(latest: string): string {
  return [
    `<b>Muxel ${latest} is available</b>`,
    `This deployment is running ${MUXEL_VERSION}.`,
    "",
    "Updating is a manual step, because the one click deploy copies this",
    "project without a link back to it.",
    "",
    `Open ${UPSTREAM_REPO} and follow "Staying up to date" in the README.`,
    "Your settings, data and bots are not touched by an update.",
  ].join("\n");
}

export type UpdateCheck = "current" | "notified" | "already-notified" | "skipped";

export async function checkForUpdate(env: Env): Promise<UpdateCheck> {
  let latest: string;
  try {
    const response = await fetch(UPSTREAM_VERSION_URL, {
      signal: AbortSignal.timeout(10_000),
      // Upstream sits behind a CDN, so a short cache keeps this to roughly one
      // real request per version rather than one per deployment per run.
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
    if (!response.ok) {
      return "skipped";
    }
    latest = (await response.text()).trim();
  } catch {
    // A check that cannot run is not worth reporting. It runs again shortly.
    return "skipped";
  }

  if (latest.length === 0 || latest === MUXEL_VERSION) {
    return "current";
  }
  if ((await env.STATE.get(NOTIFIED_KEY)) === latest) {
    return "already-notified";
  }

  const [bot, masterKey, owner] = await Promise.all([
    getConsoleBot(env),
    peekMasterKey(env),
    findOwner(env),
  ]);
  if (bot === null || masterKey === null || owner === null) {
    return "skipped";
  }

  const client = new TelegramClient(await open(masterKey, bot.tokenCiphertext));
  // A private chat with a bot uses the person's own account id as the chat id.
  await client.sendMessage({ chatId: owner, text: message(latest) });

  // Recorded only after the notice is sent, so a failure repeats rather than
  // silently swallowing the one message that mattered.
  await env.STATE.put(NOTIFIED_KEY, latest);
  return "notified";
}
