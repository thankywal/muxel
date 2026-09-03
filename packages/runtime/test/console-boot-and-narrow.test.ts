/**
 * What the console looks like before it knows anything, and on a small screen.
 *
 * Two failures this file exists for, both reported from a real browser:
 *
 *   A reload of a connected console painted the sign-in page first. Onboarding
 *   was visible in the markup and app.js hid it once it had parsed, so every
 *   refresh flashed the wrong screen and then replaced it.
 *
 *   Below 900px the rail was display:none. Not collapsed, not off canvas —
 *   gone, with nothing in its place. Whatever page you landed on was the page
 *   you were stuck with, and the two boxes in the header that survived took up
 *   most of what was left.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const html = read("../../console/public/console.html");
const app = read("../../console/public/app.js");
const css = read("../../console/public/app.css");

/**
 * One media block, so a rule can be checked where it actually applies.
 *
 * `from` picks which one when a width has more than one block, which is itself
 * a smell: the pair that used to exist at 900px disagreed about whether the
 * rail was hidden or a drawer.
 */
const media = (query: string, from = 0): string => {
  const at = css.indexOf(`@media ${query}`, from);
  if (at === -1) return "";
  let depth = 0;
  for (let i = css.indexOf("{", at); i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(at, i + 1);
    }
  }
  return "";
};

