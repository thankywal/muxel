/**
 * What the answer was built from, and the order the owner reads it in.
 *
 * Asked to add six prices, the console showed ten identical rows of "Proposed
 * a price" stacked above an answer that had not arrived, and then the answer.
 * That is a log printed before its subject. Two things were wrong with it.
 *
 * The same tool called ten times is one thing that happened ten times, so it
 * is one pill with a count, and the pills sit under the answer they explain.
 *
 * And the model had said what it was about to do before doing it, every round,
 * and the loop overwrote that with the next round's text. Kept, the turn reads
 * in the order it happened: what it understood, then the work, then what came
 * of it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { evaluateConsole } from "./console-harness.js";

const loop = readFileSync(new URL("../src/assistant/loop.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../../console/public/app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../../console/public/app.css", import.meta.url), "utf8");
const { stepPills } = evaluateConsole();

const step = (tool: string, ok = true) => ({ tool, ok });

describe("what the answer was built from", () => {
  it("is one pill per tool, carrying how many times it ran", () => {
    const html = stepPills([
      step("get_business"),
      ...Array.from({ length: 6 }, () => step("save_price")),
    ]);
    expect((html.match(/class="step /g) ?? []).length).toBe(2);
    expect(html).toContain("Read a business");
    expect(html).toContain("Proposed a price");
    expect(html).toContain("<b>6</b>");
    // The one that ran once carries no count: "x1" is noise.
    expect(html).not.toContain("<b>1</b>");
  });

  it("keeps a failure apart from a success of the same tool", () => {
    // Nine that worked and one that did not are two different things to know.
    const html = stepPills([step("save_price"), step("save_price"), step("save_price", false)]);
    expect((html.match(/class="step /g) ?? []).length).toBe(2);
    expect(html).toContain('class="step bad"');
    expect(html).toContain("<b>2</b>");
  });

  it("is in the order each tool was first called", () => {
    const html = stepPills([step("save_price"), step("get_business"), step("save_price")]);
    expect(html.indexOf("Proposed a price")).toBeLessThan(html.indexOf("Read a business"));
  });

  it("is nothing at all when nothing ran", () => {
    expect(stepPills([])).toBe("");
    expect(css).toContain(".steps:empty { display: none; }");
  });

  it("sits under the answer, in the settled turn and in the live one", () => {
    const settled = app.slice(app.indexOf("function turnHtml"), app.indexOf("\n}\n", app.indexOf("function turnHtml")));
    expect(settled.indexOf('<div class="ai-body">')).toBeLessThan(settled.indexOf('<div class="steps">'));
    // Searched from the start of the block: drawAssistant scrolls the thread
    // too, and slicing to the first match found a marker that comes earlier in
    // the file, which made the slice empty and the assertion vacuous.
    const liveFrom = app.indexOf('<div class="turn ai" id="asThinking">');
    const live = app.slice(liveFrom, app.indexOf("thread.scrollTop = thread.scrollHeight;", liveFrom));
    expect(live.length).toBeGreaterThan(80);
    expect(live.indexOf('class="ai-body thinking"')).toBeLessThan(live.indexOf('<div class="steps">'));
  });

  it("is drawn again from the list while it streams, not appended to", () => {
    // A pill carries a count, and a count cannot be appended to.
    const handler = app.slice(app.indexOf('if (event.type === "step")'), app.indexOf("scrollThread();", app.indexOf('if (event.type === "step")')));
    expect(handler).toMatch(/turn\.__steps = \[\.\.\.\(turn\.__steps \?\? \[\]\), \{ tool: event\.tool, ok: event\.ok \}\]/);
    expect(handler).toMatch(/innerHTML = stepPills\(turn\.__steps\)/);
    expect(app).not.toContain("stepLine(");
  });
});

describe("what the model said on its way to the tools", () => {
  it("is kept from the first round that also called something", () => {
    expect(loop).toMatch(/if \(text\.length > 0 && turn\.toolCalls\.length > 0 && lead\.length === 0\) lead = text;/);
  });

  it("is put before the final answer, not instead of it", () => {
    expect(loop).toMatch(/const said = lead\.length > 0 && lead !== text \? `\$\{lead\}\\n\\n\$\{text\}` : text;/);
    expect(loop).toMatch(/return \{\n    text: said,/);
  });

  it("is dropped when the answer is the same words", () => {
    // A model that says its plan and then repeats it as the summary would
    // otherwise be printed twice.
    expect(loop).toContain("lead !== text");
  });
});
