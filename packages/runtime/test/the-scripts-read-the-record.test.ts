/**
 * The scripts judged a deployment by the words on its page.
 *
 * A deployment says what it is waiting for twice: once as a sentence on the
 * setup page, for the person reading it, and once as a list of setting names on
 * /health, for anything that has to act. All three scripts read the sentence.
 * The smoke test waited for the page to contain ADMIN_BOT_TOKEN, and the deploy
 * script decided whether a failure was permanent by matching
 * `/missing|OWNER_TELEGRAM_ID|dimensions/i` against a paragraph of prose.
 *
 * So the day a console key became the first thing a new deployment asks for,
 * the smoke test failed a correct deployment, and the deploy script stopped
 * recognising the fault it exists to report: the message about a key that is
 * too short contains none of those three words, so a build that could have been
 * named at once retried for three minutes and then said something vaguer.
 *
 * Neither script was wrong about the deployment. They were wrong about which of
 * the two answers to read. These hold them to the record: a list of names,
 * published for exactly this, which survives every rewording of the page.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { CONSOLE_KEY_MIN_LENGTH } from "../src/env.js";

const root = (name: string): string =>
  readFileSync(new URL(`../../../${name}`, import.meta.url), "utf8");

const SCRIPTS = {
  "scripts/deploy.mjs": root("scripts/deploy.mjs"),
  "scripts/install.mjs": root("scripts/install.mjs"),
  "scripts/smoke.mjs": root("scripts/smoke.mjs"),
} as const;

const deploy = SCRIPTS["scripts/deploy.mjs"];
const install = SCRIPTS["scripts/install.mjs"];
const smoke = SCRIPTS["scripts/smoke.mjs"];

/**
 * The boxes the deploy form puts in front of a new owner, read off the file
 * that decides them rather than off a list kept in step by hand.
 */
