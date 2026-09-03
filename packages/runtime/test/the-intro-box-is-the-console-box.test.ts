/**
 * The box on the intro screen is the console's box.
 *
 * The page's whole argument is that it is the product rather than a
 * description of it, and the comment above the markup says so: "the console's
 * own composer, locked". It had drifted twice over. The steps were a list of
 * rows above the model's name, which is the shape the console had before it
 * counted them into pills under the answer; and the composer had no clip, on
 * the day the console learned to take a file.
 *
 * It is also written out twice — once on muxel.site's page and once on the
 * console's own intro — which is how it drifted in the first place. The two
 * are checked against each other here, so changing one is changing both.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (name: string) => readFileSync(new URL(`../../console/public/${name}`, import.meta.url), "utf8");
const demo = read("demo.js");
const demoCss = read("demo.css");
const app = read("app.js");

/** The composer block, with the indentation of its page taken off. */
const composer = (name: string): string => {
  const html = read(name);
  const at = html.indexOf('<div class="composer" role="button"');
  return html
    .slice(at, html.indexOf("</div>", html.indexOf('id="demoStop"')))
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
};

describe("the two intro screens", () => {
  it("carry the same box, character for character", () => {
    // Written out twice, so the only thing keeping them together is this.
    expect(composer("index.html")).toBe(composer("console.html"));
  });

  it("offer the clip, because the console's box does", () => {
    for (const name of ["index.html", "console.html"]) {
      expect(composer(name), name).toContain('class="clip"');
      // Same path the console's own icon table holds.
      expect(composer(name), name).toContain("M21.4 11.05 12.2 20.2a5 5 0 0 1-7.1-7.1");
    }
    expect(app).toContain("M21.4 11.05 12.2 20.2a5 5 0 0 1-7.1-7.1");
    expect(demoCss).toContain(".demo .clip");
  });
});

describe("what the demonstration says it did", () => {
  it("puts it under the answer, not above the model's name", () => {
    const turn = demo.slice(demo.indexOf('`<div class="turn ai">'), demo.indexOf("`,", demo.indexOf('`<div class="turn ai">')));
    expect(turn.indexOf('class="ai-body"')).toBeLessThan(turn.indexOf('class="steps"'));
    expect(turn.indexOf('class="ai-head"')).toBeLessThan(turn.indexOf('class="ai-body"'));
  });

  it("draws a pill, the way the console counts them", () => {
    expect(demo).toContain('<span class="step">');
    expect(demo).not.toContain('<div class="step">');
    expect(demoCss).toContain(".demo .steps { display: flex; flex-wrap: wrap;");
    expect(demoCss).toContain("border-radius: 999px");
  });
});
