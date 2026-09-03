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
const HEALTH_STATUS_LINE = (root("packages/runtime/src/index.ts")
  .split("\n")
  .find((line) => /^\s*status:.*missing/.test(line)) ?? "");

const UNCONFIGURED = HEALTH_STATUS_LINE.match(/missing\.length > 0 \?\s*"([a-z_]+)"/)?.[1];

/** The state /health reports once the deployment is working. */
const READY = HEALTH_STATUS_LINE.match(/configured \?\s*"([a-z_]+)"/)?.[1];

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

  it("watches a real deployment reach the state it has to reach", () => {
    expect(smoke).toContain("JSON.parse");
    // Every one click deploy used to start in not_configured, and this branch
    // waited for the word ADMIN_BOT_TOKEN to appear on the page. A deployment
    // given nothing is now ready on its first request, so the proof that the
    // Worker boots at all lives in that state instead — read off the record,
    // never off a sentence.
    expect(READY, "the state /health reports for a working deployment has moved").toBeDefined();
    expect(smoke, "a smoke run never sees a ready deployment").toContain(
      `?.status === "${READY}"`,
    );
    // Whatever else it names, it reads that off the record too.
    for (const status of STATUSES.filter((named) => smoke.includes(named))) {
      expect(smoke, `${status} is not read off the record`).toContain(`?.status === "${status}"`);
    }
    // And the page is judged by its markup, not by a phrase this script decided
    // the page ought to use: the day somebody rewords the page, a correct
    // deployment must not fail the run that exists to catch mistakes.
    const sentences = [...smoke.matchAll(/\.body\.includes\("([^"]*)"\)/g)].map(
      (match) => match[1] as string,
    );
    for (const phrase of sentences) {
      expect(phrase, `the smoke run waits for the page to say "${phrase}"`).toMatch(/^[^ ]*$/);
    }
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

  it("asks a new owner for nothing at all", () => {
    // The deploy form makes every name in this file a required field, in front
    // of somebody who has just pressed a button and has nothing to put in any
    // of them. One box was enough to stop them: it asked for a password to a
    // thing that did not exist yet. A deployment issues itself the key that
    // opens it, so the honest length of this list is zero, and a name added
    // back here is a wall put back in front of every new owner.
    expect(DEPLOY_FORM).toEqual([]);
  });

  it("still lets the hand install give every setting the Worker declares", () => {
    // The hand install is the way out of a failed one click deploy, so nothing
    // being on the form does not mean nothing can be set. These are the ones an
    // owner chooses afterwards, from a console they can already reach.
    for (const setting of ["CONSOLE_KEY", "ADMIN_BOT_TOKEN", "OWNER_TELEGRAM_ID"]) {
      expect(DECLARED.has(setting), `the Worker does not declare ${setting}`).toBe(true);
      expect(install, `install.mjs never reads ${setting}`).toContain(`process.env.${setting}`);
      expect(install, `install.mjs never sets ${setting}`).toContain(`"${setting}"`);
    }
  });

  it("proves on a real deployment the door a new owner actually walks", () => {
    // The path is: open the address, read the key off the page, sign in. It is
    // the only path most deployments will ever use and it was the one never
    // exercised, so the smoke run walks it end to end rather than setting a
    // secret no owner will set.
    expect(smoke, "the smoke run never reads the key off the page").toContain('class="key"');
    expect(smoke, "the smoke run never signs in with it").toContain('"/admin/claim"');
    // And the override, which is the only way to take a leaked key back.
    expect(smoke, "CONSOLE_KEY is never proved on a real deployment").toMatch(
      /"secret",\s*"put",\s*"CONSOLE_KEY"/,
    );
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
