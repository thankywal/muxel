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
