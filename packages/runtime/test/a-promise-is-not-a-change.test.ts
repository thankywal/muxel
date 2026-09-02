/**
 * A turn that called nothing is told so, once.
 *
 * Reported from the live console. Asked to add six prices to a business that
 * exists, the model replied "I'll add those six prices to Shwe Coffee Shop for
 * you. Tap Yes below to confirm." and called no tool at all. No cards, no
 * steps, nothing written: `operator_approval` and `operator_step` both hold
 * nothing for that message. The turn ended because the model had stopped
 * talking, and stopping is exactly what a model does after it promises.
 *
 * The loop cannot read the prose to find out. There is no way to tell a
 * promise from an answer by looking at words, and a rule that worked in English
 * would fail in Burmese the same afternoon. What the system knows for certain
 * is what was called, which was nothing. So that is what it says back, once,
 * and a turn that genuinely needs no tool repeats itself and is believed.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const loop = readFileSync(new URL("../src/assistant/loop.ts", import.meta.url), "utf8");
const gateway = readFileSync(new URL("../src/ai/gateway.ts", import.meta.url), "utf8");

/** The branch taken when a round comes back with no tool calls. */
const nothingCalled = (() => {
  const at = loop.indexOf("if (turn.toolCalls.length === 0) {");
  return loop.slice(at, loop.indexOf("\n    }\n", at));
})();

describe("a round that called nothing", () => {
  it("does not end the turn the first time", () => {
    // The old line was `if (turn.toolCalls.length === 0) break;` and that break
    // is the whole bug: a promise with nothing under it was a finished turn.
    expect(loop).not.toMatch(/if \(turn\.toolCalls\.length === 0\) break;/);
    expect(nothingCalled).toMatch(/if \(asked\) break;/);
    expect(nothingCalled).toMatch(/asked = true;/);
  });

  it("says back only what it knows, which is that nothing was called", () => {
    expect(nothingCalled).toContain("You called nothing");
    expect(nothingCalled).toContain("a card is the only thing that changes anything");
    // And leaves the door open for an answer that really needed no tool.
    expect(nothingCalled).toContain("say the same");
  });

  it("reads no words to decide", () => {
    // The failure this exists for is a sentence in English. Matching on one
    // would be a rule that stops working in the next language an owner types.
    expect(nothingCalled).not.toMatch(/\.includes\(|\.match\(|test\(|RegExp|toLowerCase\(/);
    expect(nothingCalled).not.toMatch(/turn\.text\s*(\.|===|!==|\.length)/);
  });

  it("replays what the model said, so the second round can see its own promise", () => {
    expect(nothingCalled).toMatch(/steps\.push\(\{ role: "assistant", content: turn\.text/);
  });

  it("only ever asks once a turn", () => {
    // Twice would be a model that cannot answer a question without a tool
    // arguing with the loop until MAX_STEPS runs out, on the owner's bill.
    expect(loop).toMatch(/let asked = false;/);
    expect((loop.match(/asked = true;/g) ?? []).length).toBe(1);
  });
});

describe("the message the loop sends to say it", () => {
  it("has a shape the wire accepts", () => {
    // A tool result needs a tool_call_id, and there is no call to answer
    // against. This is the loop speaking, so it goes as a user turn.
    expect(gateway).toMatch(/\| \{ role: "user"; content: string \}/);
    expect(nothingCalled).toMatch(/role: "user"/);
  });

  it("is passed through to the model unchanged", () => {
    // buildMessages spreads the steps, so a role it does not know about would
    // be dropped silently rather than refused.
    expect(gateway).toMatch(/\.\.\.\(input\.steps \?\? \[\]\)/);
  });
});
