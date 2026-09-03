/**
 * A change that was approved is not proposed again.
 *
 * The failure this fixes, seen live: the assistant proposed a business and its
 * price list, asked the owner to reply "yes", the owner replied yes twice, and
 * it proposed exactly the same thing both times.
 *
 * Two causes, one class. The transcript handed to the model held what it said
 * and not what became of what it asked for, so it could not tell an approved
 * change from one it had never made. And it asked for a word that runs nothing:
 * the button on the card is the only thing that executes a change, so an owner
 * doing exactly what they were told produced no effect at all.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { outcomeNote } from "../src/assistant/loop.js";

const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const loop = src("assistant/loop.ts");
const app = readFileSync(new URL("../../console/public/app.js", import.meta.url), "utf8");

const row = (state: string, extra: Record<string, string> = {}) => ({
  id: "a1",
  messageId: "m1",
  args: {},
  createdAt: "z",
  summary: "Create the business \"Shwe Coffee Shop\"",
  tool: "create_business",
  state,
  result: "",
  ...extra,
}) as never;

describe("what the model is told about its own proposals", () => {
  it("says an approved change is done", () => {
    const note = outcomeNote([row("approved")]);
    expect(note).toContain("Shwe Coffee Shop");
    expect(note).toMatch(/approved this and it is done/);
  });

  it("says a waiting change is waiting, and where the button is", () => {
    expect(outcomeNote([row("waiting")])).toMatch(/still waiting for the owner to tap Yes/);
  });

  it("does not turn a failure into a success", () => {
    // A price added to a business that does not exist fails after the tap. The
    // model has to hear that, or it reports a success the owner never got.
    const note = outcomeNote([row("failed", { result: "That business is not one you can see." })]);
    expect(note).toMatch(/approved but it failed/);
    expect(note).toContain("not one you can see");
  });

  it("says nothing at all for a turn that proposed nothing", () => {
    expect(outcomeNote([])).toBe("");
  });

  it("is attached to the transcript the model reads", () => {
    // Not computed and dropped. The history each turn is built from carries it.
    expect(loop).toMatch(/const decided = await approvalsByMessage\(env, chatId\)/);
    expect(loop).toMatch(/outcomeNote\(decided\[message\.id\] \?\? \[\]\)/);
    expect(loop).toMatch(/\{ role: "user" as const, content: note\.trim\(\) \}/);
  });

  it("is a turn of its own, not a postscript inside the model's own message", () => {
    // It used to be concatenated onto the assistant's content. That made it
    // look like something the assistant had written, and a small model copied
    // the format: an owner was shown "[What you proposed in this message: ...]"
    // as part of the answer, which is this deployment's bookkeeping printed in
    // the reply.
    expect(loop).not.toMatch(/message\.content \+ outcomeNote/);
    // And it says whose it is, so it cannot be read as either side talking.
    expect(outcomeNote([row("approved")])).toContain("Not from the owner.");
    // The prompt says the same thing, because the model has to know not to
    // write anything in that shape itself.
    expect(loop).toContain("never repeat it, and never write anything in that shape yourself");
  });
});

describe("what the model is told to ask for", () => {
  it("is never a typed yes, because a typed yes runs nothing", () => {
    expect(loop).toMatch(/Never ask them to reply/);
    expect(loop).toMatch(/Typing yes does nothing/);
  });

  it("names the control that does run it", () => {
    expect(loop).toMatch(/tap Yes/);
  });

  it("tells it not to propose a thing twice", () => {
    expect(loop).toMatch(/do not propose it again/);
    expect(loop).toMatch(/do not propose it a second time/);
  });

  it("tells it to wait for the business before filling it", () => {
    // Ten prices proposed alongside the business they belong to are ten cards
    // that fail on the tap, because the business id does not exist yet.
    expect(loop).toMatch(/business has to exist before you can add prices/);
  });
});

describe("what the owner sees while something is waiting", () => {
  it("is told once, above the box they are about to type into", () => {
    expect(app).toMatch(/const waiting = approvals\.filter\(\(a\) => a\.state === "waiting"\)/);
    expect(app).toMatch(/waiting for you — tap Yes on the card/);
  });

  it("can get back to the card that raised it", () => {
    // It may be far up the thread by the time they read this.
    expect(app).toMatch(/querySelector\("\.approval\.waiting"\)\?\.scrollIntoView/);
  });
});
