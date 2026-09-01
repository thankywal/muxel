/**
 * The name on the Cloudflare account this deployment runs in.
 *
 * The console used to call the owner "Owner", which is a role, not a person.
 * The deployment already lives in somebody's account, and Cloudflare will say
 * whose when it is asked with the same read only token the usage figures use.
 *
 * Asked once and remembered: an account is renamed about never, and the badge
 * is drawn on every page.
 */

import type { Env } from "../env.js";

const CACHE_KEY = "system:account_name";
/** A day. Long enough that this is not a per page cost, short enough to follow a rename. */
const CACHE_SECONDS = 86_400;
const TIMEOUT_MS = 8_000;

/**
 * @returns The account's name, or null when there is no token, no permission,
 *   or Cloudflare did not answer. Null means "do not claim to know", never
 *   "anonymous".
 */
export async function accountName(env: Env): Promise<string | null> {
  const account = env.CF_ACCOUNT_ID?.trim();
  const token = env.CF_API_TOKEN?.trim();
  if (!account || !token) return null;

  const cached = await env.STATE.get(CACHE_KEY).catch(() => null);
  if (cached !== null) return cached.length > 0 ? cached : null;

  let name: string | null = null;
  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.ok) {
      const body = (await response.json()) as { result?: { name?: string } };
      name = body.result?.name?.trim() || null;
    }
  } catch {
    // Left null. A network blip is not a reason to rename the owner.
  }

  // The empty string is cached too, so a token without Account Settings:Read
  // is not retried on every page load for a permission it will never gain.
  await env.STATE.put(CACHE_KEY, name ?? "", { expirationTtl: CACHE_SECONDS }).catch(
    () => undefined,
  );
  return name;
}