describe("the first paint", () => {
  it("starts on neither screen, so a reload cannot flash the wrong one", () => {
    expect(html).toContain('<main id="onboardingWrap" hidden>');
    expect(html).toContain('<div id="shell" hidden>');
    expect(html).toContain('<div id="boot" class="boot">');
  });

  it("gives the mark the whole screen, not a corner of it", () => {
    // At 72px in the middle of an empty page it read as a page that had failed
    // to load rather than one that was loading. The waiting state inside an
    // already-drawn page had the same problem for the same reason: a small
    // line in the top corner is what a broken view looks like.
    expect(css).toMatch(/\.boot-mark \{[\s\S]*?width: min\(168px/);
    expect(css).toMatch(/\.loading-mark \{[\s\S]*?place-content: center/);
    // The waiting state inside a drawn page is centred but modest: the whole
    // screen belongs to boot, where there is genuinely nothing else, and a view
    // fetching a short list should not look like a page that has emptied
    // itself.
    expect(css).toMatch(/\.loading-mark \{[\s\S]*?min-height: 220px/);
    expect(css).toMatch(/\.loading-mark img \{[\s\S]*?width: 64px/);
    // A dialog is small on purpose and must not be given a half-screen mark.
    expect(css).toContain(".modal .loading-mark");
  });

  it("shows the mark while it reads localStorage", () => {
    // Not a spinner. A spinner says work is happening; at this point the only
    // work is a script parsing, and the honest state is "we do not know yet
    // whose console this is".
    expect(css).toContain("@keyframes boot-shimmer");
    expect(css).toContain("@keyframes boot-breathe");
  });

  it("owes the network nothing to draw itself", () => {
    // It appeared with no mark at all, and once with the top third of one:
    // /assets/logo.png is 188KB and the loading screen was waiting on it. A
    // loading screen that needs a loading screen is not one.
    expect(css).toMatch(/--mark: url\("data:image\/png;base64,/);
    expect(css).toMatch(/\.boot-mark \{[\s\S]*?background: var\(--mark\)/);
    const boot = html.slice(html.indexOf('<div id="boot"'), html.indexOf("</div>", html.indexOf('<div id="boot"')) + 6);
    expect(boot, "the boot screen must not fetch anything").not.toContain("src=");
    // Small enough to belong in a stylesheet the page already blocks on.
    const inline = css.match(/--mark: url\("data:image\/png;base64,([^"]+)"\)/)?.[1] ?? "";
    expect(inline.length).toBeGreaterThan(2000);
    expect(inline.length).toBeLessThan(24_000);
  });

  // The guarantee this has always made is that boot comes down on both paths.
  // What changed is where: taking it down inside showConsole put the console's
  // own frame on screen with a second loading mark inside it while the first
  // view was still being fetched, which is two loading screens for one page
  // load. So the assertion is about the guarantee now, not about the line that
  // used to keep it.
  it("takes the boot screen down whichever screen wins", () => {
    const show = app.slice(app.indexOf("function showConsole"), app.indexOf("function booted"));
    // The sign-in screen has nothing to fetch, so it ends boot as it appears.
    expect(show).toMatch(/\} else \{[\s\S]{0,80}booted\(\)/);
    const render = app.slice(app.indexOf("async function render()"), app.indexOf("async function apiReady"));
    // The console ends it once a view is drawn, whatever the view turned out
    // to be — including a page saying the deployment could not be reached.
    expect(render).toMatch(/\} finally \{[\s\S]{0,240}booted\(\)/);
    expect(app).toMatch(/function booted\(\) \{[\s\S]{0,120}hidden = true/);
  });

  it("does not hand over to a second loading mark on the way in", () => {
    // The bug, in one line: showConsole took boot down, then drew the rail and
    // the header around an empty content area holding waitingMark(), and the
    // owner watched a full screen mark become a small different one.
    const show = app.slice(app.indexOf("function showConsole"), app.indexOf("function booted"));
    // The `if (on)` branch alone. The `else` is the sign-in screen, which is
    // supposed to end boot.
    const onwards = show.slice(show.indexOf("if (on) {"), show.indexOf("} else {"));
    expect(onwards).toContain("shell()");
    expect(onwards).not.toContain("booted()");
    expect(onwards).not.toContain('$("boot")');
  });

  it("waits for the view before it says the console has arrived", () => {
    // Without the await, the boot screen comes down on the frame the draw was
    // started, not the frame it finished, which is the same two screens again.
    const render = app.slice(app.indexOf("async function render()"), app.indexOf("async function apiReady"));
    expect(render).toMatch(/await \(draw \?\? viewOverview\)\(\)/);
  });

  it("gives the call the boot screen waits on a deadline", () => {
    // A Worker that accepts the connection and never answers used to leave a
    // small mark spinning inside a console you could still click out of. It
    // would cover the whole screen now, with nothing to press.
    const ready = app.slice(app.indexOf("async function apiReady"), app.indexOf("async function overview"));
    expect(ready).toMatch(/api\("system", \{ quiet: true, signal: AbortSignal\.timeout\(\d+\) \}\)/);
    // A timeout answers -1, which was landing in the "ready" branch.
    expect(ready).toMatch(/status <= 0/);
  });

  it("is dark before the script runs, on a machine that is dark", () => {
    // data-theme is set by app.js. Until that file has downloaded and run there
    // is no attribute to match, so a dark desktop got a full white page on
    // every reload. The preference has to be stated in CSS, and the explicit
    // choice has to come after it so a person who picked light keeps light.
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain(':root:not([data-theme="light"])');
    expect(css.lastIndexOf('[data-theme="dark"] {')).toBeGreaterThan(
      css.indexOf("@media (prefers-color-scheme: dark)"),
    );
    // Both blocks carry the same tokens, or one of the two darks is wrong.
    const bg = [...css.matchAll(/--bg:\s*#0b0f17/g)];
    expect(bg.length).toBe(2);
    expect(css).toContain("color-scheme: light dark");
  });

  it("respects a reader who has asked for less motion", () => {
    expect(media("(prefers-reduced-motion: reduce)")).toContain("animation: none");
  });

  it("has no bare word left where the mark should be", () => {
    // "Loading…" alone in an empty page is what the reload looked like.
    expect(app).toContain("function waitingMark");
    expect(app).not.toContain('<p class="loading">Loading…</p>');
  });
});

describe("the rail on a narrow screen", () => {
  const narrow = media("(max-width: 900px)", css.indexOf(".rail-open"));

  it("is a drawer rather than nothing", () => {
    // Nowhere at this width may hide it outright, not only the block that
    // makes it a drawer: the losing rule was in a second block for the same
    // width, which is how it survived unnoticed.
    expect(css).not.toMatch(/@media \(max-width: 900px\)[^@]*aside\s*\{[^}]*display:\s*none/);
    expect(narrow).toContain("position: fixed");
    expect(narrow).toContain("transform: translateX(-102%)");
    expect(narrow).toContain(".shell.rail-on aside");
  });

  it("has a way in, and more than one way out", () => {
    // A drawer that only closes by its own button is a trap on a phone, where
    // the thing you want is usually the page behind it.
    expect(app).toContain('$("railOpen").onclick');
    expect(app).toContain('$("railVeil").onclick');
    expect(app).toMatch(/nav-item[\s\S]{0,120}rail\(false\)/);
    const chatRow = app.slice(app.indexOf("function bindChatRail"), app.indexOf("function bindChatRail") + 500);
    expect(chatRow).toContain('classList.remove("rail-on")');
    // On the element the stylesheet selects. #shell is the wrapper; .shell is
    // the grid inside it, and toggling the wrapper moved a class nothing was
    // listening for, so the drawer stayed shut without complaining.
    expect(app).toContain('$("shell").querySelector(".shell")');
    expect(app).not.toContain('$("shell").classList.toggle("rail-on"');
  });

  it("only shows the button where the rail has nowhere to be", () => {
    expect(css).toMatch(/\.rail-open\s*\{\s*display:\s*none/);
    expect(narrow).toMatch(/\.rail-open\s*\{[^}]*display:\s*inline-flex/);
  });
});

describe("the header on a narrow screen", () => {
  const narrow = media("(max-width: 900px)", css.indexOf(".rail-open"));

  it("keeps the search icon and drops its words", () => {
    expect(narrow).toMatch(/\.searchbox span, \.searchbox kbd \{ display: none; \}/);
  });

  it("lets a wide table scroll inside its own card", () => {
    // The agents table has seven columns and a phone has none of the room for
    // them. Scrolling the card keeps the columns their own width; reflowing
    // the table to fit stops it being readable as a table, and letting the
    // page scroll sideways breaks everything else on it.
    expect(narrow).toMatch(/\.card \{[^}]*overflow-x: auto/);
    expect(narrow).toMatch(/\.card table \{[^}]*min-width/);
  });

  it("keeps the health dot and drops its label", () => {
    // The dot is the part that carries the state. The word beside it was
    // taking a third of the header to repeat what the colour already said.
    expect(narrow).toMatch(/\.pill \{[^}]*font-size: 0/);
    expect(narrow).toMatch(/\.pill \.d \{[^}]*width: 8px/);
  });
});

describe("opening the agent a customer talks to", () => {
  // These used to pin `const tryUrl`, the one expression in the agents list
  // that built a web address. The same question is asked on a business's own
  // page now, and of Telegram as well as the web, so it is one function and
  // these are about what it guarantees rather than about where it lived.
  const build = app.slice(app.indexOf("function tryOn("), app.indexOf("const tryOnButtons"));

  it("builds the address from what the deployment reported", () => {
    // The console is served from somewhere else entirely and cannot work out
    // where a web agent answers; the deployment has to say, on the agents list
    // and on the business page alike.
    const api = read("../src/web/console-api.ts");
    expect(api).toContain("key: channel.key");
    expect((api.match(/origin: origin \?\? ""/g) ?? []).length).toBe(2);
    expect(build).toContain("/w/${card.web.key}");
    // And the bot the owner attached, opened in Telegram rather than described.
    expect(build).toContain("https://t.me/${String(card.telegram.username)");
  });

  it("offers nothing rather than a wrong link when it cannot know", () => {
    expect(build).toContain('at !== "" && card?.web?.enabled === true && card.web.key');
    expect(build).toContain("card?.telegram?.enabled === true && card.telegram.username");
    expect(app).toContain("nowhere to try it yet");
  });

  it("is asked once and answered the same way on both screens", () => {
    // Two copies would drift the day a third channel arrives.
    expect((app.match(/function tryOn\(/g) ?? []).length).toBe(1);
    // Defined once, called from the two screens and nowhere else.
    expect((app.match(/const tryOnButtons = /g) ?? []).length).toBe(1);
    expect((app.match(/tryOnButtons\(/g) ?? []).length).toBe(2);
    // On the business page it sits with the name and the channel tags.
    // Sliced from the function to the tab strip, because the header this is
    // about is drawn between them. Searching the whole file for the end marker
    // found an earlier one and gave an empty string, and an assertion on an
    // empty string is one that cannot fail for the right reason.
    const from = app.indexOf("async function businessDetail");
    const head = app.slice(from, app.indexOf('id="bizTab"', from));
    expect(head).toContain("← All businesses");
    expect(head).toContain("tryOnButtons(b, b.origin)");
  });
});
