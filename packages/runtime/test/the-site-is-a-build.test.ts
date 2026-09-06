/**
 * The site is files, and one build writes all of them.
 *
 * It used to be a process on a VPS: it served the console's files, rendered the
 * guide from the README on request, and chose between the product page and the
 * console by hostname. That machine was the last thing in Muxel's own path an
 * owner had to trust for a page that, by design, talks only to their own
 * Worker. The same site is now written out once and served by GitHub Pages.
 *
 * These read the site the build actually wrote rather than reading the build
 * script and taking its word for it, because the failure worth catching is a
 * page that is missing or a link that points where the site is not.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error the build is plain JavaScript, typed by nothing.
import { buildSite, missedRoots, normalizeBase, withBase } from "../../../scripts/build-site.mjs";
// @ts-expect-error the console is plain JavaScript outside the workspace, typed by nothing.
import { LANGS, PAGES } from "../../console/guide.mjs";

const out = mkdtempSync(join(tmpdir(), "muxel-site-"));
afterAll(() => rmSync(out, { recursive: true, force: true }));

const BASE = "/muxel/";
const built = (await buildSite({ base: BASE, out })) as {
  base: string;
  out: string;
  pages: string[];
  rewritten: string[];
};
const file = (name: string): string => readFileSync(join(out, name), "utf8");

describe("where the site thinks it lives", () => {
  it("reads the same base path out of every shape GitHub gives it", () => {
    // A project site reports "/muxel"; a custom domain reports "".
    expect(normalizeBase("/muxel")).toBe("/muxel/");
    expect(normalizeBase("muxel")).toBe("/muxel/");
    expect(normalizeBase("/muxel/")).toBe("/muxel/");
    expect(normalizeBase("")).toBe("/");
    expect(normalizeBase("/")).toBe("/");
  });

  it("moves the site's own URLs and leaves everyone else's alone", () => {
    const roots = new Set(["docs", "app.js"]);
    expect(withBase('href="/docs"', BASE, roots)).toBe('href="/muxel/docs"');
    expect(withBase('src="/app.js"', BASE, roots)).toBe('src="/muxel/app.js"');
    // Not ours: another site's path, and a regular expression.
    expect(withBase('href="/elsewhere"', BASE, roots)).toBe('href="/elsewhere"');
    expect(withBase("text.replace(/docs/g, x)", BASE, roots)).toBe("text.replace(/docs/g, x)");
    // At the root the rewrite is the identity, so one build serves both hosts.
    expect(withBase('href="/docs"', "/", roots)).toBe('href="/docs"');
  });

  it("finds a URL that was left at the root", () => {
    const roots = new Set(["notice.json"]);
    expect(missedRoots('fetch("/notice.json")', roots)).toEqual(["notice.json"]);
    expect(missedRoots('fetch("/muxel/notice.json")', roots)).toEqual([]);
  });
});

describe("what the build writes", () => {
  it("has the product page, the console and the guide in every language", () => {
    const expected = [
      "index.html",
      "console/index.html",
      "docs/index.html",
      ...Object.keys(LANGS as Record<string, string>)
        .filter((key) => key !== "en")
        .map((key) => `docs/${key}/index.html`),
      ...Object.keys(PAGES as Record<string, unknown>).map((key) => `docs/${key}/index.html`),
      "404.html",
    ];
    expect([...built.pages].sort()).toEqual([...expected].sort());
  });

  it("carries the console's own files, so nothing it fetches has to be listed here", () => {
    // The notice the console polls travels because the whole directory does.
    expect(() => file("notice.json")).not.toThrow();
    expect(() => file("app.js")).not.toThrow();
    expect(() => file("app.css")).not.toThrow();
    expect(() => file("assets/logo.png")).not.toThrow();
    // The README's pictures, where the rendered README looks for them.
    expect(() => file("docs/media/assistant.webp")).not.toThrow();
  });

  it("answers an unknown path with the page that says what this is", () => {
    expect(file("404.html")).toBe(file("index.html"));
  });

  it("keeps Jekyll from taking a turn at it", () => {
    expect(() => file(".nojekyll")).not.toThrow();
  });
});

describe("every link the site makes to itself", () => {
  it("goes through the base path, in the pages and in the files they load", () => {
    for (const where of [...built.pages, ...built.rewritten]) {
      const roots = new Set([
        "index.html",
        "console",
        "docs",
        "app.js",
        "app.css",
        "demo.js",
        "demo.css",
        "styles.css",
        "notice.json",
        "assets",
      ]);
      expect(missedRoots(file(where), roots), `${where} points at the root`).toEqual([]);
    }
  });

  it("sends the product page to the console and the guide on this site", () => {
    const index = file("index.html");
    expect(index).toContain('href="/muxel/console/"');
    expect(index).toContain('href="/muxel/docs"');
    // The console used to be a hostname away, on a machine of ours.
    expect(index).not.toContain("app.muxel.site");
  });

  it("sends the console's footer to the guide", () => {
    expect(file("app.js")).toMatch(/href="\/muxel\/docs"[^>]*>Docs</);
  });

  it("sends the guide's own header to the console and to GitHub", () => {
    const guide = file("docs/index.html");
    // The header only: the README's own prose is rendered below it verbatim,
    // and what it says is the README's business, not this page's.
    const header = guide.slice(guide.indexOf("<header>"), guide.indexOf("</header>"));
    expect(header).toContain('href="/muxel/console/"');
    expect(header).toContain("https://github.com/thankywal/muxel");
    expect(header).not.toContain("app.muxel.site");
  });
});

describe("the guide is the README", () => {
  it("renders each language from the README of that language", () => {
    // A heading that only the English README has, and one only the Burmese has.
    expect(file("docs/index.html")).toContain("Before you start");
    expect(file("docs/my/index.html")).toContain('<html lang="my">');
    expect(file("docs/index.html")).toContain('<html lang="en">');
  });

  it("keeps the deploy button, which is the whole point of the page", () => {
    expect(file("docs/index.html")).toContain(
      "deploy.workers.cloudflare.com/?url=https://github.com/thankywal/muxel",
    );
  });
});
