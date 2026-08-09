import { describe, expect, it } from "vitest";

import { assertValidId, generateId, generateShortId, isValidId, timingSafeEqual } from "../src/ids.js";

describe("generateId", () => {
  it("produces the requested length", () => {
    expect(generateId(16)).toHaveLength(16);
    expect(generateShortId()).toHaveLength(10);
  });

  it("omits characters that are easily confused when read aloud", () => {
    const sample = Array.from({ length: 200 }, () => generateId(32)).join("");
    expect(sample).not.toMatch(/[ilou]/);
  });

  it("produces identifiers that validate", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(isValidId(generateId())).toBe(true);
    }
  });

  it("does not collide across a large sample", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i += 1) {
      seen.add(generateId());
    }
    expect(seen.size).toBe(5000);
  });

  it("rejects out of range lengths", () => {
    expect(() => generateId(3)).toThrowError(/between 4 and 64/);
    expect(() => generateId(65)).toThrowError(/between 4 and 64/);
  });
});

describe("isValidId", () => {
  it("rejects separators used by the callback codec", () => {
    expect(isValidId("abc:def")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidId("")).toBe(false);
  });

  it("rejects ambiguous characters", () => {
    expect(isValidId("hello")).toBe(false);
  });

  it("reports the offending field when asserting", () => {
    expect(() => assertValidId("bad:id", "businessId")).toThrowError(/businessId/);
  });
});

describe("timingSafeEqual", () => {
  it("accepts identical strings", () => {
    expect(timingSafeEqual("s3cret-token", "s3cret-token")).toBe(true);
  });

  it("rejects differing strings of equal length", () => {
    expect(timingSafeEqual("aaaaaaaa", "aaaaaaab")).toBe(false);
  });

  it("rejects strings of differing length", () => {
    expect(timingSafeEqual("short", "much longer value")).toBe(false);
  });

  it("compares by encoded bytes rather than code units", () => {
    expect(timingSafeEqual("မြန်မာ", "မြန်မာ")).toBe(true);
    expect(timingSafeEqual("မြန်မာ", "မြန်မာ့")).toBe(false);
  });
});
