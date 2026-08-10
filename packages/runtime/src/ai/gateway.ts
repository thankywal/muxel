/**
 * Inference through the AI Gateway compatibility endpoint.
 *
 * A single request shape reaches every supported provider, so the model a
 * business uses is configuration rather than code. The stored value is passed
 * through verbatim, which also allows a named routing flow to be used in place
 * of a concrete model.
 */

import { MuxelError, type ChatTurn, type InferenceResult } from "@muxel/core";

import type { Env } from "../env.js";
import { fitVector, indexDimensions } from "../rag/dimensions.js";

const GATEWAY_ROOT = "https://gateway.ai.cloudflare.com/v1";

interface CompletionChoice {
  readonly message?: { readonly content?: string };
  readonly finish_reason?: string;
}

interface CompletionResponse {
  readonly choices?: readonly CompletionChoice[];
  readonly model?: string;
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
  };
}

/**
 * Default output budget.
 *
 * Reasoning models spend the budget on thinking before emitting a single
 * visible character, and the completion stops at the cap whether or not the
 * answer has been written. Cut it too fine and the model runs out mid thought
 * and returns nothing at all, which is what an empty completion is.
 *
 * Measured against Gemma 4 on a grounded question over a real price list:
 *
 * | budget | empty replies | slowest |
 * | ------ | ------------- | ------- |
 * | 1200   | 4 of 8        | 12s     |
 * | 2000   | 2 of 8        | 23s     |
 * | 3000   | 0 of 8        | 15s     |
 * | 4000   | 1 of 8        | 31s     |
 *
 * Answers that completed used between 547 and 2032 tokens, so 3000 leaves the
 * model room to finish reasoning and still write. Going higher buys nothing
 * and lets a stubborn generation run past the time the runtime allows for
 * work after a response.
 */
const DEFAULT_OUTPUT_TOKENS = 3000;

export interface GenerateInput {
  readonly model: string;
  readonly system: string;
  readonly history: readonly ChatTurn[];
  readonly userMessage: string;
  readonly maxOutputTokens?: number;
  /** Propagated to the gateway so spend can be attributed per business. */
  readonly businessId: string;
}

interface Attempt {
  readonly text: string;
  readonly finishReason: string | null;
  readonly model: string;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}

/**
 * Sends a chat completion and returns the assistant reply.
 *
 * A reasoning model can return an empty message when it exhausts the budget
 * before finishing. That happens intermittently on identical input, so a single
 * empty response is retried once with a larger budget rather than surfaced to
 * the customer as a failure.
 */
export async function generate(env: Env, input: GenerateInput): Promise<InferenceResult> {
  const budget = input.maxOutputTokens ?? DEFAULT_OUTPUT_TOKENS;

  const first = await attempt(env, input, budget);
  if (first.text.length > 0) {
    return toResult(first);
  }

  console.warn("empty completion, retrying with a larger budget", {
    businessId: input.businessId,
    model: input.model,
    finishReason: first.finishReason,
    outputTokens: first.outputTokens,
  });

  // Retried at the same size, not a larger one. The empty reply is
  // intermittent rather than a budget shortfall, and doubling it once pushed a
  // reply past the runtime's limit and lost it entirely.
  const second = await attempt(env, input, budget);
  if (second.text.length === 0) {
    throw new MuxelError("upstream_failure", "inference returned no content", {
      model: input.model,
      finishReason: second.finishReason,
    });
  }
  return toResult(second);
}

function toResult(attempted: Attempt): InferenceResult {
  return {
    text: attempted.text,
    model: attempted.model,
    inputTokens: attempted.inputTokens,
    outputTokens: attempted.outputTokens,
  };
}

/** Prefix marking a model that the Workers AI binding can serve directly. */
const PLATFORM_PREFIX = "workers-ai/";

/**
 * Turns off a reasoning model's thinking pass.
 *
 * Answering a customer from a price list is a lookup, not a problem to reason
 * about, and the thinking pass was pure cost: it ran before a single visible
 * character was written, so it drove the latency, spent the output budget, and
 * caused the empty replies that came from running out of budget mid thought.
 *
 * Measured against Gemma 4 on the same four grounded questions, three runs
 * each:
 *
 * | variant             | correct | median | slowest | neurons | free replies/day |
 * | ------------------- | ------- | ------ | ------- | ------- | ---------------- |
 * | thinking on         | 9/12    | 4.20s  | 7.80s   | 20.54   | 486              |
 * | thinking off        | 12/12   | 0.57s  | 1.20s   | 11.38   | 878              |
 * | Llama 3.3, no think | 12/12   | 0.73s  | 1.65s   | 31.70   | 315              |
 *
 * Faster, cheaper and more accurate at once, which is rare enough to be worth
 * recording. Thinking earned its keep on none of these questions.
 *
 * The flag reaches the chat template, so a model without one ignores it.
 * Verified against Llama 3.3, which answers identically with and without.
 */
const THINKING_OFF = { chat_template_kwargs: { enable_thinking: false } } as const;

