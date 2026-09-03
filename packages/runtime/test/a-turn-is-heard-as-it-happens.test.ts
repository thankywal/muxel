/**
 * A turn is heard as it happens.
 *
 * Reported from the live console: "Working / tool operation လုပ်နေချိန်တွေ
 * first token ထွက်ဖို့ စောင့်နေရတာ ကြာနေတယ်" — and, on the same turn, the model
 * promised something, ran its tools, and stopped without saying anything.
 *
 * Both were the same mechanism. A turn is several rounds and the model speaks
 * on most of them, but the loop held one string and overwrote it every round.
 * Only the first sentence and the last one survived, both arrived together at
 * the end, and everything in between — the reason it was reading again, the
 * fact that the last read was cut off — was deleted before anyone saw it.
 *
 * So the words are a list now, each one sent the moment it is said. And a tool
 * says it has started, not only that it has finished: reading a long file or
 * indexing one is the several seconds in the middle of a turn that used to show
 * nothing at all.
 *
 * This is round level, not token level. The model's own tokens are still
 * collected before the round returns; what changed is that a round no longer
 * waits for the turn.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../../console/public/app.js", import.meta.url), "utf8");

const seen = vi.hoisted(() => ({ rounds: [] as { text: string; calls: unknown[] }[], at: 0 }));

vi.mock("../src/ai/gateway.js", () => ({
  converse: vi.fn(async () => {
    const round = seen.rounds[seen.at] ?? { text: "", calls: [] };
    seen.at += 1;
    return { text: round.text, toolCalls: round.calls, raw: {}, inputTokens: 1, outputTokens: 1 };
  }),
}));
vi.mock("../src/assistant/store.js", () => ({
  addOperatorMessage: vi.fn(async () => "om1"),
  approvalsByMessage: vi.fn(async () => ({})),
  askApproval: vi.fn(async (_e: unknown, input: { summary: string }) => ({ id: "a1", summary: input.summary })),
  attachApprovals: vi.fn(async () => undefined),
  attachToMessage: vi.fn(async () => undefined),
  attachmentsByIds: vi.fn(async () => []),
  attachmentsFor: vi.fn(async () => ({})),
  attachmentByName: vi.fn(async () => ({ id: "at1", filename: "menu.pdf", mime: "application/pdf", bytes: 9, chars: 9, text: "A".repeat(9000) })),
  attachmentNames: vi.fn(async () => ["menu.pdf"]),
  chatTranscript: vi.fn(async () => []),
  recordPrompt: vi.fn(async () => undefined),
  recordSteps: vi.fn(async () => undefined),
  recordUsageFor: vi.fn(async () => undefined),
}));
vi.mock("../src/db/queries.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listBusinesses: vi.fn(async () => [{ id: "b1", name: "Hanbit Beauty", model: "m1" }]),
  canAccessBusiness: vi.fn(async () => true),
}));
vi.mock("../src/rag/nutrient.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  documentDataConfigured: vi.fn(async () => false),
}));
vi.mock("../src/web-search.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  webSearchConfigured: vi.fn(async () => false),
}));

const { ask } = await import("../src/assistant/loop.js");

const env = {
  DEFAULT_MODEL: "m1",
  DB: { prepare: () => ({ bind: () => ({ first: async () => ({ ok: 1, name: "Hanbit Beauty" }) }) }) },
} as never;

/** Runs a turn made of the given rounds and collects what went down the wire. */
async function turn(rounds: { text: string; calls?: unknown[] }[]) {
  seen.rounds = rounds.map((r) => ({ text: r.text, calls: r.calls ?? [] }));
  seen.at = 0;
  const events: { type: string; text?: string; tool?: string; ok?: boolean | null }[] = [];
  const reply = await ask(env, {
    userId: 1,
    chatId: "k1",
    question: "read the menu and add the prices",
    model: "m1",
    onEvent: (e) => events.push(e as never),
  });
  return { events, reply };
}

const readFile = (id: string) => ({
  id,
  name: "read_file",
  args: { filename: "menu.pdf" },
});

