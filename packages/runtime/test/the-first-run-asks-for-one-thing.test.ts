/**
 * What the instructions ask a new owner for, before they have anything.
 *
 * Setup used to refuse to finish without a Telegram bot, so every README opened
 * by sending `/newbot` twice and asking a third bot for an account id. Somebody
 * who does not use Telegram could not get past the first page of the guide to
 * their own deployment, and the guide is the whole of the guided part: there is
 * no support desk behind it and no server of ours that could have noticed.
 *
 * A deployment takes a console key now, and these hold the documents to that.
 * They ask structurally rather than by reading sentences, because four of the
 * five files are translations and a phrase pinned in English would pin only
 * English: what is checked is which section a setting is named in, in what
 * order, and whether the settings the walkthrough asks for are the settings the
 * deploy flow actually reads.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CONSOLE_KEY_MIN_LENGTH } from "../src/env.js";

const root = (name: string): string =>
  readFileSync(new URL(`../../../${name}`, import.meta.url), "utf8");

const READMES = ["README.md", "README.my.md", "README.th.md", "README.ja.md", "README.zh.md"] as const;

/**
 * The settings a deployment is asked for at the start, read off the file that
 * decides it rather than off a list somebody kept in step by hand.
 */
const ASKED_AT_SETUP = [...root(".dev.vars.example").matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(
  (match) => match[1] as string,
);

/** One `##` part of a document, and where in the document it comes. */
interface Section {
  readonly at: number;
  readonly body: string;
}

const sections = (doc: string): Section[] =>
  doc.split(/\n(?=## )/).map((body, at) => ({ at, body }));

/**
 * The section an instruction lives in, found by something the translations keep
 * verbatim — a URL, or a setting's name. Anything a translator would render in
 * their own words would find nothing in four of these five files.
 */
const holding = (doc: string, marker: string): Section => {
  const found = sections(doc).filter((section) => section.body.includes(marker));
  expect(found.length, `${marker} is in ${found.length} sections, expected exactly one`).toBe(1);
  return found[0] as Section;
};

/** Every setting a section names, in the order it names them. */
const settingsIn = (section: Section): string[] => {
  const named = [...section.body.matchAll(/`([A-Z][A-Z0-9_]{3,})`/g)].map((match) => match[1] as string);
  return named.filter((name, index) => named.indexOf(name) === index);
};

describe("the list of things to get ready first", () => {
  for (const name of READMES) {
    const doc = root(name);

    it(`asks for three things, and a console key is the third of them, in ${name}`, () => {
      const before = holding(doc, "github.com/signup");
      // The count is the section's own numbered parts rather than the sentence
      // that introduces them, so a file that says three and lists four fails
      // here rather than reading correctly and instructing wrongly.
      expect((before.body.match(/^### /gm) ?? []).length).toBe(3);
      expect(before.body).toContain("CONSOLE_KEY");
      // And it says how long it has to be, in the figure the Worker enforces.
      expect(before.body).toContain(String(CONSOLE_KEY_MIN_LENGTH));
    });

    it(`sends nobody to Telegram before they have a deployment, in ${name}`, () => {
      // This is the wall the change was made to remove. A first-run list that
      // links a chat app is asking for an account somebody may not have and
      // cannot be talked out of needing.
      const before = holding(doc, "github.com/signup");
      expect(before.body).not.toContain("t.me/");
      expect(before.body).not.toContain("ADMIN_BOT_TOKEN");
      expect(before.body).not.toContain("OWNER_TELEGRAM_ID");
    });
  }
});

describe("the walkthrough of the deploy form", () => {
  for (const name of READMES) {
    const doc = root(name);

    it(`names the settings the deploy flow reads, and no others, in ${name}`, () => {
      // .dev.vars.example is what a deployment is asked for. A walkthrough that
      // names a setting missing from there sends somebody looking for a box
      // that is not on the form, and one that omits a name leaves a box empty
      // with no explanation.
      expect(settingsIn(holding(doc, "cosine")).sort()).toEqual([...ASKED_AT_SETUP].sort());
    });

    it(`asks for the key first, as that file lists it first, in ${name}`, () => {
      // The order is the argument: one box finishes setup, and the two under it
      // are the door somebody may never want.
      expect(settingsIn(holding(doc, "cosine"))).toEqual(ASKED_AT_SETUP);
    });

    it(`still carries the two Vectorize values nothing can fill in, in ${name}`, () => {
      // They are fixed when the index is created and the Worker configuration
      // has no field for either, so these boxes arrive empty however the rest
      // of the form changes.
      const form = holding(doc, "cosine");
      expect(form.body).toContain("`1024`");
      expect(form.body).toContain("`cosine`");
    });
  }
});

describe("Telegram, as a door rather than a requirement", () => {
  for (const name of READMES) {
    const doc = root(name);

    it(`keeps the BotFather and userinfobot steps intact, in ${name}`, () => {
      // Moved, not deleted. They are still the only way to get these two
      // values, and somebody who wants Telegram still needs them exactly.
      const telegram = holding(doc, "t.me/BotFather");
      expect(telegram.body).toContain("t.me/userinfobot");
      expect(telegram.body).toContain("ADMIN_BOT_TOKEN");
      expect(telegram.body).toContain("OWNER_TELEGRAM_ID");
    });

    it(`puts them after the deployment already works, in ${name}`, () => {
      const telegram = holding(doc, "t.me/BotFather");
      expect(telegram.at).toBeGreaterThan(holding(doc, "github.com/signup").at);
      expect(telegram.at).toBeGreaterThan(holding(doc, "cosine").at);
    });
  }
});

describe("the message somebody sends to help another person set up", () => {
  const doc = root("docs/TELEGRAM-SETUP.md");
  const messages = [...doc.matchAll(/^```\n([\s\S]*?)^```/gm)].map((match) => match[1] as string);

  it("is written five times over, one per language", () => {
    expect(messages.length).toBe(5);
  });

  for (const [index, message] of messages.entries()) {
    it(`asks for the key and leaves the Telegram pair for later, in message ${index + 1}`, () => {
      // Same order as the deploy form itself, because the reader has the form
      // open in front of them while they read this.
      const named = ASKED_AT_SETUP.filter((setting) => message.includes(setting));
      expect(named).toEqual(ASKED_AT_SETUP);
      expect(message.indexOf("CONSOLE_KEY")).toBeLessThan(message.indexOf("ADMIN_BOT_TOKEN"));
    });

    it(`arrives in one piece, in message ${index + 1}`, () => {
      // Telegram splits anything longer, and half an instruction read on a
      // phone is worse than none.
      expect(message.length).toBeLessThanOrEqual(4096);
    });
  }
});

describe("the page that offers the deploy button to strangers", () => {
  const page = readFileSync(new URL("../../console/public/index.html", import.meta.url), "utf8");

  it("says what setting it up costs somebody, in the claim itself", () => {
    // The pitch is read by people deciding whether this is for them, and the
    // answer used to depend on a chat app they were never asked about.
    expect(page.replace(/\s+/g, " ")).toContain("with a key you make up and no Telegram account at all");
  });
});
