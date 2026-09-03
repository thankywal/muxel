/**
 * A tap is answered.
 *
 * Saying yes to a card ended the conversation. The row went green, a toast
 * said "Done." and nothing else was ever said, so an owner who had just
 * approved six prices had to leave the chat and open the price list to find
 * out what they now had. Green is a claim about a request; it is not a claim
 * about the business.
 *
 * So a tap starts a turn, the same way typing does. Two things make it a turn
 * about the record rather than about the card:
 *
 *   The instruction is composed by the deployment and tells the model to look
 *   — call get_business and read what comes back — and not to describe the
 *   card, which it can already see and which says only what was asked for.
 *
 *   It is not written into the transcript as words the owner used, because a
 *   tap is not a sentence. It reaches the model and stops there; what is kept
 *   is the answer.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const app = readFileSync(new URL("../../console/public/app.js", import.meta.url), "utf8");

const seen = vi.hoisted(() => ({
  asked: [] as { userMessage: string }[],
  written: [] as { role: string; content: string }[],
}));

vi.mock("../src/ai/gateway.js", () => ({
  converse: vi.fn(async (_env: unknown, input: { userMessage: string }) => {
    seen.asked.push({ userMessage: input.userMessage });
    return { text: "You now have six prices on Shwe Coffee Shop.", toolCalls: [], raw: {}, inputTokens: 5, outputTokens: 5 };
  }),
}));
vi.mock("../src/assistant/store.js", () => ({
  addOperatorMessage: vi.fn(async (_env: unknown, row: { role: string; content: string }) => {
    seen.written.push({ role: row.role, content: row.content });
    return `om${seen.written.length}`;
  }),
  approvalsByMessage: vi.fn(async () => ({})),
  askApproval: vi.fn(async () => ({ id: "a1" })),
  attachApprovals: vi.fn(async () => undefined),
  chatTranscript: vi.fn(async () => []),
  recordPrompt: vi.fn(async () => undefined),
  recordSteps: vi.fn(async () => undefined),
  recordUsageFor: vi.fn(async () => undefined),
  listChats: vi.fn(async () => []),
  getChat: vi.fn(async () => ({ id: "k1", title: "t", model: "m1", updatedAt: "z" })),
  createChat: vi.fn(async () => ({ id: "k1", title: "t", model: "m1", updatedAt: "z" })),
  setChatModel: vi.fn(async () => undefined),
  deleteChat: vi.fn(async () => undefined),
  stepsFor: vi.fn(async () => ({})),
  promptsFor: vi.fn(async () => ({})),
  usageFor: vi.fn(async () => ({})),
  listChatApprovals: vi.fn(async () => []),
  chatOfApproval: vi.fn(async () => "k1"),
  titleFrom: (t: string) => t,
}));
vi.mock("../src/assistant/decide.js", () => ({ decide: vi.fn(async () => ({ ok: true })) }));
vi.mock("../src/cloudflare/allowance.js", () => ({
  allowanceNow: vi.fn(async () => ({ neuronsToday: 1, perDay: 10_000, rate: {}, problem: null })),
  neuronsFor: () => null,
}));
vi.mock("../src/cloudflare/access.js", () => ({
  cloudflareAccess: vi.fn(async () => null),
  forgetAccess: vi.fn(async () => undefined),
}));
vi.mock("../src/db/queries.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listBusinesses: vi.fn(async () => [{ id: "b1", name: "Shwe Coffee Shop", model: "m1" }]),
}));
vi.mock("../src/web/console.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  operatorFor: vi.fn(async () => "1"),
}));

const { handleConsoleApi } = await import("../src/web/console-api.js");

const env = { STATE: { get: async () => null, put: async () => undefined }, DEFAULT_MODEL: "m1" } as never;

const post = (body: Record<string, unknown>): Promise<Response> =>
  handleConsoleApi(
    env,
    new Request("https://x.workers.dev/admin/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    "/assistant",
  );

describe("the turn a tap starts", () => {
  it("asks the model to read the record, not to describe the card", async () => {
    seen.asked = [];
    seen.written = [];
    await post({ after: "approvals", chatId: "k1" });
    const question = seen.asked[0]?.userMessage ?? "";
    expect(question).toContain("get_business");
    expect(question).toContain("Do not describe the card");
    // What the owner is owed: what they have now, and what did not go through.
    expect(question).toContain("what they now have");
    expect(question).toContain("did not go through");
  });

  it("puts nothing in the transcript as the owner's words", async () => {
    seen.asked = [];
    seen.written = [];
    await post({ after: "approvals", chatId: "k1" });
    // Only the answer is kept. A row saying "The owner has just answered the
    // changes on the card above" would be this deployment's bookkeeping shown
    // to the owner as something they said.
    expect(seen.written.map((row) => row.role)).toEqual(["assistant"]);
    expect(seen.written[0]?.content).toContain("six prices");
  });

  it("still writes what somebody actually typed", async () => {
    seen.written = [];
    await post({ text: "how many prices are on Shwe?", chatId: "k1" });
    expect(seen.written[0]).toMatchObject({ role: "user", content: "how many prices are on Shwe?" });
    expect(seen.written[1]?.role).toBe("assistant");
  });

  it("belongs to the conversation the card is in, and starts no new one", async () => {
    // There is nothing to title a new chat with, and a card always has a chat.
    const response = await post({ after: "approvals" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "no_chat" });
  });
});

/** The console's own half, lifted out and run. */
const reportOnTaps = (source: Record<string, unknown>): ((...args: unknown[]) => Promise<unknown>) => {
  const at = app.indexOf("async function reportOnTaps");
  const body = app.slice(at, app.indexOf("\n}\n", at) + 3);
  const table = app.slice(app.indexOf("const NEEDS = {"), app.indexOf("};", app.indexOf("const NEEDS = {")) + 2);
  const sandbox = { AbortController, ...source } as Record<string, unknown>;
  // The real table, not a copy of it: what this gate reads is the same entry
  // every page reads.
  runInNewContext(`${table}\n${body}\nthis.fn = reportOnTaps;`, sandbox);
  return sandbox.fn as (...args: unknown[]) => Promise<unknown>;
};

