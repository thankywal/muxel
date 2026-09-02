/**
 * A change is to something, and the card says what.
 *
 * Found on the demo deployment's own database. Two approved prices sat under a
 * business called "hello". The owner had asked for a new shop and its prices
 * in one message; the model proposed the shop and, in the same message, twenty
 * prices against the only id it had. The cards said "Price: Batch Brew at
 * $4.00", the owner said yes, and the new shop's list stayed empty while the
 * old one gained two items it does not sell.
 *
 * Three things hold now. A business that does not exist cannot be proposed
 * against. A card names the business it is to. And once a message has proposed
 * creating a business, nothing else in it that names a business is proposed,
 * because the one it should name has no id yet.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { businessIdIn, resolveTarget, summaryFor } from "../src/assistant/target.js";
import { findTool } from "../src/assistant/tools.js";

const loop = readFileSync(new URL("../src/assistant/loop.ts", import.meta.url), "utf8");

/** A D1 with two businesses and one owner. */
function fakeEnv(businesses: Array<{ id: string; name: string }>) {
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...bound: unknown[]) => statement(sql, bound),
    first: async () => {
      if (sql.includes("FROM business WHERE id = ?")) {
        const found = businesses.find((b) => b.id === args[0]);
        if (found === undefined) return null;
        return sql.includes("SELECT name") ? { name: found.name } : { ok: 1 };
      }
      if (sql.includes("FROM operator WHERE")) return { telegram_user_id: args[0], role: "owner" };
      return null;
    },
  });
  return { DB: { prepare: (sql: string) => statement(sql) } } as never;
}

const env = fakeEnv([
  { id: "h0t99fvcn15ardh1", name: "hello" },
  { id: "80v39cm9zjq1x6gq", name: "Shwe Coffee Shop" },
]);

describe("binding a change to its business", () => {
  it("names the business the change is to", async () => {
    const target = await resolveTarget(env, 1, { business_id: "80v39cm9zjq1x6gq", name: "Siphon Brew" });
    expect(target).toEqual({ kind: "business", id: "80v39cm9zjq1x6gq", name: "Shwe Coffee Shop" });
    expect(summaryFor("Price: Siphon Brew at 7.00", target)).toBe("Price: Siphon Brew at 7.00 → Shwe Coffee Shop");
  });

  it("refuses a business that does not exist, even for the owner", async () => {
    // canAccessBusiness says yes to any id for an owner. That was the whole
    // gap: existence was never asked.
    const target = await resolveTarget(env, 1, { business_id: "b1", name: "Siphon Brew" });
    expect(target.kind).toBe("missing");
    if (target.kind === "missing") {
      expect(target.message).toContain("no business with that id");
      // And it says what to do when the business is one being created.
      expect(target.message).toContain("has no id until the owner says yes");
    }
  });

  it("leaves a tool that names no business alone", async () => {
    expect(await resolveTarget(env, 1, { name: "Shwe Coffee Shop" })).toEqual({ kind: "none" });
    expect(businessIdIn({ business_id: " 80v39cm9zjq1x6gq " })).toBe("80v39cm9zjq1x6gq");
  });
});

describe("what the loop does with it", () => {
  const proposing = loop.slice(loop.indexOf("if (tool.writes) {"), loop.indexOf("approvals.push(approval);"));

  it("resolves the business before the card exists, and puts its name on the card", () => {
    expect(proposing).toMatch(/const target = await resolveTarget\(env, userId, call\.args\)/);
    expect(proposing).toMatch(/summary: summaryFor\(/);
  });

  it("makes no card for a business that is missing, and tells the model why", () => {
    expect(proposing).toMatch(/target\.kind === "missing"[\s\S]{0,40}target\.message/);
    expect(proposing).toMatch(/if \(refused !== ""\) \{[\s\S]{0,400}continue;/);
  });

  it("proposes nothing against any business once a creation is waiting in the same message", () => {
    // The prompt says "propose the business, wait until it was approved, and
    // only then propose what goes in it". Said, and not done. This is done.
    expect(proposing).toMatch(/approvals\.find\(\(a\) => a\.tool === "create_business"\)/);
    expect(proposing).toMatch(/creating !== undefined/);
    expect(proposing).toContain("has no id");
  });
});

describe("the second door", () => {
  const tools = readFileSync(new URL("../src/assistant/tools.ts", import.meta.url), "utf8");
  const reachable = tools.slice(tools.indexOf("async function reachable"), tools.indexOf("const BUSINESS_ARG"));

  it("checks the business exists when the change runs, not only when it was proposed", () => {
    // A business can be deleted between the card and the tap.
    expect(reachable).toMatch(/FROM business WHERE id = \?/);
    expect(reachable).toMatch(/There is no business with that id/);
  });

  it("no longer puts an internal id on the delete card", () => {
    // The name comes from the target now. An id is for the tools.
    expect(findTool("delete_business")?.summarise?.({ business_id: "h0t99fvcn15ardh1" })).not.toContain("h0t99");
  });
});

/**
 * And that it proposes all of them.
 *
 * Asked for six prices for a business that already existed, the model proposed
 * two and said it would do the rest once those had been approved. It was
 * reading the first half of "propose one thing at a time when one depends on
 * another" and dropping the condition. Six round trips for a job asked for
 * once, and Yes to all never appears above a single card.
 */
describe("how many changes one message may carry", () => {
  const prompt = loop.slice(loop.indexOf("function systemPrompt"), loop.indexOf("\n}\n", loop.indexOf("function systemPrompt")));

  it("says the default is all of them, before it says anything about waiting", () => {
    const all = prompt.indexOf("Propose everything the owner asked for");
    const exception = prompt.indexOf("The exception is a change that needs another one");
    expect(all).toBeGreaterThan(-1);
    expect(exception).toBeGreaterThan(all);
  });

  it("keeps the one real dependency, and closes the door on inventing others", () => {
    expect(prompt).toContain("the business has to exist before you can add prices");
    expect(prompt).toContain("Nothing else waits for anything.");
  });

  it("no longer carries the sentence that was misread", () => {
    expect(prompt).not.toContain("Propose one thing at a time");
  });
});
