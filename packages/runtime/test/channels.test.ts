import { describe, expect, it } from "vitest";

import { STRINGS, LOCALES, t } from "../src/telegram/i18n.js";

/**
 * A business used to exist only because a Telegram bot served it: adding one
 * meant handing over a bot token, and the bot's own name became the business
 * name. Anyone who wanted nothing but a chat bubble on their website still had
 * to visit BotFather, create a bot they would never use, and then find the web
 * agent buried in a screen they could only reach after finishing all of that.
 *
 * The console now asks which channel first. These tests hold the pieces that
 * make the website route reachable, because the route is spread across a screen,
 * a pending kind and a handler, and a missing string in one language would
 * strand an operator mid setup.
 */

describe("choosing a channel", () => {
  it("offers both routes in every language", () => {
    for (const locale of LOCALES) {
      for (const key of ["btnRouteTelegram", "btnRouteWeb"] as const) {
        expect(t(locale, key).length).toBeGreaterThan(0);
      }
    }
  });

  it("explains what each route costs the operator", () => {
    // The whole point of asking is that the two are not equivalent: one needs a
    // bot from BotFather, the other needs nothing. A chooser that does not say
    // so is just an extra tap.
    expect(t("en", "routeTelegramBody")).toContain("BotFather");
    expect(t("en", "routeWebBody")).toContain("No Telegram bot is needed");
  });

  it("says the choice is not final", () => {
    for (const locale of LOCALES) {
      expect(t(locale, "bizNewBoth").length).toBeGreaterThan(0);
    }
  });

  it("asks for a name on the website route", () => {
    // Telegram takes the name from the bot. The website has no bot, so this is
    // the one place a name has to be asked for.
    for (const locale of LOCALES) {
      expect(t(locale, "bizWebTitle").length).toBeGreaterThan(0);
      expect(t(locale, "bizWebBody").length).toBeGreaterThan(0);
    }
  });
});

describe("what the business screen reports", () => {
  it("names each channel rather than counting bots", () => {
    // "Bots: 0" is what a website only business used to show, which reads as
    // something being broken rather than as a channel simply not in use.
    expect(STRINGS).not.toHaveProperty("bizBots");
    for (const locale of LOCALES) {
      for (const key of [
        "bizTelegram",
        "bizWebsite",
        "bizChannelLive",
        "bizChannelOff",
        "bizChannelAbsent",
      ] as const) {
        expect(t(locale, key).length).toBeGreaterThan(0);
      }
    }
  });

  it("distinguishes a channel that is off from one that was never made", () => {
    // Switching the widget off and never having created it look identical from
    // a count, and mean completely different things to the operator.
    expect(t("en", "bizChannelOff")).not.toBe(t("en", "bizChannelAbsent"));
  });
});
