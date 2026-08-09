import { describe, expect, it } from "vitest";

import { stripConversionPreamble } from "../src/rag/ingest.js";

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
