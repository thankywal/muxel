/**
 * Knowledge retrieval.
 *
 * A single Vectorize index serves the whole deployment and every business owns
 * a namespace inside it. Namespace filtering is applied before the vector
 * search, so one business cannot surface another business content even when
 * their wording overlaps.
 */

import { assertValidId, type RetrievedChunk } from "@muxel/core";

import { embed } from "../ai/gateway.js";
import { loadChunkTexts } from "../db/queries.js";
import type { Env } from "../env.js";

/** Matches below this cosine score are treated as noise and dropped. */
const MIN_SCORE = 0.35;

export interface RetrieveOptions {
  readonly topK?: number;
  readonly minScore?: number;
}

export async function retrieve(
  env: Env,
  businessId: string,
  query: string,
  options: RetrieveOptions = {},
): Promise<RetrievedChunk[]> {
  assertValidId(businessId, "businessId");
  const topK = options.topK ?? 5;
  const minScore = options.minScore ?? MIN_SCORE;

  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const vector = await embed(env, trimmed);
  const matches = await env.KNOWLEDGE.query(vector, {
    topK,
    namespace: businessId,
    returnMetadata: "none",
  });

  const scored = matches.matches.filter((match) => match.score >= minScore);
  if (scored.length === 0) {
    return [];
  }

  const texts = await loadChunkTexts(
    env,
    businessId,
    scored.map((match) => match.id),
  );

  const out: RetrievedChunk[] = [];
  for (const match of scored) {
    const record = texts.get(match.id);
    // A vector without a backing row means the document was deleted between
    // indexing and this query. Skipping keeps the reply free of dangling text.
    if (record === undefined) {
      continue;
    }
    out.push({
      id: match.id,
      businessId,
      documentId: "",
      ordinal: 0,
      text: record.text,
      score: match.score,
      source: record.filename,
    });
  }
  return out;
}

/** Renders retrieved chunks into a context block for the system prompt. */
export function formatContext(chunks: readonly RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return "";
  }
  return chunks
    .map((chunk, index) => `[${index + 1}] source: ${chunk.source}\n${chunk.text}`)
    .join("\n\n");
}
