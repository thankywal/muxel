/**
 * A dialog closes on the backdrop and does nothing to a click inside it.
 *
 * Reported as "at agent creation, can't choose Telegram type". It could not be
 * chosen: not by mouse, not by keyboard, not by a script calling .click() on
 * the radio. The event reached the input and arrived at the document with
 * defaultPrevented already true.
 *
 * Every dialog carried this line, eight times over:
 *
 *     bg.onclick = (e) => e.target === bg && close();
 *
 * It reads as a guard. An arrow with an expression body returns that
 * expression, so a click anywhere but the backdrop returned false, and
 * returning false from an onclick handler is how a page cancels the event's
 * default action. So each dialog cancelled every click inside itself: a radio
 * could not be selected, a checkbox could not be ticked, a link could not be
 * followed. Choosing Telegram was the one somebody happened to need.
 *
 * The return value is the whole bug, so that is what is checked here, by
 * running the real handler.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const app = readFileSync(new URL("../../console/public/app.js", import.meta.url), "utf8");

/** The shipped helper, lifted out and run. */
const closeOnBackdrop = (() => {
  const at = app.indexOf("function closeOnBackdrop");
  const source = app.slice(at, app.indexOf("\n}\n", at) + 3);
  const sandbox: Record<string, unknown> = {};
  runInNewContext(`${source}\nthis.fn = closeOnBackdrop;`, sandbox);
  return sandbox.fn as (bg: { onclick?: (e: unknown) => unknown }, close: () => void) => void;
})();

function handlerFor() {
  let closed = 0;
  const bg: { onclick?: (e: unknown) => unknown } = {};
  closeOnBackdrop(bg, () => { closed += 1; });
  return { bg, closed: () => closed };
}

describe("clicking inside a dialog", () => {
  it("is not cancelled, which is what returning false would do", () => {
    const { bg, closed } = handlerFor();
    const radio = { tagName: "INPUT" };
    // The handler's return value is the contract with the browser: anything
    // falsy other than undefined cancels the click.
    expect(bg.onclick?.({ target: radio })).toBeUndefined();
    expect(closed()).toBe(0);
  });

  it("still closes when the backdrop itself is clicked", () => {
    const { bg, closed } = handlerFor();
    expect(closed()).toBe(0);
    bg.onclick?.({ target: bg });
    expect(closed()).toBe(1);
  });
});

describe("how the dialogs use it", () => {
  it("is written once, and every dialog calls it", () => {
    expect((app.match(/function closeOnBackdrop/g) ?? []).length).toBe(1);
    expect((app.match(/closeOnBackdrop\(bg, close\);/g) ?? []).length).toBe(9);
  });

  it("has none of the old line left anywhere", () => {
    // Eight copies is eight places for it to come back.
    expect(app).not.toMatch(/onclick = \([a-z]+\) => [a-z]+\.target === bg && close\(\)/);
  });

  it("has a statement body, because an expression body is the bug", () => {
    const at = app.indexOf("function closeOnBackdrop");
    const body = app.slice(at, app.indexOf("\n}\n", at));
    expect(body).toMatch(/onclick = \(event\) => \{/);
    expect(body).toMatch(/if \(event\.target === bg\) close\(\);/);
    expect(body).not.toMatch(/&& close\(\)/);
  });
});

describe("the choice that could not be made", () => {
  const dialog = app.slice(app.indexOf("function createBusinessDialog"), app.indexOf("closeOnBackdrop", app.indexOf("function createBusinessDialog")) + 40);

  it("still offers Telegram as a channel at creation", () => {
    expect(dialog).toContain('value="telegram"');
    expect(dialog).toContain('value="web"');
  });

  it("shows the token field only once Telegram is the one chosen", () => {
    const wiring = app.slice(app.indexOf('bg.querySelectorAll(\'input[name="chan"]\')'), app.indexOf("#bizDocs"));
    expect(wiring).toMatch(/radio\.onchange/);
    expect(wiring).toMatch(/tokBox"\)\.hidden =/);
    expect(wiring).toContain('!== "telegram"');
  });
});

describe("a bot that could not be attached", () => {
  it("says which of the three it was", () => {
    // "The bot token was refused" sent an owner back to BotFather when the
    // deployment had simply never been opened in a browser, so it did not
    // know its own address and could not register the webhook.
    const api = readFileSync(new URL("../src/web/console-api.ts", import.meta.url), "utf8");
    for (const reason of ["bot_rejected", "same_as_console", "no_origin"]) {
      expect(api, `the route answers ${reason}`).toContain(reason);
      expect(app, `the dialog explains ${reason}`).toContain(`${reason}:`);
    }
    expect(app).toMatch(/BOT_REFUSED\[attached\.data\?\.error\]/);
  });

  it("still says something when the reason is one it does not know", () => {
    expect(app).toMatch(/BOT_REFUSED\[[^\]]+\] \?\? "The bot token was refused/);
  });
});
