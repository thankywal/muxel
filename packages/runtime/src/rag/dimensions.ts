/**
 * Matching embeddings to whatever the index was created with.
 *
 * A Vectorize index fixes its dimension count when it is created, and the
 * Worker configuration has no field for that: `wrangler.jsonc` can name an
 * index but not describe one. On a one click deploy the number is therefore
 * typed into a form by a person, and a wrong answer used to produce an index
 * that rejected every write.
 *
 * Rather than depend on that being right, embeddings are fitted to the index.
 * Padding with zeros is exact: cosine similarity is a ratio of a dot product to
 * two norms, and zeros change none of them, so a larger index gives identical
 * results. Truncation is lossy, so it works but is reported.
 */

import type { Env } from "../env.js";

/** Dimension count produced by the configured embedding model. */
export const MODEL_DIMENSIONS = 1024;

const DIMENSIONS_KEY = "system:index_dimensions";

/** Cached per isolate; the index cannot change dimension once created. */
let cached: number | null = null;

/**
 * Returns the dimension count the index expects.
 *
 * Falls back to the model's own size when the index cannot be read, which is
 * the right guess and keeps a transient failure from stopping an upload.
 */
export async function indexDimensions(env: Env): Promise<number> {
  if (cached !== null) {
    return cached;
  }

  const stored = await env.STATE.get(DIMENSIONS_KEY);
  const parsed = stored === null ? Number.NaN : Number(stored);
  if (Number.isInteger(parsed) && parsed > 0) {
    cached = parsed;
    return cached;
  }

  try {
    const described = (await env.KNOWLEDGE.describe()).dimensions;
    if (typeof described === "number" && described > 0) {
      await env.STATE.put(DIMENSIONS_KEY, String(described));
      cached = described;
      return cached;
    }
  } catch {
    // Reading the index is best effort. The model's own size is the sensible
    // assumption and the next call will try again.
  }

  return MODEL_DIMENSIONS;
}

/**
 * Reshapes an embedding to the length the index accepts.
 *
 * Both stored vectors and query vectors pass through here, so whatever happens
 * is applied consistently and the comparison stays meaningful.
 */
export function fitVector(vector: readonly number[], dimensions: number): number[] {
  if (vector.length === dimensions) {
    return [...vector];
  }
  if (vector.length > dimensions) {
    // Lossy. Cosine over a prefix is an approximation of the full comparison.
    return vector.slice(0, dimensions);
  }
  // Exact. Zeros contribute nothing to a dot product or to either norm.
  const padded = new Array<number>(dimensions).fill(0);
  for (let i = 0; i < vector.length; i += 1) {
    padded[i] = vector[i] as number;
  }
  return padded;
}

/**
 * Describes how well the index suits the embedding model.
 *
 * Surfaced during setup so an operator who typed the wrong number learns that
 * answers will be weaker, rather than discovering it through poor replies.
 */
export function dimensionAdvice(dimensions: number): string | null {
  if (dimensions === MODEL_DIMENSIONS) {
    return null;
  }
  if (dimensions > MODEL_DIMENSIONS) {
    return `The Vectorize index has ${dimensions} dimensions where the embedding model produces ${MODEL_DIMENSIONS}. Results are unaffected, but the index is larger than it needs to be.`;
  }
  return `The Vectorize index has ${dimensions} dimensions where the embedding model produces ${MODEL_DIMENSIONS}, so embeddings are shortened to fit and search is less accurate. For the best answers, delete the index, create it again with ${MODEL_DIMENSIONS} dimensions, and re-upload your files.`;
}
