/**
 * The console key, which a deployment issues to itself.
 *
 * This used to be a secret the owner invented and typed into the deploy form.
 * That was one box, which read as almost nothing — and it was still the wall
 * people stopped at, because Cloudflare's deploy form makes every secret it
 * finds a required field. Someone who has just pressed a deploy button is asked
 * for a password to a thing that does not exist yet, with no way to know what
 * it is for or what a good answer looks like, and cannot continue without
 * inventing one. The deployment can invent a far better one, so it does.
 *
 * The key comes from one of three places, in order:
 *
 *   1. The CONSOLE_KEY secret, when the owner set one. Setting it is how a
 *      leaked key is taken back, so it has to win.
 *   2. KV, where the key this deployment made for itself is kept.
 *   3. Nowhere yet, in which case one is made and kept.
 *
 * Keeping it in KV means anybody with access to the Cloudflare account can read
 * it. That is the same account that can read the database, rewrite the Worker
 * and change the key anyway, so it discloses nothing to the account's owner —
 * and being readable is the point, since the owner has to be told what their
 * key is.
 */

import { generateId } from "@muxel/core";

import { consoleKey as configuredConsoleKey, type Env } from "./env.js";

const KEY_NAME = "system:console_key";

/**
 * The record that the console has been signed into at least once.
 *
 * The setup page is public, and it shows the key while this is unset, because
 * an owner who has just deployed has no other way to learn it. What ends that
 * is somebody actually signing in, not a timer and not a setting: after the
 * first session is issued the deployment has an owner, and it stops printing
 * their key on a page anyone can open.
 */
const CLAIMED_NAME = "system:console_claimed";

/**
 * Length of a key this deployment makes for itself, in characters.
 *
 * Comfortably past CONSOLE_KEY_MIN_LENGTH, which is the floor for a key a
 * person invented. Nobody has to type this one, so there is no reason for it to
 * be near the floor.
 */
const MINTED_LENGTH = 28;

/**
 * Returns the console key if this deployment already has one, without making
 * one. Used on paths that must not create state: signing in, checking a
 * session, reporting health.
 */
export async function peekConsoleKey(env: Env): Promise<string | null> {
  const configured = configuredConsoleKey(env);
  if (configured !== null) {
    return configured;
  }
  // Read every time rather than cached per isolate. The key can be replaced —
  // that is the whole of how a leaked one is taken back — and an isolate still
  // answering with the key it read an hour ago would keep the sessions it
  // opened alive, which is the one thing replacing it has to end.
  const stored = await env.STATE.get(KEY_NAME);
  return stored !== null && stored.length > 0 ? stored : null;
}

/**
 * Returns the console key, making one if this deployment has none.
 *
 * Called from setup, which is the one place allowed to create it, so that the
 * page that shows the key is also the page that caused it to exist.
 */
export async function ensureConsoleKey(env: Env): Promise<string> {
  const existing = await peekConsoleKey(env);
  if (existing !== null) {
    return existing;
  }

  const minted = generateId(MINTED_LENGTH);
  await env.STATE.put(KEY_NAME, minted);

  // Read back before returning it. Two cold isolates can reach this line
  // together, and an owner told a key that lost the race would be told a key
  // that does not open anything.
  return (await env.STATE.get(KEY_NAME)) ?? minted;
}

/** Whether anybody has ever signed into this deployment's console. */
export async function consoleClaimed(env: Env): Promise<boolean> {
  return (await env.STATE.get(CLAIMED_NAME)) !== null;
}

/**
 * Records that the console has been signed into.
 *
 * Written once and never cleared. Rotating CONSOLE_KEY does not un-claim a
 * deployment: the owner who rotates it knows their own key, and reprinting a
 * key on a public page because a setting changed would turn a security measure
 * into a disclosure.
 */
export async function recordConsoleClaim(env: Env): Promise<void> {
  if (await consoleClaimed(env)) {
    return;
  }
  await env.STATE.put(CLAIMED_NAME, "1");
}
