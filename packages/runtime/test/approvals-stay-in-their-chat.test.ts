/**
 * A change proposed in one conversation stays in it.
 *
 * Reported live: "24 changes waiting for you" followed the owner into every
 * chat, including ones where nothing had been proposed at all.
 *
 * The list was read per owner. Cards were placed correctly, because they match
 * on the message that proposed them, so the leak showed up only in the count —
 * and in Yes to all, which would happily have run changes belonging to a
 * conversation that was not even on screen.
 *
 * There is one way to read these now and it takes a chat. A second way is a
 * second way to leak them.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { listChatApprovals, chatOfApproval } from "../src/assistant/store.js";

const store = readFileSync(new URL("../src/assistant/store.ts", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/web/console-api.ts", import.meta.url), "utf8");

/**
 * A D1 that honours the join and the filters in the statement it is given,
 * rather than sorting and slicing however it likes. A fake that answers every
 * query the same way agrees with a query that forgot its WHERE.
 */
function fakeDb() {
  const messages = [
    { id: "m1", chat_id: "coffee" },
    { id: "m2", chat_id: "coffee" },
    { id: "m9", chat_id: "bakery" },
  ];
  const approvals = [
    { id: "a1", user_id: 1, message_id: "m1", tool: "save_price", args: "{}", summary: "Batch Brew", state: "waiting", result: "", created_at: "1" },
    { id: "a2", user_id: 1, message_id: "m2", tool: "save_price", args: "{}", summary: "Pour Over", state: "waiting", result: "", created_at: "2" },
    { id: "a3", user_id: 1, message_id: "m9", tool: "save_rule", args: "{}", summary: "No Sunday delivery", state: "waiting", result: "", created_at: "3" },
    { id: "a4", user_id: 1, message_id: "", tool: "save_note", args: "{}", summary: "Never shown", state: "waiting", result: "", created_at: "4" },
    { id: "a5", user_id: 2, message_id: "m1", tool: "save_price", args: "{}", summary: "Someone else's", state: "waiting", result: "", created_at: "5" },
  ];
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...bound: unknown[]) => statement(sql, bound),
    all: async () => {
      const [userId, chatId] = args;
      const chatOf = new Map(messages.map((m) => [m.id, m.chat_id]));
      let rows = approvals;
      if (sql.includes("a.user_id = ?")) rows = rows.filter((r) => r.user_id === userId);
      if (sql.includes("m.chat_id = ?")) rows = rows.filter((r) => chatOf.get(r.message_id) === chatId);
      // The JOIN itself drops anything with no message.
      if (sql.includes("JOIN operator_message")) rows = rows.filter((r) => chatOf.has(r.message_id));
      if (sql.includes("a.message_id <> ''")) rows = rows.filter((r) => r.message_id !== "");
      const sorted = [...rows].sort((a, b) => (sql.includes("DESC") ? 1 : -1) * (Number(b.created_at) - Number(a.created_at)));
      return { results: sorted };
    },
    first: async () => {
      const [approvalId, userId] = args;
      const found = approvals.find((r) => r.id === approvalId && r.user_id === userId);
      const chatOf = new Map(messages.map((m) => [m.id, m.chat_id]));
      const chat = found === undefined ? undefined : chatOf.get(found.message_id);
      return chat === undefined ? null : { chat_id: chat };
    },
  });
  return { prepare: (sql: string) => statement(sql) };
}

const env = { DB: fakeDb() } as never;

describe("reading the changes of one conversation", () => {
  it("returns that conversation's, and no others", async () => {
    const coffee = await listChatApprovals(env, 1, "coffee");
    expect(coffee.map((a) => a.id)).toEqual(["a1", "a2"]);
    const bakery = await listChatApprovals(env, 1, "bakery");
    expect(bakery.map((a) => a.id)).toEqual(["a3"]);
  });

  it("leaves out one that was never shown to anybody", async () => {
    // Raised by a turn that failed before it could say anything.
    const all = await listChatApprovals(env, 1, "coffee");
    expect(all.map((a) => a.id)).not.toContain("a4");
  });

  it("leaves out another owner's", async () => {
    expect((await listChatApprovals(env, 1, "coffee")).map((a) => a.id)).not.toContain("a5");
  });

  it("hands them back oldest first, so the business is made before its prices", async () => {
    const coffee = await listChatApprovals(env, 1, "coffee");
    expect(coffee.map((a) => a.createdAt)).toEqual(["1", "2"]);
  });
});

describe("deciding one of them", () => {
  it("works out which conversation it belongs to rather than being told", async () => {
    // A chat id from the browser would be a way to read another one's changes.
    expect(await chatOfApproval(env, 1, "a3")).toBe("bakery");
    expect(await chatOfApproval(env, 2, "a3")).toBeNull();
    expect(api).toMatch(/const chatId = await chatOfApproval\(env, userId, segments\[2\]\)/);
  });
});

describe("the way in", () => {
  it("is the only one", () => {
    // A per-owner reader left lying about is a per-owner reader something will
    // reach for, and the leak comes back.
    expect(store).not.toMatch(/export async function listApprovals\b/);
    expect(api).not.toMatch(/listApprovals\(/);
  });

  it("is what every assistant route uses", () => {
    const assistant = api.slice(api.indexOf('if (segments[0] === "assistant")'), api.indexOf('// GET /agents'));
    const reads = [...assistant.matchAll(/approvals:[\s\S]{0,80}/g)].map((m) => m[0]);
    expect(reads.length).toBeGreaterThanOrEqual(4);
    for (const read of reads) expect(read).toContain("listChatApprovals(env, userId,");
  });
});
