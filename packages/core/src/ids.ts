/**
 * Identifier generation and constant time comparison.
 *
 * Identifiers use a Crockford style base32 alphabet with the ambiguous
 * characters i, l, o and u removed. The resulting strings are safe to embed in
 * Telegram callback payloads, Vectorize namespaces, R2 keys and URLs without
 * escaping.
 */

import { invalidInput } from "./errors.js";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** Characters permitted in a Muxel identifier. */
export const ID_PATTERN = /^[0-9a-hjkmnp-tv-z]+$/;

/**
 * Generates a random identifier.
 *
 * @param length Number of characters to produce. Each character carries five
 *   bits of entropy, so the default of 16 yields 80 bits.
 */
export function generateId(length = 16): string {
  if (!Number.isInteger(length) || length < 4 || length > 64) {
    throw invalidInput("identifier length must be an integer between 4 and 64", { length });
  }
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    // `bytes[i]` is always defined because the loop is bounded by the length.
    out += ALPHABET[(bytes[i] as number) % ALPHABET.length];
  }
  return out;
}

/** Generates a short identifier suitable for inline keyboard payloads. */
export function generateShortId(): string {
  return generateId(10);
}

/** Reports whether a string is a well formed Muxel identifier. */
export function isValidId(value: string): boolean {
  return value.length > 0 && value.length <= 64 && ID_PATTERN.test(value);
}

/** Throws unless the supplied value is a well formed identifier. */
export function assertValidId(value: string, field = "id"): void {
  if (!isValidId(value)) {
    throw invalidInput(`${field} is not a valid Muxel identifier`, { field, value });
  }
}

/**
 * Compares two strings without leaking their contents through timing.
 *
 * Used for bearer tokens and Telegram webhook secrets, where an early return on
 * the first differing byte would let a caller recover the expected value one
 * character at a time.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  // Comparing lengths directly is acceptable: the length of a secret is not
  // itself secret, and folding it into the accumulator below keeps the
  // per-byte loop constant with respect to content.
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= (left[i] as number) ^ (right[i] as number);
  }
  return diff === 0;
}
