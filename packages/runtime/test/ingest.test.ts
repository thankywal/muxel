import { describe, expect, it, vi } from "vitest";

import { stripConversionPreamble, waitUntilSearchable } from "../src/rag/ingest.js";

/**
 * Taken from a real upload. A food inventory template converted to nothing but
 * its own properties, which were then indexed as if they were business content
 * and reported as a successful upload.
 */
const FORM_TEMPLATE_OUTPUT = `# Food-Inventory-Template-TemplateLab.com_.pdf

## Metadata

- PDFFormatVersion=1.7
- Language=en
- IsLinearized=true
- IsAcroFormPresent=true
- IsXFAPresent=false
- Author=Bratislav Milojevic
- CreationDate=D:20251212142603+01'00'
`;

describe("stripConversionPreamble", () => {
  it("leaves nothing when the file converted to properties only", () => {
    expect(stripConversionPreamble(FORM_TEMPLATE_OUTPUT)).toBe("");
  });

  it("keeps the body of a document that converted properly", () => {
    const converted = `# price-list.pdf

## Metadata

- PDFFormatVersion=1.7
- Author=Someone

## Prices

Latte costs 3500 kyat.
`;
    expect(stripConversionPreamble(converted)).toBe("## Prices\n\nLatte costs 3500 kyat.");
  });

  it("keeps a real section that happens to be called Metadata", () => {
    const converted = `# spec.md

## Metadata

Our metadata policy is to record the supplier for every item.
`;
    expect(stripConversionPreamble(converted)).toContain("supplier for every item");
  });

  it("passes through text with no preamble at all", () => {
    expect(stripConversionPreamble("Delivery is 3000 kyat.")).toBe("Delivery is 3000 kyat.");
  });

  it("does not strip a heading that is part of the content when no metadata follows", () => {
    const converted = "# Opening hours\n\nWe open at nine.";
    // The first heading is always the file name in converter output, so it goes.
    expect(stripConversionPreamble(converted)).toBe("We open at nine.");
  });

  it("handles an empty conversion", () => {
    expect(stripConversionPreamble("")).toBe("");
    expect(stripConversionPreamble("\n\n  \n")).toBe("");
  });

  it("keeps Burmese content intact", () => {
    const converted = `# menu.pdf

## Metadata

- Author=Shop

လက်ဖက်ရည် တစ်ခွက် ၁,၀၀၀ ကျပ်ဖြစ်ပါသည်။
`;
    expect(stripConversionPreamble(converted)).toBe("လက်ဖက်ရည် တစ်ခွက် ၁,၀၀၀ ကျပ်ဖြစ်ပါသည်။");
  });
});

/**
 * The index accepts a write and answers queries about it a little later.
 * Measured against a live Vectorize index, a new vector became findable after
 * about twenty seconds. For that window a document is stored and unfindable at
 * once, which is exactly when an operator uploads a price list and tests it, so
 * the console has to know which of the two states it is in.
 */
describe("waiting for the index", () => {
  it("reports searchable once the written vector comes back", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ matches: [] })
      .mockResolvedValueOnce({ matches: [{ id: "chunk-1", score: 1 }] });

    const result = await waitUntilSearchable(
      { KNOWLEDGE: { query } } as never,
      "biz",
      { id: "chunk-1", values: [0.1] },
      60,
      10,
    );

    expect(result).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("gives up rather than spending the whole invocation waiting", async () => {
    const query = vi.fn().mockResolvedValue({ matches: [] });

    const result = await waitUntilSearchable(
      { KNOWLEDGE: { query } } as never,
      "biz",
      { id: "chunk-1", values: [0.1] },
      60,
      10,
    );

    expect(result).toBe(false);
  });

  it("treats an index that refuses the query as not ready yet", async () => {
    const query = vi.fn().mockRejectedValue(new Error("index not ready"));

    await expect(
      waitUntilSearchable({ KNOWLEDGE: { query } } as never, "biz", {
        id: "chunk-1",
        values: [0.1],
      }, 60, 10),
    ).resolves.toBe(false);
  });

  it("does not mistake another chunk of the same document for the one written", async () => {
    const query = vi.fn().mockResolvedValue({ matches: [{ id: "chunk-2", score: 1 }] });

    await expect(
      waitUntilSearchable({ KNOWLEDGE: { query } } as never, "biz", {
        id: "chunk-1",
        values: [0.1],
      }, 60, 10),
    ).resolves.toBe(false);
  });
});
