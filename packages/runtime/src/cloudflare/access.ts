/**
 * How this deployment reaches Cloudflare's own API, and who it belongs to.
 *
 * One record of that, because three things want it: the neuron figures, the
 * account name on the owner's badge, and anything added later. Each reading it
 * for itself is how two of them end up disagreeing about whether the account is
 * configured.
 *
 * The token cannot be created for the owner. Cloudflare does not let a Worker
 * mint an API token for the account it runs in, and that is the right boundary:
 * a deployment that could would be a deployment that could grant itself
 * anything. So the owner makes a read only token once and pastes it.
 *
 * What is not asked for is the account id. A token belongs to an account, and
 * Cloudflare will say which when asked, so asking the owner for a second value
 * they would have to go and look up is a question with an answer we already
 * have. The name comes back in the same call.
 */

import type { Env } from "../env.js";
import { getSecret } from "../web/secrets-vault.js";

/** Long enough that this is not a per page cost, short enough to follow a rename. */
const CACHE_SECONDS = 86_400;
const CACHE_KEY = "system:cf_account";
const TIMEOUT_MS = 8_000;

export interface CloudflareAccess {
  readonly token: string;
  readonly accountId: string;
  /** The name on the account, when the token is allowed to read it. */
  readonly name: string | null;
}

/**
 * @returns How to reach Cloudflare, or null when there is no usable token.
 *   Null means "not configured", never "the account is empty".
 */
export async function cloudflareAccess(env: Env): Promise<CloudflareAccess | null> {
  // The vault first: a token pasted into the console is the one the owner most
  // recently decided on, and it is the only one they can change without a
  // redeploy. The deploy form's value stays as the fallback.
  const token = (await getSecret(env, "cloudflare_token")) ?? env.CF_API_TOKEN?.trim() ?? "";
  if (token.length === 0) return null;

  const cached = await env.STATE.get(CACHE_KEY, "json").catch(() => null);
  if (cached !== null) {
    const held = cached as { token: string; accountId: string; name: string | null };
    // Keyed by the token, so pasting a different one is not answered from the
    // account the old one belonged to.
    if (held.token === token) return held.accountId.length > 0 ? held : null;
  }

  const discovered = await discover(token, env.CF_ACCOUNT_ID?.trim() ?? "");
  await env.STATE.put(
    CACHE_KEY,
    JSON.stringify({ token, accountId: discovered?.accountId ?? "", name: discovered?.name ?? null }),
    { expirationTtl: CACHE_SECONDS },
  ).catch(() => undefined);
  return discovered;
}

/** Forgets what was learned, so the next read asks Cloudflare again. */
export async function forgetAccess(env: Env): Promise<void> {
  await env.STATE.delete(CACHE_KEY).catch(() => undefined);
}

async function discover(token: string, fallbackId: string): Promise<CloudflareAccess | null> {
  let accounts: { id?: string; name?: string }[] = [];
  try {
    const response = await fetch("https://api.cloudflare.com/client/v4/accounts?per_page=50", {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.ok) {
      const body = (await response.json()) as { result?: { id?: string; name?: string }[] };
      accounts = body.result ?? [];
    }
  } catch {
    // Left empty. A network blip falls through to whatever the deploy form set.
  }

  // A token scoped to one account sees exactly one, which is the ordinary case
  // and needs no question. A token that sees several cannot be resolved by
  // guessing, so the deploy form's value decides, and if there is none the
  // owner is told rather than pointed at somebody else's account.
  const only = accounts.length === 1 ? accounts[0] : undefined;
  const chosen = only ?? accounts.find((account) => account.id === fallbackId);
  const accountId = chosen?.id ?? (accounts.length === 0 ? fallbackId : "");
  if (accountId.length === 0) return null;
  return { token, accountId, name: chosen?.name?.trim() || null };
}
