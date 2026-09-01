/**
 * The answer arrives while it is being worked out, not after.
 *
 * A tool loop takes several seconds and the owner watches every one of them. So
 * the response body is opened before the loop starts and written to as it goes:
 * the tool it is running now, and then the answer. Each event is something that
 * happened, at the moment it happened.
 *
 * The last event carries exactly what the plain JSON call returns, so a console
 * drawing from either has one shape to read, and a script that never asks for
 * the stream keeps the answer it always got.
 */
import { describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({ events: [] as unknown[] }));

vi.mock("../src/assistant/loop.js", () => ({
  ask: vi.fn(async (_env: unknown, input: { onEvent?: (e: unknown) => void }) => {
    // Stands in for the real loop: says what it is doing, then answers.
    input.onEvent?.({ type: "status", label: "Thinking" });
    input.onEvent?.({ type: "step", tool: "list_waiting", ok: true });
    input.onEvent?.({ type: "status", label: "Working" });
    input.onEvent?.({ type: "text", text: "Two are waiting." });
    return { text: "Two are waiting.", approvals: [], steps: [], usage: { model: "m1", inputTokens: 1, outputTokens: 1 } };
  }),
}));
vi.mock("../src/assistant/decide.js", () => ({ decide: vi.fn(async () => ({ ok: true })) }));
vi.mock("../src/assistant/store.js", () => ({
  listChats: vi.fn(async () => []),
  getChat: vi.fn(async () => ({ id: "k1", title: "t", model: "m1", updatedAt: "z" })),
  createChat: vi.fn(async () => ({ id: "k1", title: "t", model: "m1", updatedAt: "z" })),
  setChatModel: vi.fn(async () => undefined),
  deleteChat: vi.fn(async () => undefined),
  chatTranscript: vi.fn(async () => [{ id: "om1", role: "assistant", content: "Two are waiting.", createdAt: "z" }]),
  stepsFor: vi.fn(async () => ({})),
  promptsFor: vi.fn(async () => ({})),
  usageFor: vi.fn(async () => ({})),
  listApprovals: vi.fn(async () => []),
  titleFrom: (t: string) => t,
}));
vi.mock("../src/cloudflare/allowance.js", () => ({
  allowanceNow: vi.fn(async () => ({ neuronsToday: 10, perDay: 10_000, rate: {}, problem: null })),
  neuronsFor: () => null,
}));
vi.mock("../src/cloudflare/access.js", () => ({
  cloudflareAccess: vi.fn(async () => null),
  forgetAccess: vi.fn(async () => undefined),
}));
vi.mock("../src/db/queries.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listBusinesses: vi.fn(async () => [{ id: "b1", name: "Sunrise", model: "m1" }]),
}));
vi.mock("../src/web/console.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  operatorFor: vi.fn(async () => "1"),
}));

const { handleConsoleApi } = await import("../src/web/console-api.js");

const env = { STATE: { get: async () => null, put: async () => undefined } } as never;

const post = (accept?: string) =>
  handleConsoleApi(
    env,
    new Request("https://x.workers.dev/admin/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json", ...(accept ? { accept } : {}) },
      body: JSON.stringify({ text: "what is waiting?", chatId: "k1" }),
    }),
    "/assistant",
  );

/** Reads a whole SSE body into the events it carried, in order. */
async function drain(response: Response): Promise<Record<string, unknown>[]> {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter((frame) => frame.startsWith("data: "))
    .map((frame) => JSON.parse(frame.slice(6)) as Record<string, unknown>);
}

describe("asking with the stream", () => {
  it("reports each thing as it happens, then the finished answer", async () => {
    const response = await post("text/event-stream");
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = await drain(response);
    expect(events.map((e) => e.type)).toEqual(["status", "step", "status", "text", "done"]);
    expect(events[0]).toMatchObject({ label: "Thinking" });
    expect(events[1]).toMatchObject({ tool: "list_waiting", ok: true });
  });

  it("ends with the same payload the plain call returns", async () => {
    // Two shapes for one screen is how the streamed view and the reloaded view
    // come to disagree about what was said.
    const done = (await drain(await post("text/event-stream"))).at(-1) ?? {};
    const plain = (await (await post()).json()) as Record<string, unknown>;
    expect(Object.keys(done).filter((key) => key !== "type").sort()).toEqual(
      Object.keys(plain).sort(),
    );
  });

  it("is never sent to a caller that did not ask for it", async () => {
    const response = await post();
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(((await response.json()) as { text: string }).text).toBe("Two are waiting.");
  });
});
