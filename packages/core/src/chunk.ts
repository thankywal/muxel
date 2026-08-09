/**
 * Text segmentation for retrieval.
 *
 * Word based splitting is not portable. Burmese, Thai, Lao, Khmer, Chinese and
 * Japanese write without spaces between words, so a splitter that counts spaces
 * produces one enormous chunk for those scripts and reasonable chunks for
 * English. This implementation works on characters and prefers boundaries that
 * exist in every script it targets: blank lines first, then sentence
 * terminators, then a hard cut.
 */

/** Sentence terminators across the scripts Muxel targets. */
const SENTENCE_TERMINATORS = [
  "။", // Burmese section mark
  "၊", // Burmese little section mark
  "。", // ideographic full stop
  ".",
  "!",
  "?",
  "！", // fullwidth exclamation
  "？", // fullwidth question
];

export interface ChunkOptions {
  /** Target chunk size in characters. */
  readonly targetChars?: number;
  /** Characters repeated from the tail of the previous chunk. */
  readonly overlapChars?: number;
}

const DEFAULT_TARGET = 900;
const DEFAULT_OVERLAP = 120;

function normalise(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Finds the latest sentence boundary at or before `limit`, or -1. */
function lastBoundary(text: string, limit: number): number {
  let best = -1;
  for (const terminator of SENTENCE_TERMINATORS) {
    const index = text.lastIndexOf(terminator, limit);
    if (index > best) {
      best = index;
    }
  }
  return best;
}

/**
 * Splits text into overlapping chunks.
 *
 * Empty or whitespace only input yields an empty array rather than a single
 * blank chunk, which keeps zero length documents out of the vector index.
 */
export function chunkText(input: string, options: ChunkOptions = {}): string[] {
  const target = options.targetChars ?? DEFAULT_TARGET;
  const overlap = Math.min(options.overlapChars ?? DEFAULT_OVERLAP, Math.floor(target / 2));
  const text = normalise(input);
  if (text.length === 0) {
    return [];
  }
  if (text.length <= target) {
    return [text];
  }

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const remaining = text.length - cursor;
    if (remaining <= target) {
      const tail = text.slice(cursor).trim();
      if (tail.length > 0) {
        chunks.push(tail);
      }
      break;
    }

    const window = text.slice(cursor, cursor + target);
    // Prefer a paragraph break, then a sentence terminator, then a hard cut.
    let cut = window.lastIndexOf("\n\n");
    if (cut < target * 0.4) {
      const boundary = lastBoundary(window, window.length - 1);
      cut = boundary >= target * 0.4 ? boundary + 1 : target;
    }

    const piece = text.slice(cursor, cursor + cut).trim();
    if (piece.length > 0) {
      chunks.push(piece);
    }
    // Advance by at least one character so malformed input cannot loop forever.
    cursor += Math.max(cut - overlap, 1);
  }

  return chunks;
}
