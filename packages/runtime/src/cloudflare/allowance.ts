/**
 * A single answer's share of the day's neurons.
 *
 * Cloudflare bills Workers AI in neurons and reports them per model, per day,
 * for the whole account. It never reports them per request. Muxel counts tokens
 * per model per day at the one door every call passes through. Put together on
 * the same model and the same day, they give a rate this account actually paid,
 * and one answer's tokens multiplied by that rate is its share.
 *
 * The rate is measured, never published. A hardcoded price per model would be
 * wrong the day Cloudflare changes one, and wrong for every model this file has
 * not heard of, and neither failure would be visible.
 *
 * Nothing here is invented. With no API token there is no neuron figure, and
 * the console is told that rather than shown a plausible number.
 */

import type { Env } from "../env.js";
import { modelTokensToday } from "../db/queries.js";
import { accountUsage, FREE_ALLOWANCE, type UsageProblem } from "./usage.js";

/** How long a neuron reading is reused before Cloudflare is asked again. */
const CACHE_SECONDS = 60;
const CACHE_KEY = "system:neurons_today";

export interface Allowance {
  /** Neurons the whole account has drawn today, or null if it cannot be read. */
  readonly neuronsToday: number | null;
  /** The free plan's daily inclusion, for the "of X" half of the sentence. */
  readonly perDay: number;
  /** Measured neurons per token, keyed by the model id Muxel uses. */
  readonly rate: Readonly<Record<string, number>>;
  /** Why there is no neuron figure, when there is not. */
  readonly problem: UsageProblem | null;
}

/**
 * Cloudflare names a model `@cf/vendor/name`; Muxel prefixes platform models
 * with `workers-ai/`. Comparing them raw matched nothing, which showed up as
 * every rate being missing rather than as an error.
 */
const bare = (model: string): string => model.replace(/^workers-ai\//, "");

export async function allowanceNow(env: Env): Promise<Allowance> {
  const [account, tokens] = await Promise.all([cachedUsage(env), modelTokensToday(env)]);

  if (!account.ok) {
    return { neuronsToday: null, perDay: FREE_ALLOWANCE.neuronsPerDay, rate: {}, problem: account.problem };
  }

  // Today's tokens are keyed by Muxel's own model ids, so the rate is keyed
  // that way too and a caller never has to know Cloudflare's spelling.
  const neuronsByBareModel = new Map(account.usage.byModel.map((row) => [row.model, row.neurons]));
  const rate: Record<string, number> = {};
  for (const [model, counted] of Object.entries(tokens)) {
    const neurons = neuronsByBareModel.get(bare(model));
    // A model with tokens but no neurons yet is not a rate of zero: it is a
    // reading that has not arrived. Analytics lag a few minutes behind a call.
    if (neurons === undefined || neurons <= 0 || counted.tokens <= 0) continue;
    rate[model] = neurons / counted.tokens;
  }

  return {
    neuronsToday: account.usage.neuronsToday,
    perDay: FREE_ALLOWANCE.neuronsPerDay,
    rate,
    problem: null,
  };
}

/**
 * One answer's neurons, or null when the rate for its model is not known yet.
 *
 * Null is the honest answer for the first reply of the day, for a model this
 * account has not used before, and for a deployment with no API token. A zero
 * there would read as "this was free".
 */
export function neuronsFor(
  allowance: Allowance,
  usage: { model: string; inputTokens: number; outputTokens: number },
): number | null {
  const rate = allowance.rate[usage.model];
  if (rate === undefined) return null;
  return Math.round((usage.inputTokens + usage.outputTokens) * rate);
}

async function cachedUsage(env: Env): Promise<Awaited<ReturnType<typeof accountUsage>>> {
  const cached = await env.STATE.get(CACHE_KEY, "json").catch(() => null);
  if (cached !== null) return cached as Awaited<ReturnType<typeof accountUsage>>;
  const fresh = await accountUsage(env);
  // Cached either way. A deployment with no token would otherwise ask on every
  // page load for an answer that cannot change until it is configured.
  await env.STATE.put(CACHE_KEY, JSON.stringify(fresh), {
    expirationTtl: Math.max(60, CACHE_SECONDS),
  }).catch(() => undefined);
  return fresh;
}
