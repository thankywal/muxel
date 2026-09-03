/**
 * A file is a message.
 *
 * The composer took words and nothing else. An owner with a menu in a PDF, or
 * a photograph of the board behind the counter, had no way to hand it over in
 * the conversation: they went to the business, found the Knowledge tab and
 * uploaded it there, and the assistant they had been talking to knew nothing
 * about it.
 *
 * So a file goes in the composer, and three things hold.
 *
 *   It is read once, on arrival, and kept as text. There is no bucket to keep
 *   bytes in on a deployment that has bound none, and what a photograph of a
 *   menu is worth here is the menu.
 *
 *   The text does not go into the transcript. A menu is four thousand
 *   characters; the transcript is what the owner reads back. The turn is told
 *   what arrived, and the model reads what it needs with read_file.
 *
 *   Where it ends up is a change. add_file_to_business is a write, so it
 *   becomes a card and waits for a tap, exactly like a price does.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../../console/public/app.js", import.meta.url), "utf8");

const seen = vi.hoisted(() => ({
  read: [] as { filename: string; bytes: number }[],
  saved: [] as Record<string, unknown>[],
  asked: [] as string[],
  written: [] as { role: string; content: string }[],
  indexed: [] as { businessId: string; filename: string; contentType: string; text: string }[],
  text: "Cappuccino 4.00\nFlat white 4.50\n",
}));

vi.mock("../src/rag/ingest.js", () => ({
  readUpload: vi.fn(async (_env: unknown, input: { filename: string; body: ArrayBuffer }) => {
    seen.read.push({ filename: input.filename, bytes: input.body.byteLength });
    return seen.text;
  }),
  addDocument: vi.fn(async (_env: unknown, input: { businessId: string; filename: string; contentType: string; body: ArrayBuffer }) => {
    seen.indexed.push({
      businessId: input.businessId,
      filename: input.filename,
      contentType: input.contentType,
      text: new TextDecoder().decode(input.body),
    });
    return { documentId: "d1", chunkCount: 2, searchable: true };
  }),
  MAX_DOCUMENT_BYTES: 20 * 1024 * 1024,
  GENERATED_DOCUMENTS: [],
  NOTES_FILENAME: "Notes (console)",
  removeDocument: vi.fn(async () => undefined),
  syncNotes: vi.fn(async () => undefined),
}));
vi.mock("../src/ai/gateway.js", () => ({
  converse: vi.fn(async (_env: unknown, input: { userMessage: string }) => {
    seen.asked.push(input.userMessage);
    return { text: "Two prices on it.", toolCalls: [], raw: {}, inputTokens: 1, outputTokens: 1 };
  }),
}));
vi.mock("../src/assistant/store.js", () => ({
  saveAttachment: vi.fn(async (_env: unknown, row: Record<string, unknown>) => {
    seen.saved.push(row);
    return { id: "at1", filename: row.filename, mime: row.mime, bytes: row.bytes, chars: String(row.text).length };
  }),
  attachmentsByIds: vi.fn(async (_env: unknown, _userId: number, ids: string[]) =>
    ids.map((id) => ({ id, filename: "menu.pdf", mime: "application/pdf", bytes: 900, chars: 31 })),
  ),
  attachmentsFor: vi.fn(async () => ({})),
  attachToMessage: vi.fn(async () => undefined),
  attachmentByName: vi.fn(async (_env: unknown, _userId: number, _chatId: string, filename: string) =>
    filename === "menu.pdf"
      ? { id: "at1", filename, mime: "application/pdf", bytes: 900, chars: 7000, text: "A".repeat(7000) }
      : null,
  ),
  attachmentNames: vi.fn(async () => ["menu.pdf"]),
  getAttachment: vi.fn(async () => null),
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
  canAccessBusiness: vi.fn(async () => true),
}));
vi.mock("../src/web/console.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  operatorFor: vi.fn(async () => "1"),
}));

const { handleConsoleApi } = await import("../src/web/console-api.js");
const { findTool } = await import("../src/assistant/tools.js");
const { fileNote } = await import("../src/assistant/loop.js");

const env = {
  STATE: { get: async () => null, put: async () => undefined },
  DEFAULT_MODEL: "m1",
  DB: { prepare: () => ({ bind: () => ({ first: async () => ({ ok: 1 }) }) }) },
} as never;

const upload = (body: BodyInit, headers: Record<string, string> = {}): Promise<Response> =>
  handleConsoleApi(
    env,
    new Request("https://x.workers.dev/admin/api/assistant/files", {
      method: "POST",
      headers: { "content-type": "application/pdf", ...headers },
      body,
    }),
    "/assistant/files",
  );

const say = (body: Record<string, unknown>): Promise<Response> =>
  handleConsoleApi(
    env,
    new Request("https://x.workers.dev/admin/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    "/assistant",
  );

describe("handing a file over", () => {
  it("reads it once, on the way in, and keeps what came out", async () => {
    seen.read = [];
    seen.saved = [];
    const response = await upload("%PDF-1.4 menu", { "x-filename": "menu.pdf", "x-chat-id": "k1" });
    expect(response.status).toBe(200);
    expect(seen.read).toEqual([{ filename: "menu.pdf", bytes: 13 }]);
    // The text is the record. The bytes are not kept: there is no bucket to
    // keep them in on a deployment that has bound none.
    expect(seen.saved[0]).toMatchObject({ filename: "menu.pdf", chatId: "k1", text: seen.text, bytes: 13 });
    expect(await response.json()).toMatchObject({ ok: true, file: { filename: "menu.pdf", chars: seen.text.length } });
  });

  it("keeps the name the owner gave it, in whatever alphabet", async () => {
    seen.saved = [];
    // A header is latin-1. The other upload doors flatten anything else to
    // underscores, which turns a Burmese menu into ________.pdf on the one
    // screen where the owner has to recognise it again.
    await upload("%PDF-1.4", { "x-filename": encodeURIComponent("မီနူး.pdf") });
    expect(seen.saved[0]).toMatchObject({ filename: "မီနူး.pdf" });
  });

  it("says so plainly when there is nothing in it to read", async () => {
    const was = seen.text;
    seen.text = "   ";
    const response = await upload("%PDF-1.4", { "x-filename": "scan.pdf" });
    seen.text = was;
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe("no_text");
    expect(body.message).toContain("photograph");
  });

  it("refuses an empty file", async () => {
    expect((await upload("")).status).toBe(400);
  });
});

describe("the turn a file arrives in", () => {
  it("tells the model what came and how to read it", async () => {
    seen.asked = [];
    await say({ text: "what is on this?", chatId: "k1", files: ["at1"] });
    const asked = seen.asked[0] ?? "";
    expect(asked).toContain("what is on this?");
    expect(asked).toContain("menu.pdf");
    expect(asked).toContain("read_file");
    expect(asked).toContain("add_file_to_business");
  });

  it("keeps the transcript to what the owner actually typed", async () => {
    seen.written = [];
    await say({ text: "what is on this?", chatId: "k1", files: ["at1"] });
    // Not the file's text, and not the deployment's note about it. An owner
    // reading their own message back should find what they typed.
    expect(seen.written[0]).toEqual({ role: "user", content: "what is on this?" });
  });

  it("is a message even with no words in it", async () => {
    const response = await say({ chatId: "k1", files: ["at1"] });
    expect(response.status).toBe(200);
    expect(seen.asked.at(-1)).toContain("menu.pdf");
  });

  it("is not a message when there is neither", async () => {
    expect((await say({ chatId: "k1" })).status).toBe(400);
  });

  it("names the files without putting their text in the history", () => {
    const note = fileNote([{ filename: "menu.pdf", chars: 4102 }]);
    expect(note).toContain("menu.pdf");
    expect(note).toContain("4102");
    expect(note).toContain("read_file");
    // Marked as this deployment's bookkeeping, the same way the outcome note
    // is, so the model does not read it as words the owner used.
    expect(note).toContain("Not from the owner");
  });
});

describe("reading one", () => {
  const ctx = { env, userId: 1, chatId: "k1" } as never;

  it("comes back in pieces, and says there is more", async () => {
    const first = (await findTool("read_file")?.run(ctx, { filename: "menu.pdf" })) as {
      text: string;
      more: string;
    };
    expect(first.text).toHaveLength(6000);
    expect(first.more).toContain("1000 more characters");
    expect(first.more).toContain("from 6000");
    const rest = (await findTool("read_file")?.run(ctx, { filename: "menu.pdf", from: 6000 })) as {
      text: string;
      more: string;
    };
    expect(rest.text).toHaveLength(1000);
    expect(rest.more).toBe("That is the whole file.");
  });

  it("names what was sent when the model asks for something else", async () => {
    await expect(findTool("read_file")?.run(ctx, { filename: "prices.csv" })).rejects.toThrow(
      /No file called prices\.csv here.*menu\.pdf/s,
    );
  });

  it("is a read, so it runs the moment it is asked for", () => {
    expect(findTool("read_file")?.writes).toBe(false);
  });
});

describe("filing one", () => {
  const ctx = { env, userId: 1, chatId: "k1" } as never;

  it("is a change, so it waits for the owner", () => {
    const tool = findTool("add_file_to_business");
    expect(tool?.writes).toBe(true);
    expect(tool?.summarise?.({ filename: "menu.pdf", business_id: "b1" })).toContain("menu.pdf");
  });

  it("indexes the text that was read, not the file a second time", async () => {
    seen.indexed = [];
    seen.read = [];
    await findTool("add_file_to_business")?.run(ctx, { business_id: "b1", filename: "menu.pdf" });
    expect(seen.indexed).toEqual([
      { businessId: "b1", filename: "menu.pdf", contentType: "text/plain", text: "A".repeat(7000) },
    ]);
    // Reading a photograph twice costs the owner the same call twice, and the
    // two readings can disagree.
    expect(seen.read).toEqual([]);
  });
});

describe("the composer", () => {
  const between = (from: string, to: string) => app.slice(app.indexOf(from), app.indexOf(to, app.indexOf(from)));

  it("hands the file over as it is picked, not when send is pressed", () => {
    const fn = between("async function takeFiles", "\n}\n");
    expect(fn).toContain('api("assistant/files"');
    expect(fn).toContain("encodeURIComponent(file.name)");
    // A chip appears before the request, because reading a PDF takes seconds.
    expect(fn.indexOf("state.files.push(chip)")).toBeLessThan(fn.indexOf("await api("));
  });

  it("takes a file three ways, all ending in the same call", () => {
    const fn = between("function wireFileBox", "\n}\n");
    expect(fn).toContain("picker.click()");
    expect(fn).toContain("ondrop");
    expect(fn).toContain("onpaste");
    expect((fn.match(/takeFiles\(/g) ?? []).length).toBe(3);
  });

  it("sends only the files that have finished being read", () => {
    const fn = between("async function sendToAssistant", "async function askAssistant");
    expect(fn).toMatch(/state\.files\.filter\(\(file\) => file\.id\)/);
    expect(fn).toMatch(/files: files\.map\(\(file\) => file\.id\)/);
  });

  it("gives them back when the message does not go", () => {
    // Re-attaching four files by hand is not a recovery.
    const fn = between("async function sendToAssistant", "async function askAssistant");
    const failed = fn.slice(fn.indexOf("if (!ok) {"));
    expect(failed).toContain("state.files = files;");
  });

  it("offers no paperclip to a deployment that has no door for it", () => {
    const fn = between("function drawAssistant", "/** One turn:");
    expect(fn).toMatch(/state\.apiRevision < NEEDS\.files\s*\n?\s*\?\s*""/);
  });
});
