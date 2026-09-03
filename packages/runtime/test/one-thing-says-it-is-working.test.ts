/**
 * One thing says it is working.
 *
 * Reported from the live console with a screenshot: a turn in flight showed
 * "Qwen 3.8 27B  Thinking" beside the model's name *and* three bouncing dots in
 * the body underneath. Two indicators for one wait, one of them sitting where
 * the answer was about to appear, so the eye had two things to watch and
 * neither of them was the answer.
 *
 * There is one now, and it stands where the answer will: the word the
 * deployment is currently saying — Thinking, Working, Checking what changed —
 * with a light sweeping across it. The head goes back to being the head.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const app = read("../../console/public/app.js");
const css = read("../../console/public/app.css");
const demo = read("../../console/public/demo.js");
const demoCss = read("../../console/public/demo.css");

/** Every waiting turn the console draws: the typed one and the tapped one. */
const skeletons = [...app.matchAll(/<div class="turn ai" id="asThinking">[\s\S]*?<\/div>`/g)].map(
  (m) => m[0],
);

describe("the turn in flight", () => {
  it("is drawn the same way whether the owner typed or tapped", () => {
    expect(skeletons).toHaveLength(2);
  });

  it("says it is working once, in the body, not beside the model's name", () => {
    for (const turn of skeletons) {
      const head = turn.slice(turn.indexOf('class="ai-head"'), turn.indexOf('class="ai-body'));
      expect(head).not.toContain("work-label");
      expect(turn).toMatch(/class="ai-body thinking"><span class="work-label">[A-Z]/);
    }
  });

  it("has no second indicator under it", () => {
    // The three bouncing dots. They were the other half of the same message.
    for (const turn of skeletons) {
      expect(turn).not.toContain("<span></span><span></span><span></span>");
    }
    expect(css).not.toContain("@keyframes blip");
  });

  it("still reaches the label when the deployment says what it is doing", () => {
    // showProgress looks in the whole turn, so moving the label did not
    // silently stop the status events from landing anywhere.
    const handler = app.slice(app.indexOf('if (event.type === "status")'));
    expect(handler.slice(0, 200)).toContain('turn.querySelector(".work-label")');
  });

  it("is gone before the answer is written into the same place", () => {
    const fn = app.slice(app.indexOf("async function typeOut"));
    const before = fn.indexOf("body.innerHTML");
    expect(fn.indexOf('body.classList.remove("thinking")')).toBeLessThan(before);
    expect(fn.indexOf("label.remove()")).toBeLessThan(before);
  });
});

describe("how the waiting line is drawn", () => {
  const rule = css.slice(css.indexOf(".ai-body.thinking .work-label"), css.indexOf("@keyframes reading"));

  it("reaches below the baseline, because the paint stops at the box", () => {
    // background-clip: text paints only inside the background box. At a tight
    // line box that box stops above the descenders and the tail of the g is
    // left unpainted — the same bug, once, in the film's opening title.
    expect(rule).toContain("background-clip: text");
    expect(rule).toMatch(/padding-bottom: \.\d+em/);
  });

  it("moves by sweeping the light, not by rewriting the text", () => {
    // The dots used to be an animated `content`, which only WebKit animates.
    expect(css).not.toContain("@keyframes ellipsis");
    expect(css).toContain('.work-label::after { content: " ···"');
    expect(rule).toContain("animation: reading");
  });
});

describe("the demonstration on the front page", () => {
  it("draws the console's own waiting line, not one of its own", () => {
    // The page's argument is that it is the product; a second style for the
    // same moment would be the one invented thing on it.
    expect(demo).toContain('<div class="ai-body thinking"><span class="work-label">Thinking</span>');
    const head = demo.slice(demo.indexOf('class="ai-head"'), demo.indexOf('class="ai-body'));
    expect(head).not.toContain("work-label");
    expect(demoCss).toContain(".demo .ai-body.thinking .work-label");
  });

  it("stops being a waiting line when it holds an answer", () => {
    expect(demo).toContain('body.classList.remove("thinking")');
  });
});
