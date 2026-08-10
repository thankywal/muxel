import { describe, expect, it } from "vitest";

import { parseProductLines } from "../src/telegram/admin.js";

describe("parseProductLines", () => {
  it("reads the pipe separated form the console asks for", () => {
    expect(parseProductLines("Latte | 3500 kyat | hot coffee")).toEqual([
      { name: "Latte", price: "3500 kyat", description: "hot coffee" },
    ]);
  });

  it("accepts a name on its own", () => {
    expect(parseProductLines("Latte")).toEqual([
      { name: "Latte", price: "", description: "" },
    ]);
  });

  it("accepts a name and price without a description", () => {
    expect(parseProductLines("Latte | 3500")).toEqual([
      { name: "Latte", price: "3500", description: "" },
    ]);
  });

  it("falls back to commas so a spreadsheet export works", () => {
    expect(parseProductLines("Americano,3000,strong")).toEqual([
      { name: "Americano", price: "3000", description: "strong" },
    ]);
  });

  it("reads many lines at once", () => {
    const parsed = parseProductLines("Latte | 3500\nAmericano | 3000\nTea | 1000");
    expect(parsed.map((item) => item.name)).toEqual(["Latte", "Americano", "Tea"]);
  });

  it("ignores blank lines", () => {
    expect(parseProductLines("\n\nLatte | 3500\n\n\n")).toHaveLength(1);
  });

  it("ignores a line with no name", () => {
    expect(parseProductLines(" | 3500 | nothing")).toEqual([]);
  });

  it("keeps commas inside a description when pipes are used", () => {
    expect(parseProductLines("Set | 9000 | coffee, cake, and juice")).toEqual([
      { name: "Set", price: "9000", description: "coffee, cake, and juice" },
    ]);
  });

  it("rejoins extra comma fields into the description", () => {
    expect(parseProductLines("Set,9000,coffee,cake")).toEqual([
      { name: "Set", price: "9000", description: "coffee, cake" },
    ]);
  });

  it("handles Burmese names and prices", () => {
    expect(parseProductLines("လက်ဖက်ရည် | ၁,၀၀၀ ကျပ်")).toEqual([
      { name: "လက်ဖက်ရည်", price: "၁,၀၀၀ ကျပ်", description: "" },
    ]);
  });

  it("caps a name that is really a paragraph", () => {
    const parsed = parseProductLines("x".repeat(500));
    expect(parsed[0]?.name).toHaveLength(120);
  });

  it("returns nothing for empty input", () => {
    expect(parseProductLines("")).toEqual([]);
    expect(parseProductLines("   \n  ")).toEqual([]);
  });
});

/**
 * The shape a PDF actually produces.
 *
 * Text lifted from a form based PDF arrives as one fragment per line, with no
 * separators anywhere. Read as a product list it turned a twelve row inventory
 * table into a hundred and forty two products called "Dairy", "12" and "-",
 * and clearing those by hand through a phone is not a repair anyone attempts.
 */
describe("parseProductLines on text that is not a product list", () => {
  const FROM_PDF = [
    "NEIGHBOURHOOD STORE",
    "12 - 12 - 2025",
    "1",
    "Dairy",
    "Whole Milk",
    "Meadow Fresh",
    "Gallon",
    "Refrigerator A",
    "2026-03-01",
    "$2.40",
  ].join("\n");

  it("refuses it rather than inventing a product per fragment", () => {
    expect(parseProductLines(FROM_PDF)).toEqual([]);
  });

  it("still refuses when a stray line happens to hold a comma", () => {
    expect(parseProductLines(`${FROM_PDF}\nRefrigerator B, top shelf`)).toEqual([]);
  });

  it("accepts a real list even when a heading has no separator", () => {
    const list = [
      "PRICE LIST",
      "Whole Milk | $2.40 | 1 gallon",
      "Greek Yogurt | $1.80 | cup",
      "Cheddar Cheese | $3.25 | block",
    ].join("\n");
    const parsed = parseProductLines(list);
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toEqual({ name: "Whole Milk", price: "$2.40", description: "1 gallon" });
  });

  it("keeps accepting a single typed name, which has no separator either", () => {
    expect(parseProductLines("Whole Milk")).toEqual([
      { name: "Whole Milk", price: "", description: "" },
    ]);
  });
});
