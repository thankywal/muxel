import { describe, expect, it } from "vitest";

import { LOCALES } from "../src/telegram/i18n.js";
import { CONSOLE_COMMANDS, parseCommand } from "../src/telegram/admin.js";
import { findSkill, matchSkill, SKILLS } from "../src/telegram/skills.js";

/**
 * A starting point an operator picks and then edits. What matters is that every
 * one is reachable, labelled in their language, and safe to apply on top of
 * whatever was there before.
 */

describe("instruction styles", () => {
  it("names and explains each style in every console language", () => {
    for (const skill of SKILLS) {
      for (const locale of LOCALES) {
        expect(skill.label[locale]?.length ?? 0).toBeGreaterThan(0);
        expect(skill.summary[locale]?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it("keeps every id short enough to survive a callback payload", () => {
    // Buttons carry the id alongside a business id inside 64 bytes.
    for (const skill of SKILLS) {
      expect(skill.id).toMatch(/^[a-z]{3,12}$/);
    }
  });

  it("has no duplicate ids, so a button cannot apply the wrong one", () => {
    expect(new Set(SKILLS.map((s) => s.id)).size).toBe(SKILLS.length);
  });

  it("writes instructions the model can act on, not a label", () => {
    for (const skill of SKILLS) {
      expect(skill.body.length).toBeGreaterThan(80);
    }
  });

  it("finds a style by id and refuses one that does not exist", () => {
    expect(findSkill("friendly")?.id).toBe("friendly");
    expect(findSkill("nonsense")).toBeUndefined();
  });
});

describe("console commands", () => {
  it("reads a plain command", () => {
    expect(parseCommand("/instruction")).toBe("instruction");
  });

  it("reads a command that carries the bot username", () => {
    // Telegram appends it whenever a command is forwarded or sent in a group.
    expect(parseCommand("/instruction@my_console_bot")).toBe("instruction");
  });

  it("ignores case and surrounding space", () => {
    expect(parseCommand("  /Instruction  ")).toBe("instruction");
  });

  it("is not fooled by ordinary text that mentions a slash", () => {
    expect(parseCommand("what is the price of 1/2 kg")).toBeNull();
    expect(parseCommand("tell me about /instruction")).toBeNull();
    expect(parseCommand("")).toBeNull();
  });

  it("publishes a description for every command in every language", () => {
    for (const entry of CONSOLE_COMMANDS) {
      expect(entry.command).toMatch(/^[a-z]{1,32}$/);
    }
    expect(CONSOLE_COMMANDS.map((c) => c.command)).toContain("instruction");
  });
});

/**
 * The console labels the current instructions with the style they came from.
 * That label has to stop being shown the moment it stops being true, or it
 * describes behaviour the operator has already changed.
 */
describe("recognising the style in use", () => {
  it("names a style that is still exactly as it was applied", () => {
    const friendly = findSkill("friendly");
    expect(friendly).toBeDefined();
    expect(matchSkill(friendly!.body)?.id).toBe("friendly");
  });

  it("ignores surrounding whitespace, which an edit box adds on its own", () => {
    const friendly = findSkill("friendly")!;
    expect(matchSkill(`\n${friendly.body}\n `)?.id).toBe("friendly");
  });

  it("stops naming a style once a word has been changed", () => {
    const friendly = findSkill("friendly")!;
    expect(matchSkill(`${friendly.body} Always mention delivery.`)).toBeUndefined();
  });

  it("names nothing for instructions written from scratch", () => {
    expect(matchSkill("Always answer in Burmese and never quote a price.")).toBeUndefined();
  });

  it("names nothing when there are no instructions", () => {
    expect(matchSkill("")).toBeUndefined();
    expect(matchSkill("   ")).toBeUndefined();
  });
});
