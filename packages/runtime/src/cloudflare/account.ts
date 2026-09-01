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
