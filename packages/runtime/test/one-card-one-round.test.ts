/**
 * One card per change, and one round when nothing was read.
 *
 * Reported from the live console with two screenshots. Six prices came back as
 * twelve cards, each item on two identical rows; one price came back as two.
 * And a turn cost twenty thousand tokens, which at five thousand of prefill a
 * round is four rounds for a job that needed one.
 *
 * The same bug. A write is parked, not run, so the round after it has no
 * result to read; the model filled the empty round by proposing everything a
 * second time, which cost another round, and so on. The tool result it was
 * reading opened with "Not done.", which is true and reads as a failure worth
 * retrying.
 *
 * Three things hold now. A round that only proposed, and said what it was
 * proposing, ends the turn. The same tool with the same arguments makes one
 * card however many times it is called. And the sentence the model reads says
 * what happened before it says what did not.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const loop = readFileSync(new URL("../src/assistant/loop.ts", import.meta.url), "utf8");
const code = loop.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const round = (() => {
  const at = code.indexOf("let proposedOnly = true;");
  return code.slice(at, code.indexOf("if (text.length === 0)", at));
})();

describe("a round that only proposed", () => {
  it("ends the turn, when it said what it was proposing", () => {
    expect(round).toMatch(/if \(proposedOnly && turn\.toolCalls\.length > 0 && text\.length > 0\) break;/);
  });

  it("does not end it when the round said nothing", () => {
    // The owner has to be told what the cards are, so a silent round buys the
    // words with one more call.
    expect(round).toContain("text.length > 0");
  });

  it("does not end it when anything was read", () => {
    // A read hands back something the model has not seen. Four places clear
    // the flag: a tool that does not exist, a change refused before it became
    // a card, a read, and a read that threw.
    expect((round.match(/proposedOnly = false;/g) ?? []).length).toBe(4);
    const reading = round.slice(round.indexOf("const result = await tool.run(ctx, call.args);"));
    expect(reading.indexOf("proposedOnly = false;")).toBeLessThan(reading.indexOf("steps.push({"));
  });

  it("starts true on every round, not once for the turn", () => {
    // Held across rounds it would end a turn on a round that read nothing
    // because an earlier round had read something.
    expect(round.indexOf("let proposedOnly = true;")).toBe(0);
    expect(code).toMatch(/for \(const call of turn\.toolCalls\)/);
    expect((code.match(/let proposedOnly = true;/g) ?? []).length).toBe(1);
  });
});

describe("proposing the same change twice", () => {
  it("makes one card, not two", () => {
    expect(round).toMatch(/const same = approvals\.find\(/);
    expect(round).toMatch(/held\.tool === tool\.name && JSON\.stringify\(held\.args\) === JSON\.stringify\(call\.args\)/);
  });

  it("is decided on the record, not on the words", () => {
    // The tool and its arguments are what a change is. Comparing summaries
    // would be comparing prose, and two spellings of one price would be two
    // cards again.
    const guard = round.slice(round.indexOf("const same = approvals.find("), round.indexOf("const approval = await askApproval"));
    expect(guard).not.toMatch(/summarise|\.includes\(|toLowerCase/);
    expect(guard).toContain("JSON.stringify");
  });

  it("tells the model the card already exists rather than failing", () => {
    const guard = round.slice(round.indexOf("if (same !== undefined)"), round.indexOf("const approval = await askApproval"));
    expect(guard).toContain("Already proposed in this message");
    expect(guard).toContain("Do not propose it again");
    // Counted as a step that worked, because it did: the change is proposed.
    expect(guard).toMatch(/took\.push\(\{ tool: tool\.name, ok: true \}\)/);
  });
});

describe("what a parked write says back", () => {
  const parked = (() => {
    const at = code.indexOf("if (tool.writes)");
    return code.slice(at, code.indexOf("if (tool.name === ASK_OWNER)", at));
  })();
  const words = [...parked.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).join("");

  it("says what happened before it says what did not", () => {
    expect(words.indexOf("Proposed.")).toBeGreaterThan(-1);
    expect(words.indexOf("Proposed.")).toBeLessThan(words.indexOf("it has not been made yet"));
  });

  it("says plainly that calling it again is the wrong move", () => {
    expect(words).toContain("This call succeeded");
    expect(words).toContain("second card for the same thing");
  });

  it("still refuses to let the model claim it is done", () => {
    expect(words).toContain("do not say it has been made");
  });
});
