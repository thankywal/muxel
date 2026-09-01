/**
 * What the assistant looked at is a record, not a caption.
 *
 * The loop already knew which tools it ran and threw the list away when the
 * request ended, so a reopened conversation showed the conclusion with no
 * working behind it. These hold that the list is written down against the
 * answer it produced, read back in the order it happened, and removed when the
 * conversation is.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { recordSteps, stepsFor, deleteChat } from "../src/assistant/store.js";

const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

/**
 * A D1 that keeps the rows.
 *
 * It reads the ORDER BY out of the statement rather than sorting how it likes,
 * and it stores rows in the reverse of the order they were inserted, so a query
 * that forgot to ask for an order, or asked for the wrong one, comes back wrong
 * here too. A fake that sorts on its own would agree with any query at all.
 */
function fakeDb() {
  const steps: { message_id: string; seq: number; tool: string; ok: number }[] = [];
  const chatOf: Record<string, string> = { m1: "k1", m2: "k1", m3: "k2" };
  let batches = 0;
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...bound: unknown[]) => statement(sql, bound),
    run: async () => {
      if (sql.startsWith("INSERT INTO operator_step")) {
        steps.unshift({
          message_id: String(args[1]),
          seq: Number(args[2]),
          tool: String(args[3]),
          ok: Number(args[4]),
        });
      }
      if (sql.startsWith("DELETE FROM operator_step")) {
        const gone = Object.entries(chatOf)
          .filter(([, chat]) => chat === String(args[0]))
          .map(([id]) => id);
        for (let i = steps.length - 1; i >= 0; i -= 1) {
          if (gone.includes(steps[i]!.message_id)) steps.splice(i, 1);
        }
      }
      return {};
    },
    all: async () => {
      const rows = steps.filter((row) => chatOf[row.message_id] === String(args[0]));
      const order = /ORDER BY s\.seq(\s+DESC)?/.exec(sql);
      if (order !== null) {
        rows.sort((a, b) => (order[1] === undefined ? a.seq - b.seq : b.seq - a.seq));
      }
      return { results: rows };
    },
    first: async () => null,
  });
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (list: { run: () => Promise<unknown> }[]) => {
      batches += 1;
      for (const one of list) await one.run();
      return [];
    },
    steps,
    batches: () => batches,
  };
}

describe("the assistant's working", () => {
  it("keeps the tools it ran against the answer they produced", async () => {
    const DB = fakeDb();
    const env = { DB } as never;
    await recordSteps(env, "m1", [
      { tool: "list_waiting", ok: true },
      { tool: "read_conversation", ok: false },
    ]);
    await recordSteps(env, "m3", [{ tool: "list_businesses", ok: true }]);

    const byMessage = await stepsFor(env, "k1");
    // In the order it happened, and only this chat's.
    expect(byMessage.m1).toEqual([
      { tool: "list_waiting", ok: true },
      { tool: "read_conversation", ok: false },
    ]);
    expect(byMessage.m3).toBeUndefined();
  });

  it("does not touch the database when nothing ran", async () => {
    // A turn the model answered straight off has no working. Sending an empty
    // batch would spend a D1 round trip to write nothing.
    const DB = fakeDb();
    await recordSteps({ DB } as never, "m1", []);
    expect(DB.steps).toEqual([]);
    expect(DB.batches()).toBe(0);
  });

  it("takes the working with the conversation", async () => {
    const DB = fakeDb();
    const env = { DB } as never;
    await recordSteps(env, "m1", [{ tool: "list_waiting", ok: true }]);
    await recordSteps(env, "m3", [{ tool: "list_businesses", ok: true }]);
    await deleteChat(env, 1, "k1");
    // k1's rows are gone; the other conversation's are untouched.
    expect(DB.steps.map((row) => row.message_id)).toEqual(["m3"]);
  });
});

describe("the loop writes it down", () => {
  it("records the tools it took, against the answer it just stored", () => {
    const loop = src("assistant/loop.ts");
    // The id it records against is the assistant message, not the question:
    // the working belongs to the answer it produced.
    expect(loop).toMatch(/const answerId = await addOperatorMessage\(/);
    expect(loop).toMatch(/recordSteps\(env, answerId, took\)/);
  });

  it("does not lose the answer if the working cannot be stored", () => {
    // The owner asked a question. A failure writing the footnotes is not a
    // reason to fail the reply.
    expect(src("assistant/loop.ts")).toMatch(/recordSteps\(env, answerId, took\)\.catch\(/);
  });

  it("hands the same list to the browser that it stored", () => {
    // One record, two readers. If the API derived this from anything else the
    // live reply and the reloaded one could disagree.
    expect(src("web/console-api.ts")).toMatch(/steps: await stepsFor\(env, chat\.id\)/);
  });
});
