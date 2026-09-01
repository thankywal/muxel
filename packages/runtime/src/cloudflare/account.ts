/**
 * The name on the Cloudflare account this deployment runs in.
 *
 * The console used to call the owner "Owner", which is a role, not a person.
 * The deployment already lives in somebody's account, and Cloudflare says whose
 * in the same call that tells us which account it is — so this costs nothing
 * beyond what the neuron figures already ask for.
 */

import type { Env } from "../env.js";
import { cloudflareAccess } from "./access.js";

/**
 * @returns The account's name, or null when there is no token, no permission,
 *   or Cloudflare did not answer. Null means "do not claim to know", never
 *   "anonymous".
 */
export async function accountName(env: Env): Promise<string | null> {
  return (await cloudflareAccess(env))?.name ?? null;
}

/**
 * The account's own workers.dev handle, taken from the address this deployment
 * is being asked at.
 *
 * Every Cloudflare account has one and it is in the hostname, so this needs no
 * token and no permission at all: `sunrise.nandar.workers.dev` is being served
 * out of the account whose subdomain is `nandar`. It is a handle rather than a
 * display name, which is why the real name still wins when there is one, but it
 * beats calling somebody "Owner".
 *
 * @returns The subdomain, or null on a custom domain, where the hostname says
 *   nothing about whose account is behind it.
 */
export function workersSubdomain(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  if (!host.endsWith(".workers.dev")) return null;
  // <worker>.<subdomain>.workers.dev — anything shorter is the account's own
  // bare subdomain, which names nobody in particular.
  const labels = host.slice(0, -".workers.dev".length).split(".");
  const subdomain = labels.length >= 2 ? labels[labels.length - 1] : "";
  return subdomain !== undefined && subdomain.length > 0 ? subdomain : null;
}
