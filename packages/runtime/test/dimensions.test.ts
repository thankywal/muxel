import { describe, expect, it } from "vitest";

import { dimensionAdvice, fitVector, MODEL_DIMENSIONS } from "../src/rag/dimensions.js";

/** Cosine similarity, written out so the padding claim can be checked rather than asserted. */
function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += (a[i] as number) * (b[i] as number);
    na += (a[i] as number) ** 2;
    nb += (b[i] as number) ** 2;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

describe("fitVector", () => {
  it("returns the vector unchanged when it already fits", () => {
    expect(fitVector([1, 2, 3], 3)).toEqual([1, 2, 3]);
  });

  it("pads a short vector with zeros", () => {
    expect(fitVector([1, 2], 5)).toEqual([1, 2, 0, 0, 0]);
  });

  it("truncates a long vector", () => {
    expect(fitVector([1, 2, 3, 4], 2)).toEqual([1, 2]);
  });

  it("does not alias the input", () => {
    const original = [1, 2, 3];
    const fitted = fitVector(original, 3);
    fitted[0] = 99;
    expect(original[0]).toBe(1);
  });

  it("preserves cosine similarity exactly when padding", () => {
    // This is why a larger index costs nothing: zeros add nothing to the dot
    // product or to either norm, so the ranking is identical.
    const a = [0.2, -0.5, 0.9, 0.1];
    const b = [0.4, 0.3, -0.7, 0.6];
    const before = cosine(a, b);
    const after = cosine(fitVector(a, 16), fitVector(b, 16));
    expect(after).toBeCloseTo(before, 12);
  });

  it("handles a zero length target without throwing", () => {
    expect(fitVector([1, 2, 3], 0)).toEqual([]);
  });
});

describe("dimensionAdvice", () => {
  it("says nothing when the index matches the model", () => {
    expect(dimensionAdvice(MODEL_DIMENSIONS)).toBeNull();
  });

  it("notes wasted space when the index is larger", () => {
    const advice = dimensionAdvice(MODEL_DIMENSIONS * 2);
    expect(advice).toContain("unaffected");
  });

  it("warns about accuracy when the index is smaller", () => {
    const advice = dimensionAdvice(384);
    expect(advice).toContain("less accurate");
    expect(advice).toContain(String(MODEL_DIMENSIONS));
  });
});
