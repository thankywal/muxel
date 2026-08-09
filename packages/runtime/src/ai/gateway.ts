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
 * Reasoning models spend most of their completion budget before emitting a
 * single visible character. Measured against Gemma 4, a reply of 133 characters
 * consumed between 366 and 566 completion tokens, and the hidden portion varied
 * from nothing to about 1,400 characters on identical input. A budget sized for
 * the visible answer alone truncates the model mid thought and yields an empty
 * reply, so the default is set well above what the answer itself needs.
 */
const DEFAULT_OUTPUT_TOKENS = 2000;

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

  const second = await attempt(env, input, budget * 2);
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

async function attempt(
  env: Env,
  input: GenerateInput,
  maxOutputTokens: number,
): Promise<Attempt> {
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
      messages: [
        { role: "system", content: input.system },
        ...input.history.map((turn) => ({ role: turn.role, content: turn.content })),
        { role: "user", content: input.userMessage },
      ],
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
  return vector;
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
  return vectors;
}
