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
 *
 * The check is a poll rather than a push. Pushing would require this project to
 * keep a registry of every deployment's address, which is the one thing Muxel
 * promises not to do, so the deployment asks instead of being told.
 */

import { open } from "./crypto.js";
import { findOwner, getConsoleBot } from "./db/queries.js";
import type { Env } from "./env.js";
import { isRepoSlug, SOURCE_REPO, updateWorkflowUrl } from "./repo.js";
import { peekMasterKey } from "./secrets.js";
import { ORIGIN_KEY } from "./setup.js";
import { TelegramClient, type InlineKeyboardMarkup } from "./telegram/api.js";
import { MUXEL_VERSION, UPSTREAM_REPO, UPSTREAM_VERSION_URL } from "./version.js";

/** Remembers which version the owner has already been told about. */
const NOTIFIED_KEY = "system:update_notified";

/** Shape of a published version, used to reject an error page or a stray file. */
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export interface VersionStatus {
  readonly running: string;
  /** Null when upstream could not be reached, which is not the same as current. */
  readonly latest: string | null;
  readonly behind: boolean;
}

/**
 * Reads the version published upstream.
 *
 * No cache override is set here. An earlier version pinned the response for an
 * hour to be kind to the origin, which meant a deployment kept reading a
 * version that had already been superseded and stayed silent through several
 * releases. The origin sends its own short lived cache headers, which is both
 * gentler than a request per check and fresher than an hour.
 */
export async function latestVersion(): Promise<string | null> {
  try {
    const response = await fetch(UPSTREAM_VERSION_URL, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return null;
    }
    const published = (await response.text()).trim();
    return VERSION_PATTERN.test(published) ? published : null;
  } catch {
    return null;
  }
}

/** Compares this deployment against upstream. Used by the console on demand. */
export async function versionStatus(): Promise<VersionStatus> {
  const latest = await latestVersion();
  return {
    running: MUXEL_VERSION,
    latest,
    behind: latest !== null && latest !== MUXEL_VERSION,
  };
}

function message(latest: string): string {
  return [
    `<b>Muxel ${latest} is available</b>`,
    `This deployment is running ${MUXEL_VERSION}.`,
    "",
    "If automatic updates are on, this arrives by itself within a day.",
    "The button below runs it now instead of waiting.",
    "",
    "Your settings, data and bots are not touched by an update.",
  ].join("\n");
}

/**
 * Buttons under the update notice.
 *
 * Built from the build time stamp of this deployment's own repository, never
 * from anything a message could influence: these open pages that can commit
 * code, so the destination has to be decided entirely server side.
 *
 * Null when the build could not name the repository, in which case the notice
 * falls back to describing the manual route.
 */
function updateButtons(origin: string | null): InlineKeyboardMarkup | null {
  if (!isRepoSlug(SOURCE_REPO)) {
    return null;
  }
  const rows: { text: string; url: string }[][] = [
    [{ text: "Run the update now", url: updateWorkflowUrl(SOURCE_REPO) }],
  ];
  if (origin !== null) {
    // The setup page hosts the one time enable flow, with the pre-filled
    // GitHub link that is too long to put in a button comfortably.
    rows.push([{ text: "Turn on automatic updates", url: `${origin}/setup` }]);
  }
  return { inline_keyboard: rows };
}

/**
 * Outcome of one check.
 *
 * `unreachable` and `not-ready` were a single `skipped` value, which made a
 * broken check indistinguishable from a quiet one in the logs. They are
 * separate so the reason a notice never arrived is answerable.
 */
export type UpdateCheck =
  | "current"
  | "notified"
  | "already-notified"
  | "unreachable"
  | "not-ready";

export async function checkForUpdate(env: Env): Promise<UpdateCheck> {
  const latest = await latestVersion();
  if (latest === null) {
    return "unreachable";
  }
  if (latest === MUXEL_VERSION) {
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
    return "not-ready";
  }

  const client = new TelegramClient(await open(masterKey, bot.tokenCiphertext));
  const origin = await env.STATE.get(ORIGIN_KEY);
  const buttons = updateButtons(origin);
  const fallback =
    buttons === null
      ? `\nOpen ${UPSTREAM_REPO} and follow "Staying up to date" in the README.`
      : "";
  // A private chat with a bot uses the person's own account id as the chat id.
  await client.sendMessage({
    chatId: owner,
    text: message(latest) + fallback,
    ...(buttons === null ? {} : { replyMarkup: buttons }),
  });

  // Recorded only after the notice is sent, so a failure repeats rather than
  // silently swallowing the one message that mattered.
  await env.STATE.put(NOTIFIED_KEY, latest);
  return "notified";
}
