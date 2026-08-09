import { describe, expect, it } from "vitest";

import { EXTRACT_EVERY_MESSAGES, parseFacts, shouldExtract } from "../src/memory.js";

/**
 * The extraction model is the same reasoning model that answers customers, so
 * its output arrives wrapped in prose, fenced blocks and thinking. These cases
 * cover the shapes actually observed rather than the ideal one.
 */
describe("parseFacts", () => {
  it("reads a bare array", () => {
    expect(parseFacts('["Bought an iPhone 15", "Pays with KBZPay"]')).toEqual([
      "Bought an iPhone 15",
      "Pays with KBZPay",
    ]);
  });

  it("finds the array inside surrounding prose", () => {
    const reply = 'Here is what I found:\n\n["Lives in Yangon"]\n\nLet me know if you need more.';
    expect(parseFacts(reply)).toEqual(["Lives in Yangon"]);
  });

  it("finds the array inside a fenced block", () => {
    expect(parseFacts('```json\n["Prefers weekend delivery"]\n```')).toEqual([
      "Prefers weekend delivery",
    ]);
  });

  it("returns nothing for an empty array", () => {
    expect(parseFacts("[]")).toEqual([]);
  });

  it("returns nothing when there is no array at all", () => {
    expect(parseFacts("I could not find any durable facts.")).toEqual([]);
  });

  it("returns nothing for malformed json rather than throwing", () => {
    expect(parseFacts('["unterminated}')).toEqual([]);
  });

  it("drops entries that are not strings", () => {
    expect(parseFacts('["kept", 42, null, {"a":1}, "also kept"]')).toEqual(["kept", "also kept"]);
  });

  it("drops blank entries", () => {
    expect(parseFacts('["", "   ", "real"]')).toEqual(["real"]);
  });

  it("truncates a fact that is really a summary", () => {
    const long = "x".repeat(400);
    const parsed = parseFacts(JSON.stringify([long]));
    expect(parsed[0]).toHaveLength(160);
  });

  it("caps how many facts one pass can add", () => {
    const many = Array.from({ length: 30 }, (_, index) => `fact ${index}`);
    expect(parseFacts(JSON.stringify(many))).toHaveLength(6);
  });

  it("keeps Burmese text intact", () => {
    expect(parseFacts('["ရန်ကုန်မှာ နေတယ်"]')).toEqual(["ရန်ကုန်မှာ နေတယ်"]);
  });

  it("uses the last closing bracket so trailing prose cannot truncate it", () => {
    expect(parseFacts('["a", "b"] and that is all [done]')).toEqual(["a", "b"]);
  });
});

describe("shouldExtract", () => {
  it("does not run on the first message", () => {
    expect(shouldExtract(1)).toBe(false);
  });

  it("runs on the interval", () => {
    expect(shouldExtract(EXTRACT_EVERY_MESSAGES)).toBe(true);
    expect(shouldExtract(EXTRACT_EVERY_MESSAGES * 3)).toBe(true);
  });

  it("does not run between intervals", () => {
    expect(shouldExtract(EXTRACT_EVERY_MESSAGES + 1)).toBe(false);
  });

  it("does not run for a customer with no messages", () => {
    expect(shouldExtract(0)).toBe(false);
  });
});

describe("parseFacts bracket scanning", () => {
  it("is not confused by a bracket inside a fact", () => {
    expect(parseFacts('["ordered [2] cases"]')).toEqual(["ordered [2] cases"]);
  });

  it("is not confused by an escaped quote inside a fact", () => {
    expect(parseFacts('["said \\"later\\" twice"]')).toEqual(['said "later" twice']);
  });

  it("returns nothing when the array is never closed", () => {
    expect(parseFacts('["a", "b"')).toEqual([]);
  });
});
