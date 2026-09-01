/**
 * The front page's demonstration says it is one.
 *
 * The whole argument of that page is that nothing about this product is hidden
 * from the person deploying it. A scripted conversation passed off as a live
 * model would be the single dishonest thing on it, so the label is not
 * decoration — it is the thing that makes the demo allowed to exist.
 *
 * These also hold that the demo cannot quietly become a page of claims the
 * product does not make: every answer is written in the page's own source, and
 * a visitor who asks something real is told so.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (name: string): string =>
  readFileSync(new URL(`../../console/public/${name}`, import.meta.url), "utf8");

/** The demonstration is one file; the intro screens only mount it. */
const page = read("demo.js");
const markup = `${read("index.html")}\n${read("console.html")}`;

describe("the demonstration", () => {
  it("says on its face that the answers are written, not generated", () => {
    // On both intro screens. A label on one of them is a label on neither.
    for (const [name, html] of [["index.html", read("index.html")], ["console.html", read("console.html")]] as const) {
      expect(html, name).toContain(">Demonstration<");
      expect(html, name).toMatch(/These answers are written, not generated/);
    }
  });

  it("is one file, so the two screens cannot drift apart", () => {
    for (const [name, html] of [["index.html", read("index.html")], ["console.html", read("console.html")]] as const) {
      expect(html, name).toContain('src="/demo.js"');
      expect(html, name).toContain('href="/demo.css"');
      expect(html, name).toContain('id="demo"');
    }
    // And no page carries its own copy of the answers.
    expect(markup).not.toContain("const SCRIPT");
  });

  it("tells a visitor who asks something real that it cannot answer", () => {
    // Rather than reaching for the nearest written answer, which is how a demo
    // starts making claims nobody wrote down.
    expect(page).toMatch(/That one I cannot answer here/);
    expect(page).toMatch(/no model behind it/);
  });

  it("only replays an answer for the exact question it was written for", () => {
    expect(page).toMatch(/SCRIPT\.find\(\(turn\) => turn\.q\.toLowerCase\(\) === asked\.toLowerCase\(\)\)/);
  });

  it("offers the deploy steps when it cannot answer", () => {
    expect(page).toMatch(/function offerDeploy/);
    expect(page).toContain("deploy.workers.cloudflare.com");
  });

  it("does nothing on a page that did not ask for it", () => {
    // app.js loads it too, and the console after pairing has no such section.
    expect(page).toMatch(/if \(document\.getElementById\("demo"\) !== null\)/);
  });

  it("gives every written question a written answer", () => {
    const script = page.slice(page.indexOf("const SCRIPT = ["), page.indexOf("const thread ="));
    const questions = script.match(/^\s*q: "/gm) ?? [];
    const answers = script.match(/^\s*a: "/gm) ?? [];
    expect(questions.length).toBeGreaterThanOrEqual(5);
    expect(answers.length).toBe(questions.length);
  });

  it("does not claim a price the product does not have", () => {
    // The free plan's daily inclusion is the one number quoted, and it is the
    // one the runtime bills against.
    expect(page).toContain("10,000 neurons a day");
    expect(page).not.toMatch(/\$\d/);
  });
});
