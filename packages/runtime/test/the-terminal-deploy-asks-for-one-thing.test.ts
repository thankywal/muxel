/**
 * What somebody installing from a terminal is made to have.
 *
 * The browser flow stopped demanding a Telegram bot; `muxel init` went on
 * demanding one. `--owner-telegram-id` was a required flag, so a person with no
 * Telegram account could deploy from the dashboard and not from a command line,
 * which is the same wall moved rather than removed — and the console they would
 * have reached is the same console either way.
 *
 * Held here: a key on its own is a whole deployment, the Telegram pair on its
 * own is a whole deployment, giving neither is the only refusal, and whichever
 * door is passed over leaves no half written secret behind it. The recovery
 * document is held to the answer that actually gets a locked out owner back in,
 * which is a setting they can change rather than an install they have to redo.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isMuxelError } from "@muxel/core";

import { consoleDoors, secretsFor, type ConsoleDoors } from "../../cli/src/commands/init.js";
import { CONSOLE_KEY_MIN_LENGTH } from "../src/env.js";

const KEY = "a-phrase-i-can-type-again";
const TOKEN = "1234567:AAHfake-console-bot-token";
const OWNER = "884422";

/** The rest of what an upload carries, none of which is a door. */
const EXTRAS = { masterKey: "bWFzdGVyLWtleQ==", accountId: "acc-1" };

const namesOf = (doors: ConsoleDoors): string[] =>
  secretsFor(doors, EXTRAS).map(([name]) => name);

/** The error a call threw, or a failure saying it threw nothing. */
const refusal = (call: () => unknown): { code: string; message: string } => {
  try {
    call();
  } catch (error) {
    expect(isMuxelError(error)).toBe(true);
    return isMuxelError(error)
      ? { code: error.code, message: error.message }
      : { code: "", message: "" };
  }
  expect.unreachable("expected the command to refuse");
};

describe("the doors muxel init will open", () => {
  it("finishes on a console key, with no Telegram account anywhere in it", () => {
    const doors = consoleDoors({ consoleKey: KEY });
    expect(doors.consoleKey).toBe(KEY);
    expect(doors.telegram).toBeNull();
    expect(namesOf(doors)).toEqual(["MASTER_KEY", "CONSOLE_KEY"]);
  });

  it("finishes on the Telegram pair, which is still a whole deployment", () => {
    const doors = consoleDoors({ adminBotToken: TOKEN, ownerTelegramId: OWNER });
    expect(doors.consoleKey).toBeNull();
    expect(doors.telegram).toEqual({ adminBotToken: TOKEN, ownerTelegramId: OWNER });
    expect(namesOf(doors)).toEqual(["MASTER_KEY", "ADMIN_BOT_TOKEN", "OWNER_TELEGRAM_ID"]);
  });

  it("takes both, because neither excludes the other", () => {
    const doors = consoleDoors({ consoleKey: KEY, adminBotToken: TOKEN, ownerTelegramId: OWNER });
    expect(namesOf(doors)).toEqual([
      "MASTER_KEY",
      "CONSOLE_KEY",
      "ADMIN_BOT_TOKEN",
      "OWNER_TELEGRAM_ID",
    ]);
  });

  it("refuses only when there is no door at all, and says both ways in", () => {
    const refused = refusal(() => consoleDoors({}));
    expect(refused.code).toBe("invalid_input");
    // Both, in the same breath. Naming one of them turns a choice back into a
    // requirement, which is the thing this whole change was about.
    for (const flag of ["--console-key", "--admin-bot-token", "--owner-telegram-id"]) {
      expect(refused.message, flag).toContain(flag);
    }
  });

  it("reads a flag the shell expanded to nothing as a flag that was not given", () => {
    // `--console-key "$KEY"` with KEY unset is somebody who gave no key, and
    // the answer they need is the one above, not a deployment holding a secret
    // that is the empty string.
    expect(refusal(() => consoleDoors({ consoleKey: "   " })).code).toBe("invalid_input");
    expect(consoleDoors({ consoleKey: KEY, adminBotToken: "", ownerTelegramId: "" }).telegram)
      .toBeNull();
  });

  it("tells somebody who has been to BotFather which half is missing", () => {
    // They are halfway through a door. Answering with the name of the other one
    // would read as though the work they had already done was the wrong work.
    const noOwner = refusal(() => consoleDoors({ adminBotToken: TOKEN }));
    expect(noOwner.message).toContain("--owner-telegram-id");
    expect(noOwner.message).not.toContain("--console-key");

    const noToken = refusal(() => consoleDoors({ ownerTelegramId: OWNER }));
    expect(noToken.message).toContain("--admin-bot-token");
    expect(noToken.message).not.toContain("--console-key");
  });

  it("still holds an owner id it was actually given to being a number", () => {
    const refused = refusal(() =>
      consoleDoors({ adminBotToken: TOKEN, ownerTelegramId: "@somebody" }),
    );
    expect(refused.code).toBe("invalid_input");
    expect(refused.message).toContain("digits");
  });

  it("never puts a secret up with nothing in it", () => {
    // A secret is uploaded over stdin to `wrangler secret put`, after the
    // database, the namespace and the index already exist. An empty one is not
    // a smaller setting, it is a run that stops in the middle.
    for (const doors of [
      consoleDoors({ consoleKey: KEY }),
      consoleDoors({ adminBotToken: TOKEN, ownerTelegramId: OWNER }),
      consoleDoors({ consoleKey: KEY, adminBotToken: TOKEN, ownerTelegramId: OWNER }),
    ]) {
      for (const [name, value] of secretsFor(doors, { ...EXTRAS, gatewayToken: "  " })) {
        expect(value.trim().length, name).toBeGreaterThan(0);
      }
    }
  });
});

