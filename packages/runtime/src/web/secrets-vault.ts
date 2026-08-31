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
export const SECRET_NAMES = ["github_token"] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

const key = (name: SecretName): string => `secret:${name}`;

export function isSecretName(value: string): value is SecretName {
  return (SECRET_NAMES as readonly string[]).includes(value);
}

export async function putSecret(env: Env, name: SecretName, value: string): Promise<void> {
  await env.STATE.put(key(name), await seal(await resolveMasterKey(env), value.trim()));
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
  await env.STATE.delete(key(name));
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
