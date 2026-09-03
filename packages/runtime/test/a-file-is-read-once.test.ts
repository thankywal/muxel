/**
 * A file is read into words once, and the words are what travels.
 *
 * The owner sent a price list in the conversation. It was read on arrival, the
 * text was kept, and the assistant proposed filing it under the business. Every
 * attempt came back "conversion failed". The tool had encoded the text back
 * into bytes and handed them over under the file's name, `menu.pdf`; the reader
 * decides what a file is from its name, so it sent a plain-text "PDF" to the
 * platform's document converter, which has no converter for plain text.
 *
 * The test that covered the tool mocked the whole of the reader away, so it
 * proved the tool's intent and nothing about what the reader then did. These
 * run the real reader with only the platform faked, and the platform's
 * converter is a fake that fails the test the moment it is reached.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const seen = vi.hoisted(() => ({
  documents: [] as { filename: string; contentType: string; byteSize: number }[],
  statuses: [] as string[],
  upserted: [] as string[],
  embedded: [] as string[],
}));

vi.mock("../src/db/queries.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createDocument: vi.fn(async (_env: unknown, input: { filename: string; contentType: string; byteSize: number }) => {
    seen.documents.push({ filename: input.filename, contentType: input.contentType, byteSize: input.byteSize });
    return { id: "d1" };
  }),
  setDocumentStatus: vi.fn(async (_env: unknown, input: { status: string }) => {
    seen.statuses.push(input.status);
  }),
  insertChunks: vi.fn(async () => undefined),
}));
vi.mock("../src/ai/gateway.js", () => ({
  embedBatch: vi.fn(async (_env: unknown, texts: readonly string[]) => {
    seen.embedded.push(...texts);
    return texts.map(() => [0.1, 0.2, 0.3]);
  }),
}));

const { ingestDocument } = await import("../src/rag/ingest.js");

/** The platform, with a converter that must never be reached. */
const env = {
  AI: {
    toMarkdown: async () => {
      throw new Error("the converter was reached");
    },
  },
  KNOWLEDGE: {
    upsert: async (rows: { id: string }[]) => {
      seen.upserted.push(...rows.map((row) => row.id));
    },
    query: async () => ({ matches: seen.upserted.map((id) => ({ id, score: 1 })) }),
  },
  DB: {},
} as never;

const PRICE_LIST = [
  "Hanbit Beauty — price list",
  "Hydrating facial 1,200 THB",
  "Brightening facial 1,500 THB",
  "Eyebrow shaping 350 THB",
  "Gel manicure 600 THB",
].join("\n");

const reset = (): void => {
  seen.documents = [];
  seen.statuses = [];
  seen.upserted = [];
  seen.embedded = [];
};

describe("words already read, under a file's name", () => {
  it("are filed without a second reading", async () => {
    reset();
    const result = await ingestDocument(env, {
      businessId: "b1",
      filename: "hanbit-beauty-price-list-2026-09.pdf",
      text: PRICE_LIST,
      settleTimeoutMs: 0,
    });
    // Reaching the converter throws, so getting here at all is the proof; the
    // rest says the filing was a real one.
    expect(result.documentId).toBe("d1");
    expect(result.chunkCount).toBeGreaterThan(0);
    expect(seen.statuses).toEqual(["processing", "ready"]);
    expect(seen.embedded.join("\n")).toContain("Gel manicure 600 THB");
  });

  it("are recorded as the text they are, not as the file they came from", async () => {
    reset();
    await ingestDocument(env, { businessId: "b1", filename: "menu.pdf", text: PRICE_LIST, settleTimeoutMs: 0 });
    // The name is the owner's and stays theirs; the type and size are the
    // words', because the words are all this deployment has.
    expect(seen.documents).toEqual([
      {
        filename: "menu.pdf",
        contentType: "text/plain",
        byteSize: new TextEncoder().encode(PRICE_LIST).byteLength,
      },
    ]);
  });

  it("are refused when there is nothing in them, in the same words a file is", async () => {
    reset();
    await expect(
      ingestDocument(env, { businessId: "b1", filename: "menu.pdf", text: "   ", settleTimeoutMs: 0 }),
    ).rejects.toThrow(/no readable text/);
    expect(seen.documents).toEqual([]);
  });
});

describe("bytes still go to the reader", () => {
  it("so a real PDF is converted exactly as before", async () => {
    reset();
    const converting = {
      ...env,
      AI: {
        toMarkdown: async () => ({ format: "markdown", data: `# menu.pdf\n\n${PRICE_LIST}` }),
      },
    } as never;
    const result = await ingestDocument(converting, {
      businessId: "b1",
      filename: "menu.pdf",
      contentType: "application/pdf",
      body: new TextEncoder().encode("%PDF-1.4 not really, the converter is a fake").buffer as ArrayBuffer,
      settleTimeoutMs: 0,
    });
    expect(result.chunkCount).toBeGreaterThan(0);
    expect(seen.documents[0]?.contentType).toBe("application/pdf");
  });
});

describe("no door turns words back into bytes", () => {
  // The tool did this once: `new TextEncoder().encode(file.text)` under the
  // file's own name. The class is any caller re-encoding kept text into a body
  // for the reader, so the whole of the assistant's tools is held to it.
  const tools = readFileSync(new URL("../src/assistant/tools.ts", import.meta.url), "utf8");

  it("in the assistant's tools", () => {
    expect(tools).not.toMatch(/TextEncoder\(\)\.encode\([^)]*\.text\)/);
    const filing = tools.slice(tools.indexOf('name: "add_file_to_business"'), tools.indexOf('name: "save_price"'));
    expect(filing).toContain("text: file.text");
    expect(filing).not.toContain("contentType");
  });
});