describe("what the command line itself asks for", () => {
  // Read as source because the question is which flags the dispatch insists
  // on, and `requireFlag` is the whole of that: a door named there is a door
  // the terminal path cannot be used without.
  const entry = readFileSync(new URL("../../cli/src/index.ts", import.meta.url), "utf8");

  it("makes none of the three doors a required flag", () => {
    const required = [...entry.matchAll(/requireFlag\(\s*args,\s*"([^"]+)"/g)].map(
      (match) => match[1] as string,
    );
    for (const flag of ["console-key", "admin-bot-token", "owner-telegram-id"]) {
      expect(required, flag).not.toContain(flag);
    }
  });

  it("offers the key on the help screen, where somebody looks for it", () => {
    expect(entry).toContain("--console-key");
  });
});

describe("what the recovery document tells somebody who is locked out", () => {
  const doc = readFileSync(new URL("../../../docs/DEPLOY-RECOVERY.md", import.meta.url), "utf8");
  const sections = doc.split(/\n(?=## )/);

  /**
   * The one section holding a marker, so a stray mention cannot stand in for
   * it. Called inside each test rather than once above them, because a
   * document that has lost the section altogether should fail as the test that
   * asked for it and not as a file that would not load.
   */
  const holding = (marker: string): string => {
    const found = sections.filter((section) => section.includes(marker));
    expect(found.length, `${marker} is in ${found.length} sections, expected exactly one`).toBe(1);
    return found[0] as string;
  };

  /** Where an owner who cannot sign in is answered. */
  const lockedOut = (): string => holding("Variables and Secrets");

  it("answers with the setting they can change, not an install they must redo", () => {
    expect(lockedOut()).toContain("CONSOLE_KEY");
    expect(lockedOut()).toContain("app.muxel.site");
    // The length the Worker enforces, read off the Worker rather than typed
    // here, so the document cannot drift away from the rule it describes.
    expect(lockedOut()).toContain(String(CONSOLE_KEY_MIN_LENGTH));
  });

  it("says that changing it ends the sessions the old key opened", () => {
    // The reason this is the answer at all. A key change that left every
    // browser already signed in would be no answer to a key somebody else has.
    expect(lockedOut()).toContain("no longer the key");
  });

  it("names the key before the Telegram pair, as the deploy flow does", () => {
    expect(doc.indexOf("CONSOLE_KEY")).toBeLessThan(doc.indexOf("ADMIN_BOT_TOKEN"));
  });

  it("asks only for settings the direct installer actually reads", () => {
    // The document hands somebody a command to paste. A variable named here
    // that the script never looks at is a value typed for nothing, and the
    // script is the only thing that knows which ones it reads.
    const installer = readFileSync(new URL("../../../scripts/install.mjs", import.meta.url), "utf8");
    const read = [...installer.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map(
      (match) => match[1] as string,
    );
    const asked = [...doc.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1] as string);

    expect(asked.length).toBeGreaterThan(0);
    for (const name of asked) {
      expect(read, name).toContain(name);
    }
  });
});
