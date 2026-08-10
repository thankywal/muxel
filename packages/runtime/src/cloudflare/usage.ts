/**
 * Account usage, read from Cloudflare rather than estimated.
 *
 * Muxel counts the tokens it asks for, but that is not the number an operator
 * needs. What they want to know is how much of the free allowance is left,
 * which only Cloudflare can answer, and which their own other Workers also draw
 * against. So the figures here come from the analytics API when a read only
 * token is configured, and the console falls back to Muxel's own counters when
 * it is not.
 */

import type { Env } from "../env.js";

const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

/** Longest the console will wait before reporting the account as unreachable. */
const TIMEOUT_MS = 10_000;

/**
 * Free plan allowances, as published by Cloudflare.
 *
 * These are the included amounts, not hard ceilings: an account on a paid plan
 * keeps working past them and is billed for the excess. They are shown as a
 * reference point, and the console says which plan reading it belongs to.
 */
export const FREE_ALLOWANCE = {
  /** Workers AI neurons per day. */
  neuronsPerDay: 10_000,
  /** Worker requests per day. */
  requestsPerDay: 100_000,
  /** Vectorize dimensions queried per month. */
  queriedDimensionsPerMonth: 30_000_000,
  /** Vectorize dimensions held in the index. */
  storedDimensions: 5_000_000,
} as const;

export interface ModelNeurons {
  readonly model: string;
  readonly neurons: number;
}

export interface AccountUsage {
  readonly neuronsToday: number;
  readonly neuronsThisMonth: number;
  readonly byModel: readonly ModelNeurons[];
  readonly requestsToday: number;
  readonly errorsToday: number;
  readonly queriedDimensionsThisMonth: number;
  readonly storedDimensions: number;
  readonly vectorCount: number;
}

/** Why the account figures are not being shown. */
export type UsageProblem = "not_configured" | "unreachable";

export type UsageResult =
  | { readonly ok: true; readonly usage: AccountUsage }
  | { readonly ok: false; readonly problem: UsageProblem };

const QUERY = `query($a:String!,$today:Date!,$month:Date!,$t0:Time!,$t1:Time!){
  viewer{accounts(filter:{accountTag:$a}){
    aiToday:aiInferenceAdaptiveGroups(limit:50,filter:{date:$today}){
      sum{totalNeurons} dimensions{modelId}}
    aiMonth:aiInferenceAdaptiveGroups(limit:1,filter:{date_geq:$month}){
      sum{totalNeurons}}
    req:workersInvocationsAdaptive(limit:1,filter:{datetime_geq:$t0,datetime_leq:$t1}){
      sum{requests errors}}
    vecQueried:vectorizeV2QueriesAdaptiveGroups(limit:1,filter:{date_geq:$month}){
      sum{queriedVectorDimensions}}
    vecStored:vectorizeV2StorageAdaptiveGroups(limit:1,filter:{date:$today}){
      max{storedVectorDimensions vectorCount}}
  }}
}`;

interface GraphQLAccount {
  readonly aiToday?: readonly {
    readonly sum?: { readonly totalNeurons?: number };
    readonly dimensions?: { readonly modelId?: string };
  }[];
  readonly aiMonth?: readonly { readonly sum?: { readonly totalNeurons?: number } }[];
  readonly req?: readonly {
    readonly sum?: { readonly requests?: number; readonly errors?: number };
  }[];
  readonly vecQueried?: readonly {
    readonly sum?: { readonly queriedVectorDimensions?: number };
  }[];
  readonly vecStored?: readonly {
    readonly max?: { readonly storedVectorDimensions?: number; readonly vectorCount?: number };
  }[];
}

interface GraphQLReply {
  readonly data?: { readonly viewer?: { readonly accounts?: readonly GraphQLAccount[] } };
  readonly errors?: readonly { readonly message?: string }[];
}

/** UTC day and month boundaries, which is how Cloudflare buckets these numbers. */
function window(now: Date): { today: string; month: string; from: string; to: string } {
  const today = now.toISOString().slice(0, 10);
  return {
    today,
    month: `${today.slice(0, 8)}01`,
    from: `${today}T00:00:00Z`,
    to: `${today}T23:59:59Z`,
  };
}

export async function accountUsage(env: Env, now: Date = new Date()): Promise<UsageResult> {
  const account = env.CF_ACCOUNT_ID?.trim();
  const token = env.CF_API_TOKEN?.trim();
  if (!account || !token) {
    return { ok: false, problem: "not_configured" };
  }

  const { today, month, from, to } = window(now);

  let reply: GraphQLReply;
  try {
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query: QUERY,
        variables: { a: account, today, month, t0: from, t1: to },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      return { ok: false, problem: "unreachable" };
    }
    reply = (await response.json()) as GraphQLReply;
  } catch {
    return { ok: false, problem: "unreachable" };
  }

  // GraphQL reports an expired token or a missing permission as a 200 with an
  // errors array, so the status alone does not mean the numbers arrived.
  if (reply.errors !== undefined && reply.errors.length > 0) {
    console.error("account usage query failed", {
      reason: reply.errors[0]?.message ?? "unknown",
    });
    return { ok: false, problem: "unreachable" };
  }

  const node = reply.data?.viewer?.accounts?.[0];
  if (node === undefined) {
    return { ok: false, problem: "unreachable" };
  }

  const byModel = (node.aiToday ?? [])
    .map((row) => ({
      model: row.dimensions?.modelId ?? "unknown",
      neurons: row.sum?.totalNeurons ?? 0,
    }))
    .filter((row) => row.neurons > 0)
    .sort((left, right) => right.neurons - left.neurons);

  return {
    ok: true,
    usage: {
      neuronsToday: byModel.reduce((total, row) => total + row.neurons, 0),
      neuronsThisMonth: node.aiMonth?.[0]?.sum?.totalNeurons ?? 0,
      byModel,
      requestsToday: node.req?.[0]?.sum?.requests ?? 0,
      errorsToday: node.req?.[0]?.sum?.errors ?? 0,
      queriedDimensionsThisMonth: node.vecQueried?.[0]?.sum?.queriedVectorDimensions ?? 0,
      storedDimensions: node.vecStored?.[0]?.max?.storedVectorDimensions ?? 0,
      vectorCount: node.vecStored?.[0]?.max?.vectorCount ?? 0,
    },
  };
}

/**
 * Estimates how many more replies today's allowance covers.
 *
 * Derived from what this deployment actually spent rather than from a published
 * per model rate, so it stays honest when the model changes. Null when nothing
 * has been answered yet, because one number divided by zero is not a forecast.
 */
export function repliesRemaining(neuronsToday: number, messagesToday: number): number | null {
  if (messagesToday <= 0 || neuronsToday <= 0) {
    return null;
  }
  const perReply = neuronsToday / messagesToday;
  return Math.max(0, Math.floor((FREE_ALLOWANCE.neuronsPerDay - neuronsToday) / perReply));
}
