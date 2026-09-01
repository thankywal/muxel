/**
 * The screen an owner meets before they have a deployment.
 *
 * It was one column of prose. It is cards on a ground now — a top bar, the
 * argument beside the demonstration, and then the two things actually left to
 * do: read the steps, or paste an address you already have.
 *
 * Restructuring markup is how a form quietly stops being wired up, so these
 * hold the join: every element the console's own script reaches for on this
 * screen still exists, and every piece of the layout is still on it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (name: string): string =>
  readFileSync(new URL(`../../console/public/${name}`, import.meta.url), "utf8");
const page = read("console.html");
const app = read("app.js");

/**
 * What the onboarding screen has to provide.
 *
 * Not a list somebody remembered: each of these is asserted to be reached by
 * app.js as well as present here, so an id that stops being used drops out of
 * the test rather than being pinned forever.
 */
const WIRED = [
  "onboardingWrap",
  "workerUrl",
  "connectForm",
  "connectBtn",
  "pairForm",
  "pairCode",
  "pairBtn",
  "connectErr",
  "step2",
];

describe("the screen stays wired", () => {
  it("still has every element the console script reaches for", () => {
    for (const id of WIRED) {
      expect(page, id).toContain(`id="${id}"`);
      expect(app, id).toContain(`"${id}"`);
    }
  });

  it("still mounts the demonstration", () => {
    for (const id of ["demo", "thread", "demoChips", "demoSend", "demoStop"]) {
      expect(page, id).toContain(`id="${id}"`);
    }
    // In the hero, beside the claim, rather than under it: it is the only thing
    // on the page that moves, so it is what a person tries first.
    const hero = page.slice(page.indexOf('class="panel hero"'), page.indexOf('class="below"'));
    expect(hero).toContain('id="demo"');
  });
});

describe("the layout", () => {
  it("keeps all six deploy steps", () => {
    const steps = page.slice(page.indexOf('<ol class="steps">'), page.indexOf("</ol>"));
    expect((steps.match(/<li>/g) ?? []).length).toBe(6);
  });

  it("says what follows from where the deployment lives", () => {
    // Four properties of the shape. Each is a consequence of the account it
    // runs in, which is the only claim this page makes.
    for (const title of ["Privacy first", "Zero infra", "Truly yours", "Useful and real"]) {
      expect(page, title).toContain(`<b>${title}</b>`);
    }
  });

  it("offers deploying and connecting as the two ways out", () => {
    expect(page).toContain("deploy.workers.cloudflare.com");
    expect(page).toContain("Already deployed? Connect it.");
  });

  it("stacks to one column on a narrow screen", () => {
    // Two side-by-side grids and a 2x2 inside one of them. On a phone all three
    // have to collapse, or the page scrolls sideways.
    expect(page).toMatch(/\.ob \.hero, \.ob \.below, \.why \.grid \{ grid-template-columns: 1fr; \}/);
  });
});
