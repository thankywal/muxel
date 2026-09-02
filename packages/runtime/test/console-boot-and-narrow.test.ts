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

  it("shows the mark while it reads localStorage", () => {
    // Not a spinner. A spinner says work is happening; at this point the only
    // work is a script parsing, and the honest state is "we do not know yet
    // whose console this is".
    const boot = html.slice(html.indexOf('<div id="boot"'), html.indexOf("</div>", html.indexOf('<div id="boot"')));
    expect(boot).toContain("/assets/logo.png");
    expect(css).toContain("@keyframes boot-shimmer");
    expect(css).toContain("@keyframes boot-breathe");
  });

  it("takes the boot screen down whichever screen wins", () => {
    const show = app.slice(app.indexOf("function showConsole"), app.indexOf("function disconnect"));
    expect(show).toContain('$("boot")');
    expect(show).toContain("hidden = true");
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
  it("builds the address from what the deployment reported", () => {
    // The console is served from somewhere else entirely and cannot work out
    // where a web agent answers; the deployment has to say.
    const api = read("../src/web/console-api.ts");
    expect(api).toContain("key: channel.key");
    expect(api).toMatch(/origin: origin \?\? ""/);
    expect(app).toContain("const tryUrl");
    expect(app).toContain("/w/${agent.web.key}");
  });

  it("offers nothing rather than a wrong link when it cannot know", () => {
    const build = app.slice(app.indexOf("const tryUrl"), app.indexOf("const tryUrl") + 340);
    expect(build).toContain("data.origin && agent.web?.enabled && agent.web?.key");
    expect(app).toContain("not on the web");
  });
});
