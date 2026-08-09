import { describe, expect, it } from "vitest";

import { isLocale, LOCALE_NAMES, LOCALES, t } from "../src/telegram/i18n.js";

/**
 * The console is rendered entirely from this table, so a missing entry is a
 * blank button rather than a visible error. These checks are what make adding a
 * language a mechanical job instead of a hunt.
 */
describe("translation coverage", () => {
  it("names every language in its own language", () => {
    expect(LOCALE_NAMES.en).toBe("English");
    expect(LOCALE_NAMES.th).toBe("ไทย");
    expect(LOCALE_NAMES.zh).toBe("中文");
    expect(LOCALE_NAMES.my).toBe("မြန်မာ");
  });

  it("returns a non empty string for every key in every language", () => {
    const sample = [
      "back",
      "yes",
      "no",
      "homeTitle",
      "btnBusinesses",
      "btnAddBusiness",
      "btnHelp",
      "btnLanguage",
      "bizListEmpty",
      "bizDeleteConfirm",
      "dataHint",
      "btnAddData",
      "btnSeeData",
      "prodAddBody",
      "btnBulkProducts",
      "instBody",
      "custEmpty",
      "botAddBody",
      "modelBody",
      "helpBody",
    ] as const;

    for (const locale of LOCALES) {
      for (const key of sample) {
        const value = t(locale, key);
        expect(value.length, `${String(key)} in ${locale}`).toBeGreaterThan(0);
        expect(value, `${String(key)} in ${locale}`).not.toContain("undefined");
      }
    }
  });

  it("translates the same key differently across languages", () => {
    const rendered = LOCALES.map((locale) => t(locale, "btnHelp"));
    expect(new Set(rendered).size).toBe(LOCALES.length);
  });
});

describe("placeholders", () => {
  it("substitutes a named value", () => {
    expect(t("en", "bizListCount", { count: 3 })).toBe("3 configured.");
  });

  it("substitutes into every language", () => {
    for (const locale of LOCALES) {
      expect(t(locale, "dataTitle", { name: "Shwe Coffee" })).toContain("Shwe Coffee");
    }
  });

  it("leaves an unknown placeholder visible rather than printing undefined", () => {
    expect(t("en", "bizListCount", {})).toContain("{count}");
  });

  it("fills more than one placeholder", () => {
    const rendered = t("en", "bizToday", { messages: 12, tokens: 340 });
    expect(rendered).toContain("12");
    expect(rendered).toContain("340");
  });
});

describe("isLocale", () => {
  it("accepts the supported languages", () => {
    for (const locale of LOCALES) {
      expect(isLocale(locale)).toBe(true);
    }
  });

  it("rejects anything else", () => {
    expect(isLocale("fr")).toBe(false);
    expect(isLocale("")).toBe(false);
    expect(isLocale("EN")).toBe(false);
  });
});

describe("help text", () => {
  it("is a full guide in every language, not a stub", () => {
    for (const locale of LOCALES) {
      const help = t(locale, "helpBody");
      expect(help.length, locale).toBeGreaterThan(400);
      expect(help, locale).toContain("@BotFather");
    }
  });
});
