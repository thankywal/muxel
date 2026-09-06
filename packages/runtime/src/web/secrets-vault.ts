/**
 * Secrets the owner supplies after deployment.
 *
 * Some things cannot be set on the deploy form because they do not exist yet.
 * A GitHub token has to be created against the repository the deploy button
 * just made, so it can only arrive afterwards, and the same will be true of any
 * provider key an owner adds later.
 *
 * They are sealed with this deployment's own master key and kept in its own KV.
 * Nothing about them reaches the project that published the code: the console
 * that collects one is a page in the owner's browser talking to the owner's
 * deployment, and there is no third party in between to trust.
 */

import { open, seal } from "../crypto.js";
import type { Env } from "../env.js";
import { resolveMasterKey } from "../secrets.js";

/** The names a deployment understands, so a typo cannot create a dead entry. */
export const SECRET_NAMES = [
  // Both are the owner's own credentials for their own accounts, held so this
  // deployment can update itself and read its own usage. Nothing here reaches
  // a service outside the owner's Cloudflare and GitHub accounts.
  "github_token",
  "cloudflare_token",
] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

const key = (name: SecretName): string => `secret:${name}`;
const hintKey = (name: SecretName): string => `secret:${name}:hint`;

/** How much of a key either end may show. Enough to tell two apart, no more. */
const SHOWN = 4;
/** Fixed, so the mask does not also publish how long the key is. */
const MASK = "\u2022".repeat(10);

/**
 * A key, written the way a card number is written on a receipt.
 *
 * The owner needs to know *which* key is stored — they may hold several, and
 * "a key is set" does not tell them whether it is the right one. What they do
 * not need, and what a shared screen must not carry, is the key.
 *
 * Derived here rather than anywhere that could be reached from a request, and
 * only ever from a value the caller already had in its hand. A key too short
 * for both ends to be a small fraction of it shows nothing at all: masking two
 * characters out of eight is not masking.
 */
export function maskKey(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < SHOWN * 4) return MASK;
  return `${trimmed.slice(0, SHOWN)}${MASK}${trimmed.slice(-SHOWN)}`;
}

export function isSecretName(value: string): value is SecretName {
  return (SECRET_NAMES as readonly string[]).includes(value);
}

export async function putSecret(env: Env, name: SecretName, value: string): Promise<void> {
  await env.STATE.put(key(name), await seal(await resolveMasterKey(env), value.trim()));
  // Written here, from the value this call was handed, and stored beside the
  // sealed one rather than derived from it later. That is the whole point: no
  // path that draws a screen ever has to open the envelope, so the rule that
  // this deployment never reads a key back out survives the console showing
  // the owner which key they saved.
  await env.STATE.put(hintKey(name), maskKey(value));
}

export async function getSecret(env: Env, name: SecretName): Promise<string | null> {
  const sealed = await env.STATE.get(key(name));
  if (sealed === null) return null;
  try {
    return await open(await resolveMasterKey(env), sealed);
  } catch {
    // A master key that has been rotated leaves unreadable ciphertext behind.
    // Reporting it as absent asks the owner for it again, which is recoverable,
    // where throwing would leave the console stuck on an error it cannot fix.
    return null;
  }
}

export async function clearSecret(env: Env, name: SecretName): Promise<void> {
  // Both, or forgetting a key would leave its shadow on the screen.
  await Promise.all([env.STATE.delete(key(name)), env.STATE.delete(hintKey(name))]);
}

/**
 * @returns The masked form of a stored key, or null when none is stored.
 *
 * Never the key. A deployment that stored one before hints existed has no hint
 * to give and says so, rather than opening the envelope to make one.
 */
export async function secretHint(env: Env, name: SecretName): Promise<string | null> {
  return env.STATE.get(hintKey(name));
}

/**
 * Whether a secret is present, without reading it back.
 *
 * The console shows that a token is set and never shows the token, so a shared
 * screen or a screenshot cannot leak it.
 */
export async function hasSecret(env: Env, name: SecretName): Promise<boolean> {
  return (await env.STATE.get(key(name))) !== null;
}