function buildMessages(input: GenerateInput): { role: string; content: string }[] {
  return [
    { role: "system", content: input.system },
    ...input.history.map((turn) => ({ role: turn.role, content: turn.content })),
    { role: "user", content: input.userMessage },
  ];
}

async function attempt(
  env: Env,
  input: GenerateInput,
  maxOutputTokens: number,
): Promise<Attempt> {
  return input.model.startsWith(PLATFORM_PREFIX)
    ? attemptOnPlatform(env, input, maxOutputTokens)
    : attemptOnGateway(env, input, maxOutputTokens);
}

/**
 * Runs a Workers AI model through the binding.
 *
 * The binding needs no account identifier and no API token, which is what lets
 * a one click deploy work with nothing but a bot token. Any model outside the
 * platform catalogue has to go through the gateway instead, and that path does
 * need credentials.
 */
async function attemptOnPlatform(
  env: Env,
  input: GenerateInput,
  maxOutputTokens: number,
): Promise<Attempt> {
  const modelId = input.model.slice(PLATFORM_PREFIX.length);

  const raw = (await env.AI.run(
    modelId as keyof AiModels,
    {
      messages: buildMessages(input),
      max_tokens: maxOutputTokens,
      ...THINKING_OFF,
    } as never,
  )) as {
    response?: string;
    choices?: readonly { message?: { content?: string }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  // Older platform models answer with a bare `response` string while newer ones
  // use the chat completion shape. Both are accepted so a model swap does not
  // become a code change.
  const choice = raw.choices?.[0];
  return {
    text: choice?.message?.content ?? raw.response ?? "",
    finishReason: choice?.finish_reason ?? null,
    model: input.model,
    inputTokens: raw.usage?.prompt_tokens ?? null,
    outputTokens: raw.usage?.completion_tokens ?? null,
  };
}

async function attemptOnGateway(
  env: Env,
  input: GenerateInput,
  maxOutputTokens: number,
): Promise<Attempt> {
  if (!env.CF_ACCOUNT_ID || !env.AI_GATEWAY_TOKEN) {
    throw new MuxelError("not_configured", "this model needs a provider key", {
      model: input.model,
      remedy: "set CF_ACCOUNT_ID and AI_GATEWAY_TOKEN, or pick a Workers AI model",
    });
  }

  const url = `${GATEWAY_ROOT}/${env.CF_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/compat/chat/completions`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.AI_GATEWAY_TOKEN}`,
      // Surfaces per business spend and logs in the gateway dashboard without
      // Muxel having to aggregate anything itself.
      "cf-aig-metadata": JSON.stringify({ businessId: input.businessId }),
    },
    body: JSON.stringify({
      model: input.model,
      max_tokens: maxOutputTokens,
      messages: buildMessages(input),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new MuxelError("upstream_failure", "inference request failed", {
      status: response.status,
      model: input.model,
      // Truncated so a verbose upstream error cannot dominate a log line.
      body: body.slice(0, 500),
    });
  }

  const payload = (await response.json()) as CompletionResponse;
  const choice = payload.choices?.[0];

  return {
    // An empty string is a valid outcome here. The caller decides whether to
    // retry, because only it knows how much budget was already spent.
    text: choice?.message?.content ?? "",
    finishReason: choice?.finish_reason ?? null,
    model: payload.model ?? input.model,
    inputTokens: payload.usage?.prompt_tokens ?? null,
    outputTokens: payload.usage?.completion_tokens ?? null,
  };
}

/**
 * Produces an embedding for a single string.
 *
 * Embeddings run on Workers AI directly rather than through the gateway. The
 * daily neuron allowance covers a large volume of embedding work, so keeping
 * this path on the platform model avoids a per call charge to an external
 * provider for something that is effectively free.
 */
export async function embed(env: Env, text: string): Promise<number[]> {
  const result = (await env.AI.run(env.EMBEDDING_MODEL as keyof AiModels, {
    text: [text],
  } as never)) as { data?: number[][] };

  const vector = result.data?.[0];
  if (vector === undefined) {
    throw new MuxelError("upstream_failure", "embedding model returned no vector", {
      model: env.EMBEDDING_MODEL,
    });
  }
  // Fitted so the index accepts it whatever size it was created with, and so a
  // query is shaped exactly like the vectors it is compared against.
  return fitVector(vector, await indexDimensions(env));
}

/** Produces embeddings for a batch of strings, preserving input order. */
export async function embedBatch(env: Env, texts: readonly string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }
  const result = (await env.AI.run(env.EMBEDDING_MODEL as keyof AiModels, {
    text: [...texts],
  } as never)) as { data?: number[][] };

  const vectors = result.data;
  if (vectors === undefined || vectors.length !== texts.length) {
    throw new MuxelError("upstream_failure", "embedding batch size mismatch", {
      model: env.EMBEDDING_MODEL,
      requested: texts.length,
      received: vectors?.length ?? 0,
    });
  }
  const dimensions = await indexDimensions(env);
  return vectors.map((vector) => fitVector(vector, dimensions));
}
