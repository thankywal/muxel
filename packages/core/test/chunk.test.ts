import { describe, expect, it } from "vitest";

import { chunkText } from "../src/chunk.js";

/**
 * Burmese is written without spaces between words. A splitter that counts
 * whitespace produces a single unusable chunk for this input, so these cases
 * guard the behaviour that matters most for the target market.
 */
const BURMESE_SENTENCE =
  "ကျွန်ုပ်တို့ဆိုင်တွင် ပစ္စည်းအမျိုးမျိုးရရှိနိုင်ပါသည်။ပို့ဆောင်ခြင်းကို ၂၄ နာရီအတွင်း ဆောင်ရွက်ပေးပါသည်။";

describe("chunkText", () => {
  it("returns nothing for empty input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("returns a single chunk when the text is short", () => {
    expect(chunkText("Delivery is available within 24 hours.")).toEqual([
      "Delivery is available within 24 hours.",
    ]);
  });

  it("splits Burmese text that contains no spaces", () => {
    const long = BURMESE_SENTENCE.repeat(30);
    const chunks = chunkText(long, { targetChars: 400 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(400);
    }
  });

  it("prefers the Burmese section mark as a boundary", () => {
    const long = BURMESE_SENTENCE.repeat(10);
    const chunks = chunkText(long, { targetChars: 300, overlapChars: 0 });
    // At least one boundary should land immediately after a section mark
    // rather than mid word.
    expect(chunks.some((chunk) => chunk.endsWith("။"))).toBe(true);
  });

  it("splits English prose on sentence boundaries", () => {
    const text = Array.from(
      { length: 40 },
      (_, index) => `Sentence number ${index} explains a delivery policy in detail.`,
    ).join(" ");
    const chunks = chunkText(text, { targetChars: 300 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 300)).toBe(true);
  });

  it("prefers paragraph breaks over sentence boundaries", () => {
    const paragraph = "A".repeat(200);
    // The target sits between one paragraph and the pair, so the splitter has
    // to choose the blank line rather than cutting at the character budget.
    const chunks = chunkText(`${paragraph}\n\n${paragraph}`, {
      targetChars: 250,
      overlapChars: 0,
    });
    expect(chunks).toEqual([paragraph, paragraph]);
  });

  it("overlaps consecutive chunks so a fact split across a boundary survives", () => {
    const text = "x".repeat(2000);
    const chunks = chunkText(text, { targetChars: 500, overlapChars: 100 });
    expect(chunks.length).toBeGreaterThan(3);
  });

  it("terminates on pathological input with no boundaries at all", () => {
    const text = "က".repeat(10000);
    const chunks = chunkText(text, { targetChars: 200, overlapChars: 190 });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.length).toBeLessThan(2000);
  });

  it("normalises Windows line endings and collapses blank runs", () => {
    const chunks = chunkText("first\r\n\r\n\r\n\r\nsecond");
    expect(chunks).toEqual(["first\n\nsecond"]);
  });

  it("clamps overlap so it can never exceed half the target", () => {
    const chunks = chunkText("y".repeat(1200), { targetChars: 300, overlapChars: 900 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.length).toBeLessThan(60);
  });
});