describe("what the model says on the way", () => {
  it("reaches the owner round by round, not all at the end", async () => {
    const { events } = await turn([
      { text: "Let me look at the full list first.", calls: [readFile("c1")] },
      { text: "The last read was cut off, reading the rest.", calls: [readFile("c2")] },
      { text: "Here are the four prices I found." },
      { text: "Here are the four prices I found." },
    ]);
    const said = events.filter((e) => e.type === "text").map((e) => e.text);
    expect(said).toEqual([
      "Let me look at the full list first.",
      "The last read was cut off, reading the rest.",
      "Here are the four prices I found.",
    ]);
    // Each one before the tool it explains, which is the point of saying it.
    const first = events.findIndex((e) => e.type === "text");
    expect(events.findIndex((e) => e.type === "step")).toBeGreaterThan(first);
  });

  it("keeps every one of them in the answer, in order", async () => {
    const { reply } = await turn([
      { text: "Reading it now.", calls: [readFile("c1")] },
      { text: "Cut off, reading on.", calls: [readFile("c2")] },
      { text: "Four prices." },
      { text: "Four prices." },
    ]);
    expect(reply.text).toBe("Reading it now.\n\nCut off, reading on.\n\nFour prices.");
  });

  it("does not say the same thing twice when the model repeats itself", async () => {
    // A round that called nothing is told so and invited to say the same thing
    // again if it really was an answer. Taking it at its word twice would put
    // the sentence on screen twice.
    const { reply, events } = await turn([
      { text: "Nothing to change here." },
      { text: "Nothing to change here." },
    ]);
    expect(reply.text).toBe("Nothing to change here.");
    expect(events.filter((e) => e.type === "text")).toHaveLength(1);
  });

  it("still says something when the model said nothing at all", async () => {
    const { reply } = await turn([{ text: "" }, { text: "" }]);
    expect(reply.text).toContain("could not finish");
  });
});

describe("what a tool says about itself", () => {
  it("says it has started before it says how it went", async () => {
    const { events } = await turn([
      { text: "Reading.", calls: [readFile("c1")] },
      { text: "Done reading." },
      { text: "Done reading." },
    ]);
    const steps = events.filter((e) => e.type === "step");
    expect(steps.map((s) => s.ok)).toEqual([null, true]);
    expect(steps.every((s) => s.tool === "read_file")).toBe(true);
  });

  it("says nothing has started for a change, which runs nothing", async () => {
    // A write is not run. It becomes a card, and a card is not work in flight.
    const { events } = await turn([
      { text: "Proposing it.", calls: [{ id: "c1", name: "save_price", args: { business_id: "b1", name: "Toner", price: "450" } }] },
    ]);
    const steps = events.filter((e) => e.type === "step");
    expect(steps.map((s) => s.ok)).toEqual([true]);
  });
});

describe("how the console draws it", () => {
  it("types on from where the words already are", () => {
    // Each arrival brings the body up to everything said so far. Re-typing
    // from zero would rewrite the paragraphs already on screen.
    const fn = app.slice(app.indexOf("async function typeOut"), app.indexOf("\n}\n", app.indexOf("async function typeOut")));
    expect(fn).toMatch(/const from = \(turn\.__painted \?\? ""\)\.length/);
    expect(fn).toMatch(/for \(let cut = from;/);
    expect(fn).toMatch(/turn\.__painted = text/);
  });

  it("holds the words as a list and joins them, the way the deployment does", () => {
    const handler = app.slice(app.indexOf('if (event.type === "text")'));
    expect(handler.slice(0, 260)).toMatch(/turn\.__said = \[\.\.\.\(turn\.__said \?\? \[\]\), event\.text\]/);
    expect(handler.slice(0, 260)).toMatch(/typeOut\(turn\.__said\.join\("\\n\\n"\)\)/);
  });

  it("shows a running tool as running, not as one that failed", () => {
    // The pill keyed on `ok ? 1 : 0`, so a tool still going drew the red one.
    const fn = app.slice(app.indexOf("function stepPills"), app.indexOf("\n}\n", app.indexOf("function stepPills")));
    expect(fn).toMatch(/step\.ok === null \? "r"/);
    expect(fn).toMatch(/step\.ok === null \? "running"/);
    // No tick on something that has not been ticked off.
    expect(fn).toMatch(/const mark = step\.ok === null \? ""/);
  });

  it("replaces the running row when the tool lands, rather than adding one", () => {
    const handler = app.slice(app.indexOf('if (event.type === "step")'));
    expect(handler.slice(0, 500)).toMatch(/findIndex\(\(s\) => s\.tool === event\.tool && s\.ok === null\)/);
  });
});
