import { describe, expect, it } from "vitest";

import { toPlainText, toTelegramHtml } from "../src/telegram/format.js";

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

/**
 * The website widget prints replies as text, so a model writing **bold** or a
 * dash bulleted list puts its punctuation straight in front of a customer.
 * Same fault Telegram had, same fix, deliberately routed through the same
 * converter so the two channels cannot format one answer two ways.
 */
describe("toPlainText", () => {
  it("removes the markers a model writes and leaves the words", () => {
    expect(toPlainText("**Price** is *low*")).toBe("Price is low");
  });

  it("turns a dash list into bullets", () => {
    expect(toPlainText("- one\n- two")).toBe("• one\n• two");
  });

  it("keeps a heading as a line rather than hashes", () => {
    expect(toPlainText("## Delivery\nWe ship daily.")).toBe("Delivery\nWe ship daily.");
  });

  it("leaves no asterisk or leading dash behind", () => {
    const answer = toPlainText("### Menu\n- *Latte* 2500\n- **Mocha** 3000\n\n---\n");
    expect(answer).not.toMatch(/\*/);
    expect(answer).not.toMatch(/^\s*-\s/m);
    expect(answer).toContain("Latte 2500");
  });

  it("gives a comparison back as the model wrote it", () => {
    // The converter escapes on the way in, so this has to come back unescaped
    // rather than as &lt;.
    expect(toPlainText("price < 300 & rising")).toBe("price < 300 & rising");
  });

  it("flattens a table into readable columns", () => {
    expect(toPlainText("| Item | Price |\n| --- | --- |\n| Tea | 900 |")).toContain("Tea  900");
  });
});
