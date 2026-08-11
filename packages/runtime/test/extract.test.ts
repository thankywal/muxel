import { describe, expect, it } from "vitest";

import { parseExtraction } from "../src/rag/extract.js";
import { nameKey, renderOwnerUpdates, type Correction } from "../src/products.js";

/**
 * The products screen is only as truthful as this parsing. A reply the parser
 * misreads becomes a wrong catalogue with nobody to notice, so the shapes
 * models actually produce are pinned here.
 */

describe("parseExtraction", () => {
  it("reads a clean JSON array", () => {
    const items = parseExtraction('[{"name":"Whole Milk","price":"$2.40","description":"gallon"}]');
    expect(items).toEqual([{ name: "Whole Milk", price: "$2.40", description: "gallon" }]);
  });

  it("finds the array inside prose and code fences, where models put it", () => {
    const reply = 'Here are the products:\n```json\n[{"name":"Cola","price":"1500 kyat"}]\n```\nLet me know!';
    expect(parseExtraction(reply)).toEqual([{ name: "Cola", price: "1500 kyat", description: "" }]);
  });

  it("is not fooled by brackets inside strings", () => {
    const reply = '[{"name":"Rice [5kg]","price":"12,000 kyat","description":"per bag ]["}]';
    expect(parseExtraction(reply)?.[0]?.name).toBe("Rice [5kg]");
  });

  it("accepts an empty catalogue, which a policy document honestly is", () => {
    expect(parseExtraction("[]")).toEqual([]);
  });

  it("returns null for a reply with no array, rather than an empty catalogue", () => {
    // The difference matters: empty means the document offers nothing, null
    // means the extraction failed and must be recorded as failed.
    expect(parseExtraction("I could not find any products.")).toBeNull();
    expect(parseExtraction("")).toBeNull();
  });

  it("drops entries without a usable name instead of failing the batch", () => {
    const items = parseExtraction('[{"name":""},{"price":"5"},{"name":"Tea","price":"500"}]');
    expect(items).toEqual([{ name: "Tea", price: "500", description: "" }]);
  });

  it("keeps Burmese names and prices verbatim", () => {
    const items = parseExtraction('[{"name":"ဆန် တစ်အိတ်","price":"၅၀၀၀ ကျပ်"}]');
    expect(items?.[0]).toEqual({ name: "ဆန် တစ်အိတ်", price: "၅၀၀၀ ကျပ်", description: "" });
  });
});

describe("nameKey", () => {
  it("follows an item across extraction passes that render it differently", () => {
    expect(nameKey("Whole Milk ")).toBe(nameKey("whole  milk"));
  });

  it("keeps distinct items distinct", () => {
    expect(nameKey("Whole Milk")).not.toBe(nameKey("Skim Milk"));
  });
});

describe("renderOwnerUpdates", () => {
  const corrections: Correction[] = [
    { nameKey: "whole milk", name: "Whole Milk", price: "$2.50", description: "gallon", removed: false },
    { nameKey: "muffins", name: "Muffins", price: "", description: "", removed: true },
  ];

  it("renders nothing when there is nothing to say", () => {
    expect(renderOwnerUpdates([])).toBe("");
  });

  it("says the updates supersede the older documents", () => {
    // The original file still carries the old price and retrieval may surface
    // both. The material itself must say which voice wins.
    expect(renderOwnerUpdates(corrections)).toContain("supersede");
  });

  it("renders a correction as a fact and a removal as an ending", () => {
    const text = renderOwnerUpdates(corrections);
    expect(text).toContain("Whole Milk - $2.50 - gallon");
    expect(text).toContain("Muffins: no longer available.");
  });
});
