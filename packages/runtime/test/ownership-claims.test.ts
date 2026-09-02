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
  "Deploying it costs nothing and asks for no card",
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
      expect(html, name).toContain("you are on Cloudflare's own pricing, in your own account");
    }
  });

  it("say what today costs, and never promise what tomorrow cannot", () => {
    // The page used to say "we have no way to charge you, because there is
    // nothing here to sign up for". True on the day it was written, and a
    // promise the moment anybody read it: a hosted tier, a support plan or a
    // paid model would all have made a liar of it, and the people who would
    // remember are the ones who chose it for that line.
    //
    // "Start at $0" is the same fact with no forecast attached. What is
    // written here can be checked today and does not bind next year.
    const forbidden = [
      "no way to charge",
      "nothing here to sign up for",
      "free forever",
      "always free",
      "no plan, no card",
      "trial that ends",
      "never charge",
      "no bill from us",
    ];
    for (const [name, html] of screens) {
      for (const promise of forbidden) {
        expect(html.toLowerCase(), `${name}: "${promise}"`).not.toContain(promise);
      }
      // The claim's own heading, not the band's: the h2 also says it, so
      // checking for the words alone would pass with the old promise still
      // sitting underneath them.
      expect(html, name).toContain("<b>Start at $0</b>");
    }
  });

  it("say what will be charged for, and that none of it is for sale yet", () => {
    // Feasibility was the question the pitch could not answer: a page that
    // says only what is free reads, to anyone deciding whether this is a
    // company, as a page that says there is no company. So the intro screens
    // say where the money will come from. In the present tense about today,
    // and about the future only as to what, never as to never.
    for (const [name, html] of screens) {
      expect(html, name).toContain("The runtime is not the thing Muxel charges for.");
      for (const line of ["verified Messenger, Instagram and WhatsApp channels",
                          "one console over many businesses for agencies",
                          "a hosted tier for owners who would rather not touch Cloudflare"]) {
        expect(html, `${name}: ${line}`).toContain(line);
      }
      // The inversion that makes the policy a policy rather than a menu: the
      // tier where we see anything is the expensive one.
      expect(html, name).toContain("the only one where we can see anything");
      // And nothing on the page may read as a price list for things that do
      // not exist. There is no billing in this codebase; the page says so.
      expect(html, name).toContain("None of that exists yet. Today there is nothing to buy.");
      expect(html, name).not.toMatch(/\$\d+\s*(\/|per)\s*(mo|month)/i);
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
