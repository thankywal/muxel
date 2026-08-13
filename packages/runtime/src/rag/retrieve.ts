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

/**
 * Whether anything a business has uploaded is findable yet.
 *
 * Vectorize accepts a write and makes it searchable a little later, so a
 * document can be stored and invisible at the same time. The console offers to
 * check on demand rather than leaving the operator to guess, and this is that
 * check: it asks the index the same way retrieval does, and cares only that
 * something comes back at all. Score is deliberately ignored, because the
 * question is whether the index has caught up, not whether a particular
 * question can be answered.
 */
export async function knowledgeReady(env: Env, businessId: string): Promise<boolean> {
  assertValidId(businessId, "businessId");
  try {
    const vector = await embed(env, "product price list");
    const matches = await env.KNOWLEDGE.query(vector, {
      topK: 1,
      namespace: businessId,
      returnMetadata: "none",
    });
    return matches.matches.length > 0;
  } catch {
    // An index that cannot be queried yet is exactly the state being asked
    // about, and reads as not ready rather than as a fault.
    return false;
  }
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