const DEPLOY_FORM = [...root(".dev.vars.example").matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(
  (match) => match[1] as string,
);

/** Every setting the Worker declares, which is the whole set that can exist. */
const DECLARED = new Set(
  [...root("packages/runtime/src/env.ts").matchAll(/readonly\s+([A-Z][A-Z0-9_]*)\??:/g)].map(
    (match) => match[1] as string,
  ),
);

/**
 * The states /health can report, read off the endpoint that reports them.
 *
 * Together with the setting names these are the record's whole vocabulary: the
 * words a script would be tempted to search a body for rather than parse.
 */
const STATUSES = [
  ...root("packages/runtime/src/index.ts")
    .split("\n")
    .filter((line) => /^\s*status:/.test(line))
    .join("\n")
    .matchAll(/"([a-z][a-z_]*)"/g),
].map((match) => match[1] as string);

/**
 * The state /health reports while a setting is still wanted.
 *
 * Taken from the branch that produces it rather than assumed, so a rename of
 * the state renames it here and a change to the shape of that line fails
 * loudly instead of quietly matching nothing.
 */
const UNCONFIGURED = (root("packages/runtime/src/index.ts")
  .split("\n")
  .find((line) => /^\s*status:.*missing/.test(line)) ?? "")
  .match(/missing\.length > 0 \?\s*"([a-z_]+)"/)?.[1];

/**
 * Inputs to a script's own run rather than settings of the deployment it
 * produces. Credentials for the account it works in, and the pair a smoke run
 * is handed when it is to prove the Telegram door as well.
 */
const SCRIPT_OWN_INPUTS = new Set([
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "SMOKE_BOT_TOKEN",
  "SMOKE_OWNER_ID",
]);

/** A setting-shaped name: capitals with at least one underscore in it. */
const SETTING = "[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+";

/**
 * The settings a script acts on: names it puts as secrets or reads from its own
 * environment. Prose and comments are left out deliberately — a script may
 * explain the history of a name it no longer touches.
 */
const settingsActedOn = (source: string): string[] => {
  const quoted = [...source.matchAll(new RegExp(`["'\`](${SETTING})["'\`]`, "g"))].map(
    (match) => match[1] as string,
  );
  const fromEnvironment = [...source.matchAll(new RegExp(`process\\.env\\.(${SETTING})`, "g"))].map(
    (match) => match[1] as string,
  );
  return [...new Set([...quoted, ...fromEnvironment])];
};

/** Every string literal a script asks a response body to contain. */
const phrasesLookedFor = (source: string): string[] =>
  [...source.matchAll(/\.includes\(\s*(["'`])((?:(?!\1).)*)\1/g)].map((match) => match[2] as string);

describe("what a script may read to decide a deployment's state", () => {
  it("never searches a body for something the record already answers", () => {
    expect(STATUSES.length, "no state was found on /health to check against").toBeGreaterThan(0);
    const vocabulary = new Set([...DECLARED, ...STATUSES]);
    for (const [name, source] of Object.entries(SCRIPTS)) {
      for (const phrase of phrasesLookedFor(source)) {
        // A word wrapped in JSON's own quotes is still that word: the smoke
        // test used to search the body for the string `"ready"` for want of
        // parsing it, and searching it for `"CONSOLE_KEY"` would be the same
        // mistake with a newer name in it.
        const asked = phrase.replaceAll('"', "");
        expect(vocabulary.has(asked), `${name} looks for ${phrase} in a response body`).toBe(false);
      }
    }
  });

  it("keeps no list of words that mean a fault will not clear", () => {
    // A regex whose branches are plain words is a keyword list spelled as a
    // pattern, and the thing it would be run against is a sentence these
    // scripts do not own. Every one of them was already out of date.
    const keywordList = /\/(?:[A-Za-z_][A-Za-z_ ]*\|)+[A-Za-z_][A-Za-z_ ]*\/[gimsuy]*/g;
    for (const [name, source] of Object.entries(SCRIPTS)) {
      expect([...source.matchAll(keywordList)].map((match) => match[0]), name).toEqual([]);
    }
  });

  it("asks the deployment what it is waiting for, and reads the answer as a list", () => {
    expect(deploy).toContain("/health");
    expect(deploy).toContain("record?.missing");
    // The decision is the length of that list, so a name nobody has thought of
    // yet is handled the same as the ones that exist today.
    expect(deploy).toContain("missing.length > 0");
  });

  it("carries the page's sentence to the operator without deciding on it", () => {
    // The note is worth printing: it is the only place a rejected bot token or
    // an unparsable owner id is explained in words. It just may not be the
    // thing that ends the retry loop.
    expect(deploy).toContain("const note = body.match(");
    expect(deploy, "the page's sentence must not decide anything").not.toMatch(
      /(?:test|exec|includes|match)\(\s*(?:note|body)\s*\)/,
    );
  });

  it("watches a real deployment leave the state it starts in", () => {
    expect(smoke).toContain("JSON.parse");
    expect(UNCONFIGURED, "the state /health reports for a missing setting has moved").toBeDefined();
    // Every one click deploy starts here, and this is the branch that used to
    // wait for the word ADMIN_BOT_TOKEN to appear on the page. It is where the
    // proof that the Worker boots at all lives, so it cannot simply be dropped
    // in favour of the states that come after it.
    expect(smoke, "a smoke run never sees an unconfigured deployment").toContain(
      `?.status === "${UNCONFIGURED}"`,
    );
    // Whatever else it names, it reads that off the record too.
    for (const status of STATUSES.filter((named) => smoke.includes(named))) {
      expect(smoke, `${status} is not read off the record`).toContain(`?.status === "${status}"`);
    }
    // And it holds the page to the same answer, by the names the record gave,
    // rather than by a phrase this script decided the page ought to use.
    expect(smoke).toMatch(/missing\.every\(\(name\) => \w+\.body\.includes\(name\)\)/);
  });
});

describe("the settings a script names", () => {
  it("acts only on settings this deployment declares", () => {
    for (const [name, source] of Object.entries(SCRIPTS)) {
      for (const setting of settingsActedOn(source)) {
        expect(
          DECLARED.has(setting) || SCRIPT_OWN_INPUTS.has(setting),
          `${name} acts on ${setting}, which the Worker does not declare`,
        ).toBe(true);
      }
    }
  });

  it("hands the hand install every box the deploy form asks for", () => {
    // The hand install is the way out of a failed one click deploy, so anything
    // the button can be given it must be able to be given too. It could set the
    // Telegram pair and nothing else, which is now the optional door.
    expect(DEPLOY_FORM.length).toBeGreaterThan(0);
    for (const setting of DEPLOY_FORM) {
      expect(install, `install.mjs never reads ${setting}`).toContain(`process.env.${setting}`);
      expect(install, `install.mjs never sets ${setting}`).toContain(`"${setting}"`);
    }
  });

  it("proves the door the deploy form asks for on a real deployment", () => {
    // A console key is a string its owner makes up, so a smoke run can make one
    // up too. Nothing else the form asks for has an excuse for being untested,
    // and the door most deployments will use was the one never exercised.
    for (const setting of DEPLOY_FORM) {
      expect(smoke, `${setting} is never set during a smoke run`).toMatch(
        new RegExp(`"secret",\\s*"put",\\s*"${setting}"`),
      );
    }
  });

  it("quotes the Worker's own minimum key length, when it quotes one at all", () => {
    const quoted = Object.entries(SCRIPTS).flatMap(([name, source]) =>
      [...source.matchAll(/at least (\d+) characters/g)].map(
        (match) => [name, Number(match[1])] as const,
      ),
    );
    expect(quoted.length, "no script tells an operator how long a key has to be").toBeGreaterThan(0);
    for (const [name, length] of quoted) {
      expect(length, `${name} quotes a length the Worker does not enforce`).toBe(
        CONSOLE_KEY_MIN_LENGTH,
      );
    }
  });
});
