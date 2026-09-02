/**
 * A yes is answered when the record is written. The index catches up.
 *
 * Every yes on a price re-rendered the owner-updates document, deleted its
 * vectors, embedded it again and wrote it back, inside the request. On the
 * demo account that was seconds to the better part of twenty, during which the
 * only thing on the card that moved was the text on one small button. The
 * owner reported Yes to all as not working and single taps as needing a hard
 * reload; both were a tap that had worked and a card that had not said so.
 *
 * Two halves. The deployment answers once the correction row, which is what
 * the console and the assistant read, is written; the copy the customer's
 * agent retrieves from is refreshed after the answer, on ctx.waitUntil. And
 * the card marks the tapped row as being made the moment it is tapped, with
 * the rest of a run marked next, so nothing on it is ever still.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { evaluateConsole } from "./console-harness.js";

const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const app = readFileSync(new URL("../../console/public/app.js", import.meta.url), "utf8");

let syncCalls = 0;
let syncOutcome: Promise<void> = Promise.resolve();
vi.mock("../src/rag/ingest.js", () => ({
  syncOwnerUpdates: async () => { syncCalls += 1; return syncOutcome; },
  syncNotes: async () => undefined,
}));
const { saveProductEntry, follow } = await import("../src/products.js");

/** A D1 that records the correction and nothing else. */
const writes: unknown[][] = [];
const env = {
  DB: { prepare: () => ({ bind: (...args: unknown[]) => ({ run: async () => { writes.push(args); return {}; } }) }) },
} as never;
const entry = { businessId: "b1", name: "Siphon Brew", price: "7.00", description: "", removed: false };

describe("what follows the answer", () => {
  it("waits for the index when nothing can run after the answer", async () => {
    let settled = false;
    syncOutcome = new Promise((resolve) => setTimeout(() => { settled = true; resolve(); }, 30));
    await saveProductEntry(env, entry);
    expect(settled).toBe(true);
    expect(syncCalls).toBe(1);
  });

  it("answers as soon as the record is written when it can", async () => {
    syncCalls = 0;
    let settled = false;
    syncOutcome = new Promise((resolve) => setTimeout(() => { settled = true; resolve(); }, 30));
    const deferred: Promise<unknown>[] = [];
    const before = writes.length;
    await saveProductEntry(env, entry, (work) => deferred.push(work));
    // Returned with the row written and the index still on its way.
    expect(writes.length).toBe(before + 1);
    expect(settled).toBe(false);
    expect(deferred).toHaveLength(1);
    await deferred[0];
    expect(settled).toBe(true);
  });

  it("logs an index that failed after the answer, and does not throw it", async () => {
    const said: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => { said.push(parts.join(" ")); });
    const deferred: Promise<unknown>[] = [];
    await follow((work) => deferred.push(work), Promise.reject(new Error("Vectorize is away")), "the price list's index");
    await expect(deferred[0]).resolves.toBeUndefined();
    expect(said.join("\n")).toContain("the price list's index did not update after the answer");
    expect(said.join("\n")).toContain("Vectorize is away");
    spy.mockRestore();
  });

  it("is handed ctx.waitUntil by the Worker, and carried to the tool", () => {
    expect(src("index.ts")).toMatch(/handleConsoleApi\(env, request, rest\.slice\("\/api"\.length\), \(work\) => ctx\.waitUntil\(work\)\)/);
    expect(src("web/console-api.ts")).toMatch(/decide\(env, userId, segments\[2\], body\.yes === true, after\)/);
    expect(src("assistant/decide.ts")).toMatch(/const ctx: ToolContext = \{ env, userId, after \}/);
    // Both price tools, and the Price list tab's own writes.
    expect((src("assistant/tools.ts").match(/\}, ctx\.after\);/g) ?? []).length).toBe(2);
    expect((src("web/console-api.ts").match(/\}, after\);/g) ?? []).length).toBe(3);
    // The notes go the same way; they re-index too.
    expect((src("assistant/tools.ts").match(/follow\(ctx\.after, syncNotes/g) ?? []).length).toBe(2);
  });
});

describe("what the card says in the meantime", () => {
  const { approvalCard } = evaluateConsole();
  const change = (id: string, state: string) => ({
    id, messageId: "m2", tool: "save_price", args: { name: id, price: "1.00" },
    summary: `Price: ${id} at 1.00 → Shop`, state, result: "", createdAt: "2026-09-03T00:00:00.000Z",
  });

  it("marks the tapped change as being made, and the rest of a run as next", () => {
    const html = approvalCard([change("a1", "running"), change("a2", "queued"), change("a3", "approved")]);
    expect(html).toContain('class="change running"');
    expect(html).toContain("Making the change…");
    expect(html).toContain('class="change queued"');
    expect(html).toContain(">Next<");
    // Neither is tappable: a second tap on a change in flight is a second write.
    expect(html).not.toContain('data-approve="a1"');
    expect(html).not.toContain('data-approve="a2"');
  });

  it("paints that before the request goes out, on a single yes and on a run", () => {
    const one = app.slice(app.indexOf("async function answerApproval"), app.indexOf("// ------", app.indexOf("async function answerApproval")));
    expect(one.indexOf("markInFlight(approvalId)")).toBeGreaterThan(-1);
    expect(one.indexOf("markInFlight(approvalId)")).toBeLessThan(one.indexOf("await api("));

    const all = app.slice(app.indexOf("async function approveAll"), app.indexOf("async function answerApproval"));
    const loopFrom = all.indexOf("for (const [index");
    const loop = all.slice(loopFrom, all.indexOf("\n  }\n", loopFrom));
    expect(loop).toMatch(/markInFlight\(approval\.id, waiting\.slice\(index \+ 1\)/);
    expect(loop.indexOf("markInFlight(")).toBeLessThan(loop.indexOf("await api("));
  });

  it("is the page's own record, replaced by the deployment's next answer", () => {
    const fn = app.slice(app.indexOf("function markInFlight"), app.indexOf("\n}\n", app.indexOf("function markInFlight")));
    // It rewrites state and repaints; it does not touch the DOM by hand.
    expect(fn).toMatch(/state\.assistant = \{/);
    expect(fn).toMatch(/paintChanges\(\)/);
    expect(fn).not.toMatch(/innerHTML|classList/);
  });
});
