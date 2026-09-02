/**
 * A change waiting for the owner is a change they can reach.
 *
 * Seen live: "25 changes waiting for you — tap Do it on the card", and no card
 * anywhere on the screen. The count was right and every card had been thrown
 * away.
 *
 * The two halves disagreed about what an approval's message id meant. The loop
 * filed each one against the owner's own question, because when a write is
 * parked that is the only message that exists yet. The console draws cards on
 * answers and returns early on a question, so it discarded every one of them.
 *
 * Neither half was unreasonable on its own, and no test held them against each
 * other — the render fixtures had been written by hand with the approval on an
 * assistant message, which is the shape the runtime never produced. So these
 * pin both ends of the same fact: a card is drawn on an answer, and an approval
 * names the answer that proposed it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { evaluateConsole } from "./console-harness.js";
import { attachApprovals } from "../src/assistant/store.js";

const loop = readFileSync(new URL("../src/assistant/loop.ts", import.meta.url), "utf8");
const store = readFileSync(new URL("../src/assistant/store.ts", import.meta.url), "utf8");
const { turnHtml } = evaluateConsole();

const CARD = {
  id: "a1",
  messageId: "m2",
  tool: "create_business",
  args: { name: "Shwe Coffee Shop" },
  summary: 'Create the business "Shwe Coffee Shop"',
  state: "waiting",
  result: "",
  createdAt: "2026-09-02T00:00:00.000Z",
};
const at = "2026-09-02T00:00:00.000Z";

describe("where a card can be drawn", () => {
  it("appears under an answer", () => {
    const html = turnHtml({ id: "m2", role: "assistant", content: "I have put it below.", createdAt: at }, [], [CARD]);
    expect(html).toContain("Shwe Coffee Shop");
    expect(html).toContain("data-approve=");
  });

  it("cannot appear under the owner's own question", () => {
    // This is not a bug to fix in the console — a question is not a proposal,
    // and the owner did not propose anything. It is the reason an approval may
    // never be filed against one.
    const html = turnHtml({ id: "m1", role: "user", content: "I want a coffee shop", createdAt: at }, [], [CARD]);
    expect(html).not.toContain("data-approve=");
  });
});

describe("where an approval is filed", () => {
  it("is raised with no message, because none exists yet", () => {
    // The loop is still working when a write is parked. The owner's question is
    // the only id available, and it is the wrong one.
    expect(store).toMatch(/const messageId = "";/);
    expect(store.slice(store.indexOf("export async function askApproval"))).not.toMatch(
      /input: \{[^}]*messageId/s,
    );
  });

  it("is filed against the answer, in the same breath as writing it", () => {
    const answer = loop.indexOf("const answerId = await addOperatorMessage(");
    const attach = loop.indexOf("attachApprovals(env,");
    expect(answer).toBeGreaterThan(-1);
    expect(attach).toBeGreaterThan(answer);
    expect(loop.slice(attach, attach + 160)).toContain("answerId");
  });

  it("does not swallow a failure to file it", () => {
    // Steps and usage are footnotes; losing one costs a detail. An approval
    // that is not filed is one the owner is told about and cannot reach, which
    // is the whole of this bug.
    const attach = loop.indexOf("attachApprovals(env,");
    const statement = loop.slice(attach, loop.indexOf(";", attach));
    expect(statement).not.toContain(".catch(");
  });

  it("hands the answer's id straight back, so the card draws without a reload", () => {
    expect(loop).toMatch(/approvals: approvals\.map\(\(approval\) => \(\{ \.\.\.approval, messageId: answerId \}\)\)/);
  });
});

describe("what the owner is counted as waiting on", () => {
  it("is only what they were shown", () => {
    // A turn that raised a write and then failed before saying anything leaves
    // an approval with no message. Counting it promises a card nobody drew.
    expect(store).toMatch(/message_id <> ''/);
  });
});

describe("filing them", () => {
  /** A D1 that records the updates, so the batching is real. */
  function fakeDb() {
    const runs: { sql: string; args: unknown[] }[] = [];
    const statement = (sql: string, args: unknown[] = []) => ({
      bind: (...bound: unknown[]) => statement(sql, bound),
      run: async () => void runs.push({ sql, args }),
    });
    return {
      prepare: (sql: string) => statement(sql),
      batch: async (list: { run: () => Promise<unknown> }[]) => {
        for (const one of list) await one.run();
        return [];
      },
      runs,
    };
  }

  it("moves every one of them, in one batch", async () => {
    const DB = fakeDb();
    await attachApprovals({ DB } as never, ["a1", "a2", "a3"], "m9");
    expect(DB.runs).toHaveLength(3);
    expect(DB.runs.every((run) => run.args[0] === "m9")).toBe(true);
    expect(DB.runs.map((run) => run.args[1])).toEqual(["a1", "a2", "a3"]);
  });

  it("does not touch the database when the turn proposed nothing", async () => {
    const DB = fakeDb();
    await attachApprovals({ DB } as never, [], "m9");
    expect(DB.runs).toHaveLength(0);
  });
});
