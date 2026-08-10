import { describe, expect, it } from "vitest";

import { toTelegramHtml } from "../src/telegram/format.js";

/**
 * Telegram renders none of Markdown, so anything the converter misses reaches
 * the customer as punctuation. The cases here are what models actually emit:
 * bullet lists, bold labels, headings, tables and code.
 */

describe("toTelegramHtml", () => {
  it("converts a product list the way a model writes one", () => {
    const answer = [
      "We sell a variety of products, including:",
      "",
      "* **Dairy:** Whole Milk, Greek Yogurt, and Cheddar Cheese",
      "* **Produce:** Oranges and Spinach",
      "* **Bakery:** Muffins",
    ].join("\n");

    expect(toTelegramHtml(answer)).toBe(
      [
        "We sell a variety of products, including:",
        "",
        "• <b>Dairy:</b> Whole Milk, Greek Yogurt, and Cheddar Cheese",
        "• <b>Produce:</b> Oranges and Spinach",
        "• <b>Bakery:</b> Muffins",
      ].join("\n"),
    );
  });

  it("leaves an ordinary sentence untouched", () => {
    expect(toTelegramHtml("We open at 9am and close at 6pm.")).toBe(
      "We open at 9am and close at 6pm.",
    );
  });

  it("escapes characters that would break the message", () => {
    expect(toTelegramHtml("Anything under < 300 ships free & fast")).toBe(
      "Anything under &lt; 300 ships free &amp; fast",
    );
  });

  it("keeps Burmese text and its bullets intact", () => {
    expect(toTelegramHtml("- ဆန် တစ်အိတ် ၅၀၀၀ ကျပ်")).toBe("• ဆန် တစ်အိတ် ၅၀၀၀ ကျပ်");
  });

  it("maps headings to bold because Telegram has no heading", () => {
    expect(toTelegramHtml("## Delivery\nWe deliver daily.")).toBe(
      "<b>Delivery</b>\nWe deliver daily.",
    );
  });

  it("indents a nested bullet with its own marker", () => {
    expect(toTelegramHtml("* Drinks\n  * Cola\n  * Water")).toBe(
      "• Drinks\n   ◦ Cola\n   ◦ Water",
    );
  });

  it("renumbers nothing but keeps ordered lists readable", () => {
    expect(toTelegramHtml("1. Order\n2. Pay\n3. Collect")).toBe("1. Order\n2. Pay\n3. Collect");
  });

  it("flattens a table into aligned rows and drops the separator", () => {
    expect(toTelegramHtml("| Item | Price |\n|------|-------|\n| Milk | 2000 |")).toBe(
      "Item  Price\nMilk  2000",
    );
  });

  it("supports italic, strikethrough and links", () => {
    expect(toTelegramHtml("*today only*, ~~5000~~ 4000, see [our page](https://example.com)")).toBe(
      '<i>today only</i>, <s>5000</s> 4000, see <a href="https://example.com">our page</a>',
    );
  });

  it("preserves code spans without touching their contents", () => {
    expect(toTelegramHtml("Use `a * b` to multiply")).toBe(
      "Use <code>a * b</code> to multiply",
    );
  });

  it("escapes inside a fenced block and leaves its markup alone", () => {
    expect(toTelegramHtml("```\nif (a < b) { **x** }\n```")).toBe(
      "<pre>if (a &lt; b) { **x** }</pre>",
    );
  });

  it("removes horizontal rules and collapses the gap they leave", () => {
    expect(toTelegramHtml("First\n\n---\n\nSecond")).toBe("First\n\nSecond");
  });

  it("emits no stray asterisk for any of these inputs", () => {
    const samples = [
      "* **Dairy:** Milk",
      "**Bold** and *italic*",
      "## Heading\n* one\n* two",
      "1. **First**\n2. *Second*",
    ];
    for (const sample of samples) {
      expect(toTelegramHtml(sample)).not.toMatch(/[*#]/);
    }
  });
});
