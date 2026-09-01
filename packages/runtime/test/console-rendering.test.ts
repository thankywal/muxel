/**
 * A message is rendered, and nothing a message contains becomes a tag.
 *
 * The model writes markdown whether or not anyone renders it, so the console
 * renders it. That means message text now reaches innerHTML, and the only thing
 * standing between a customer's words and a script tag is this: everything is
 * escaped before a single tag is added, and the only tags that come back are
 * the ones the renderer writes.
 *
 * These run the real renderer out of the real file. A regex over its source
 * would have agreed with a version that escaped nothing.
 */
import { describe, expect, it } from "vitest";
import { evaluateConsole } from "./console-harness.js";

const { md, costLine } = evaluateConsole();

describe("what a message may not become", () => {
  it("never lets markup through", () => {
    const out = md('<script>alert(1)</script> <img src=x onerror="alert(1)">');
    // The words survive; the tags do not. Every angle bracket and quote that
    // arrived in the message comes back as an entity, so what looks like an
    // attribute here is text on the page and nothing a browser acts on.
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("onerror=&quot;");
    expect(out).not.toMatch(/<script|<img src|onerror="/);
  });

  it("refuses a link that is not http or https", () => {
    // The classic one: a link label a person will click, pointing at script.
    const out = md("[click me](javascript:alert(1))");
    expect(out).not.toContain("<a");
    expect(out).toContain("click me");
  });

  it("refuses a data URL dressed as an image", () => {
    const out = md("![x](data:text/html;base64,PHNjcmlwdD4=)");
    expect(out).not.toContain("<img");
  });

  it("keeps a quote inside an attribute from ending it", () => {
    const out = md('[t](https://example.com/a"onmouseover="alert(1))');
    expect(out).not.toMatch(/href="[^"]*"\s*onmouseover/);
  });
});

describe("what a message becomes", () => {
  it("renders a heading rather than printing a hash", () => {
    expect(md("## Two are waiting")).toBe('<h4 class="md-h">Two are waiting</h4>');
  });

  it("renders emphasis rather than printing asterisks", () => {
    const out = md("**Sunrise** is *open*");
    expect(out).toContain("<strong>Sunrise</strong>");
    expect(out).toContain("<em>open</em>");
    expect(out).not.toContain("**");
  });

  it("renders a table with its header row", () => {
    const out = md("| Business | Waiting |\n| --- | --- |\n| Sunrise | 11m |");
    expect(out).toContain("<th>Business</th>");
    expect(out).toContain("<td>Sunrise</td>");
    // Wide content scrolls in its own box; the page must never scroll sideways.
    expect(out).toContain('class="md-table"');
  });

  it("keeps a fenced block exactly as written", () => {
    const out = md('```json\n{ "a": **not bold** }\n```');
    // Escaped, because it is going into HTML, and otherwise untouched: nothing
    // inside a code block is formatting, which is the point of a code block.
    expect(out).toContain("{ &quot;a&quot;: **not bold** }");
    expect(out).not.toContain("<strong>");
  });

  it("makes a list out of a list", () => {
    const out = md("- one\n- two");
    expect(out).toContain('<ul class="md-list"><li>one</li><li>two</li></ul>');
  });

  it("shows an image as an image, a document as a file, a page as a link", () => {
    expect(md("![Menu](https://x.test/menu.jpg)")).toContain("<img");
    expect(md("[r](https://x.test/receipt-8841.pdf)")).toContain("file-chip");
    expect(md("See https://muxel.site/docs")).toContain('href="https://muxel.site/docs"');
  });

  it("names a file by its own filename when the link has no text", () => {
    expect(md("https://x.test/files/receipt-8841.pdf")).toContain("receipt-8841.pdf");
  });
});

describe("what an answer cost", () => {
  const allowance = { neuronsToday: 2418, perDay: 10_000, problem: null };

  it("shows the three numbers the owner asked for", () => {
    const out = costLine({ neurons: 27, inputTokens: 2140, outputTokens: 260 }, allowance);
    expect(out).toContain("cost 27");
    expect(out).toContain("remaining 7,582");
    expect(out).toContain("total 10,000");
  });

  it("shows tokens, not a zero, when the neuron rate is not known yet", () => {
    // The first reply of the day, before Cloudflare has reported anything. A
    // zero there would read as "this one was free".
    const out = costLine({ neurons: null, inputTokens: 2140, outputTokens: 260 }, allowance);
    expect(out).toContain("cost 2,400 tokens");
    expect(out).not.toMatch(/cost 0\b/);
  });

  it("says why the neuron figures are missing rather than inventing them", () => {
    const out = costLine(
      { neurons: null, inputTokens: 10, outputTokens: 5 },
      { neuronsToday: null, perDay: 10_000, problem: "not_configured" },
    );
    expect(out).not.toContain("remaining");
    expect(out).toContain("Cloudflare read token");
  });

  it("draws nothing at all for an answer with no usage recorded", () => {
    expect(costLine(undefined, allowance)).toBe("");
  });
});
