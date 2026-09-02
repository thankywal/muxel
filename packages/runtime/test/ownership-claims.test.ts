/**
 * What the intro pages promise about running it and paying for it.
 *
 * The pitch is that an owner gets a business agent on their own cloud without a
 * VPS, without a machine of theirs left on, and without paying anybody for a
 * normal day's use. Each of those is checkable, so each is checked here against
 * the code that would have to be true for it.
 *
 * Both intro screens say it, word for word. The same claim written twice is two
 * places to correct and one to forget, and the one that goes stale is a promise
 * the product no longer keeps.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { FREE_ALLOWANCE } from "../src/cloudflare/usage.js";

const read = (name: string): string =>
  readFileSync(new URL(`../../console/public/${name}`, import.meta.url), "utf8");
/**
 * The two pages indent their markup differently, so every comparison here is
 * made on the words rather than on the whitespace between them.
 */
const flat = (html: string): string => html.replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
const screens = [
  ["index.html", flat(read("index.html"))],
  ["console.html", flat(read("console.html"))],
] as const;

const CLAIMS = [
  "No VPS to rent, no server to patch, no computer of yours that has to stay on.",
  "There is no Muxel account, no plan, no card and no trial that ends.",
  "Cloudflare includes 10,000 neurons a day",
];

describe("the ownership claims", () => {
  it("are on both intro screens", () => {
    for (const [name, html] of screens) {
      for (const claim of CLAIMS) expect(html, `${name}: ${claim}`).toContain(claim);
    }
  });

  it("quote the allowance the runtime actually bills against", () => {
    // Not a marketing number. It is the figure the cost line under every answer
    // counts down from, so if one moves the other has to.
    expect(FREE_ALLOWANCE.neuronsPerDay).toBe(10_000);
    for (const [name, html] of screens) {
      expect(html, name).toContain("10,000 neurons a day");
    }
  });

  it("quote a reply count that was measured, not guessed", () => {
    // The number comes from the comparison recorded in ai/gateway.ts: Gemma 4
    // with thinking off, 11.38 neurons a reply, 878 replies inside the day's
    // allowance. The page rounds it and says which model it was.
    const gateway = readFileSync(new URL("../src/ai/gateway.ts", import.meta.url), "utf8");
    expect(gateway).toContain("878");
    for (const [name, html] of screens) {
      expect(html, name).toContain("about 880 replies on Gemma 4");
    }
  });

  it("say whose bill it is past the free plan, rather than implying there is none", () => {
    // "Costs nothing" without this line would be false the day somebody is
    // busy, and they would find out from Cloudflare rather than from us.
    for (const [name, html] of screens) {
      expect(html, name).toContain("Past that the bill is Cloudflare's and not ours");
    }
  });

  it("do not claim a machine is never needed, only that none stays on", () => {
    // Somebody has to press Deploy in a browser. The true claim is that nothing
    // of theirs keeps running afterwards, and that is what is written.
    for (const [name, html] of screens) {
      expect(html, name).toContain("it is running whether your laptop is open or not");
    }
  });
});
