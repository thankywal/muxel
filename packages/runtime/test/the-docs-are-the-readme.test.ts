/**
 * The guide the console links to is the README, rendered.
 *
 * The console's footer said "Docs" and sent people to the product page, which
 * has no docs on it. There is a guide — the README, in five languages, held to
 * the deploy form by other tests — and it was only on GitHub. Rather than a
 * second guide that would drift from the first, app.muxel.site/docs renders
 * the first. These hold the render to the README, and the links to the render.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error the console is plain JavaScript outside the workspace, typed by nothing.
import { fileFor, LANGS, PAGES, renderGuide, rewriteHref, slug } from "../../console/guide.mjs";

const root = (name: string): string => readFileSync(new URL(`../../../${name}`, import.meta.url), "utf8");
const consoleFile = (name: string): string =>
  readFileSync(new URL(`../../console/${name}`, import.meta.url), "utf8");

const README = root("README.md");

describe("the links that promise a guide", () => {
  it("send the console's footer to /docs, on this site", () => {
    const app = consoleFile("public/app.js");
    const footer = app.slice(app.indexOf("<footer>"), app.indexOf("</footer>"));
    expect(footer).toMatch(/href="\/docs"[^>]*>Docs</);
    // The product page is not a guide, and this is where "Docs" used to go.
    expect(footer).not.toContain('href="https://muxel.site"');
  });

  it("send the product page's guide link there too", () => {
    const index = consoleFile("public/index.html");
    expect(index).toContain('href="https://app.muxel.site/docs"');
    expect(index).not.toContain("docs/TELEGRAM-SETUP.md");
  });

  it("are served by the console, which reads the README beside it", () => {
    const server = consoleFile("server.mjs");
    expect(server).toContain('"/docs/:key"');
    expect(server).toContain('import { fileFor, renderGuide } from "./guide.mjs"');
    // deploy.sh carries what the render needs, or the route reads nothing.
    const deploy = consoleFile("deploy.sh");
    for (const needed of ['"$HERE/guide.mjs"', "README.md", "README.*.md", "DEPLOY-RECOVERY.md", "TELEGRAM-SETUP.md", "docs/media/"]) {
      expect(deploy, `deploy.sh does not carry ${needed}`).toContain(needed);
    }
  });
});

describe("the render of the README", () => {
  const { html, sections } = renderGuide({ markdown: README, key: "en" }) as {
    html: string;
    sections: { id: string; text: string }[];
  };

  it("has every section the README has, in order, as the page's own navigation", () => {
    const headings = [...README.matchAll(/^## (.+)$/gm)].map((m) => (m[1] as string).trim());
    expect(sections.map((s) => s.text)).toEqual(headings);
    for (const s of sections) {
      expect(html).toContain(`<h2 id="${s.id}">`);
      expect(html).toContain(`href="#${s.id}"`);
    }
  });

  it("lands the README's own in-page links where GitHub lands them", () => {
    // The README links to its own sections. Those ids are made the way GitHub
    // makes them, so the same link works in both places.
    const anchors = [...README.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1] as string);
    expect(anchors.length).toBeGreaterThan(0);
    for (const id of anchors) expect(html, `#${id} has nowhere to land`).toContain(`id="${id}"`);
    expect(slug("Telegram, if you want it")).toBe("telegram-if-you-want-it");
    expect(slug("Before you start")).toBe("before-you-start");
  });

  it("keeps a Burmese or Thai heading whole in its id", () => {
    // Vowel signs and tone marks are marks, not letters. An id that kept only
    // the letters read ဘယလ-မငရသလ for ဘယ်လို မြင်ရသလဲ, a different word.
    expect(slug("ဘယ်လို မြင်ရသလဲ")).toBe("ဘယ်လို-မြင်ရသလဲ");
    expect(slug("ก่อนเริ่มต้น")).toBe("ก่อนเริ่มต้น");
    expect(slug("始める前に")).toBe("始める前に");
  });

  it("shows the README's images from this site", () => {
    const images = [...README.matchAll(/docs\/media\/([\w.-]+)/g)].map((m) => m[1] as string);
    expect(images.length).toBeGreaterThan(0);
    for (const file of new Set(images)) expect(html).toContain(`/docs/media/${file}`);
    expect(html).not.toMatch(/src="docs\//);
    expect(html).not.toMatch(/href="docs\//);
  });

  it("turns the other languages and the two documents into pages here", () => {
    expect(rewriteHref("README.my.md")).toBe("/docs/my");
    expect(rewriteHref("README.md")).toBe("/docs");
    expect(rewriteHref("docs/DEPLOY-RECOVERY.md")).toBe("/docs/deploy-recovery");
    expect(rewriteHref("docs/TELEGRAM-SETUP.md")).toBe("/docs/telegram-setup");
    expect(rewriteHref("docs/DEPLOY-RECOVERY.md#hello-world")).toBe("/docs/deploy-recovery#hello-world");
    // The rest of the repository is read where it lives.
    expect(rewriteHref("LICENSE")).toBe("https://github.com/thankywal/muxel/blob/main/LICENSE");
    expect(rewriteHref("SECURITY.md")).toBe("https://github.com/thankywal/muxel/blob/main/SECURITY.md");
    // Absolute and in-page links are not touched.
    expect(rewriteHref("https://app.muxel.site")).toBe("https://app.muxel.site");
    expect(rewriteHref("#the-console")).toBe("#the-console");
    for (const target of ["/docs/my", "/docs/th", "/docs/ja", "/docs/zh", "/docs/deploy-recovery", "/docs/telegram-setup"]) {
      expect(html).toContain(`href="${target}"`);
    }
  });

  it("keeps the deploy button and the collapsible sections", () => {
    expect(html).toContain("deploy.workers.cloudflare.com/?url=https://github.com/thankywal/muxel");
    expect(html).toContain("<details>");
  });
});

describe("every language and both documents", () => {
  const keys = [...Object.keys(LANGS as Record<string, string>), ...Object.keys(PAGES as Record<string, unknown>)];
  for (const key of keys) {
    it(`renders ${key} from the file deploy.sh carries, with sections to navigate`, () => {
      const file = fileFor(key) as string;
      const markdown = root(file.startsWith("README") ? file : `docs/${file}`);
      const { html, sections } = renderGuide({ markdown, key }) as {
        html: string;
        sections: { id: string; text: string }[];
      };
      expect(sections.length).toBeGreaterThan(2);
      expect(html).toContain(`<html lang="${key in (LANGS as object) ? key : "en"}">`);
      expect(html).not.toMatch(/src="docs\//);
      // Every entry in the navigation lands on a heading, whatever the script.
      for (const s of sections) {
        expect(s.id.length, `${s.text} has no id`).toBeGreaterThan(0);
        expect(html).toContain(`<h2 id="${s.id}">`);
      }
    });
  }

  it("knows nothing else", () => {
    expect(fileFor("nope")).toBeNull();
    expect(fileFor("../server.mjs")).toBeNull();
  });
});