/** A console with a chat open and a thread to write into. */
function console_(over: Record<string, unknown> = {}) {
  const html: string[] = [];
  const calls: unknown[] = [];
  const drawn: string[] = [];
  const nodes: Record<string, unknown> = {
    asThread: { insertAdjacentHTML: (_where: string, markup: string) => html.push(markup), scrollTop: 0, scrollHeight: 9 },
    asText: { disabled: false },
    asSend: { hidden: false },
    asStop: { hidden: true },
    asThinking: { remove: () => drawn.push("removed") },
    chatList: null,
  };
  const state = { chatId: "k1", apiRevision: 18, pending: null, stopped: false, assistant: { messages: [] }, chats: [], newChat: true, ...over };
  const world = {
    state,
    $: (id: string) => nodes[id] ?? null,
    h: (t: string) => t,
    modelLabel: () => "Qwen",
    md: (t: string) => t,
    askAssistant: async (body: unknown) => {
      calls.push(body);
      return { ok: true, data: { messages: [{ id: "om1" }], chats: [{ id: "k1" }] } };
    },
    viewAssistant: () => drawn.push("reloaded"),
    drawAssistant: () => drawn.push("drawn"),
    chatRail: () => "",
    bindChatRail: () => undefined,
    ...over,
  };
  return { world, html, calls, drawn, state };
}

describe("what the console does with a tap", () => {
  it("asks for the tapped turn, with no words of its own", async () => {
    const { world, calls } = console_();
    await reportOnTaps(world)();
    // The instruction lives in the deployment. If the browser sent the words,
    // an older console would be sending a different question to the same API.
    expect(calls).toEqual([{ after: "approvals", chatId: "k1" }]);
  });

  it("draws the turn with no bubble above it, because the card is the bubble", async () => {
    const { world, html } = console_();
    await reportOnTaps(world)();
    expect(html.join("")).toContain('id="asThinking"');
    expect(html.join("")).toContain("Checking what changed");
    expect(html.join("")).not.toContain("turn user");
  });

  it("settles into the record it gets back", async () => {
    const { world, drawn, state } = console_();
    await reportOnTaps(world)();
    expect(drawn).toEqual(["drawn"]);
    expect(state.assistant).toMatchObject({ messages: [{ id: "om1" }] });
  });

  it("says nothing when the turn does not come back", async () => {
    // The taps landed; that is the record and it is already on the screen.
    // A failed follow-up must not overwrite it with an empty one.
    const { world, drawn } = console_({ askAssistant: async () => ({ ok: false, data: {} }) });
    await reportOnTaps(world)();
    expect(drawn).toEqual(["removed"]);
  });

  it("does not start one while a turn is already running", async () => {
    const { world, calls } = console_({ pending: { signal: {} } });
    await reportOnTaps(world)();
    expect(calls).toEqual([]);
  });

  it("does not start one from outside the conversation", async () => {
    const { world, calls } = console_({ chatId: null });
    await reportOnTaps(world)();
    expect(calls).toEqual([]);
  });

  it("does not ask a deployment that cannot answer it", async () => {
    // The console updates on its own; the deployment updates when its owner
    // presses a button. An older one reads the request as an empty message and
    // refuses, and the owner would watch a turn appear and vanish.
    const { world, calls } = console_({ apiRevision: 17 });
    await reportOnTaps(world)();
    expect(calls).toEqual([]);
  });
});

describe("where it is called from", () => {
  const between = (from: string, to: string) => app.slice(app.indexOf(from), app.indexOf(to, app.indexOf(from)));

  it("runs after a single yes or no, once the record has been drawn", () => {
    const one = between("async function answerApproval", "async function reportOnTaps");
    expect(one).toContain("await reportOnTaps();");
    expect(one.indexOf("drawAssistant();")).toBeLessThan(one.indexOf("await reportOnTaps();"));
  });

  it("runs once for a whole run of them, not once a card", () => {
    // Yes to all on six prices is one question. Six turns would be six bills
    // for the same answer.
    const all = between("async function approveAll", "async function answerApproval");
    expect((all.match(/reportOnTaps\(\)/g) ?? []).length).toBe(1);
    const loopEnd = all.indexOf("if (last) state.assistant");
    expect(all.indexOf("await reportOnTaps();")).toBeGreaterThan(loopEnd);
  });
});
