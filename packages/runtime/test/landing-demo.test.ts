/**
 * The demonstration cannot be asked a question it has no answer for.
 *
 * The whole argument of these pages is that nothing about this product is
 * hidden from the person deploying it, and every answer in the demonstration is
 * written down rather than generated. What keeps that honest is not a label: it
 * is that the box does not take typing. A visitor picks from the questions
 * there are answers for, so nothing here can appear to answer a real one.
 *
 * These hold that lock, and that the demo cannot quietly become a page of
 * claims the product does not make.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (name: string): string =>
  readFileSync(new URL(`../../console/public/${name}`, import.meta.url), "utf8");

/** The demonstration is one file; the intro screens only mount it. */
const page = read("demo.js");
const screens = [
  ["index.html", read("index.html")],
  ["console.html", read("console.html")],
] as const;
const markup = screens.map(([, html]) => html).join("\n");

describe("the demonstration", () => {
  it("cannot be asked a question nobody wrote an answer for", () => {
    // This is what keeps it honest now that it is not labelled. A visitor picks
    // from the questions there are answers for. There is no field to type a
    // real one into, so nothing here can appear to answer one.
    for (const [name, html] of screens) {
      expect(html, name).not.toMatch(/<(input|textarea)[^>]*id="demo/);
      expect(html, name).toContain('class="composer-text"');
    }
    expect(page).not.toMatch(/\.value/);
  });

  it("says why, when someone clicks the box anyway", () => {
    expect(page).toMatch(/composer"\)\.addEventListener\("click", offerDeploy\)/);
    expect(page).toMatch(/only knows the answers on this page/);
    expect(page).toContain("deploy.workers.cloudflare.com");
  });

  it("answers only the question that was picked", () => {
    // By index into the same list the buttons were built from, so a button and
    // its answer cannot come apart.
    expect(page).toMatch(/const turn = SCRIPT\[index\];/);
    expect(page).toMatch(/data-ask="\$\{index\}"/);
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

  it("is one file, so the two screens cannot drift apart", () => {
    for (const [name, html] of screens) {
      expect(html, name).toContain('src="/demo.js"');
      expect(html, name).toContain('href="/demo.css"');
      expect(html, name).toContain('id="demo"');
    }
    // And no page carries its own copy of the answers.
    expect(markup).not.toContain("const SCRIPT");
  });

  it("does nothing on a page that did not ask for it", () => {
    // app.js loads it too, and the console after pairing has no such section.
    expect(page).toMatch(/if \(document\.getElementById\("demo"\) !== null\)/);
  });

  it("shows the stop square while it is writing, like the console does", () => {
    for (const [name, html] of screens) {
      expect(html, name).toContain('id="demoStop"');
    }
    expect(page).toMatch(/sendBtn\.hidden = on;/);
    expect(page).toMatch(/stopBtn\.hidden = !on;/);
  });

  it("will not start a second answer over the top of one being written", () => {
    expect(page).toMatch(/if \(answering\) return;/);
  });
});
