/**
 * Document ingestion.
 *
 * Uploads arrive in whatever the operator had to hand: a price list exported
 * from Excel, a policy in Word, a plain text note, a product dump as JSONL.
 * Each is turned into text, split and indexed by the same path, so retrieval
 * does not care where a fact came from.
 *
 * Text formats are decoded directly rather than sent through the markdown
 * converter. It is cheaper, it cannot fail, and it avoids a round trip for
 * content that is already text.
 */

import { chunkText, generateId, MuxelError } from "@muxel/core";

import { embedBatch } from "../ai/gateway.js";
import {
  createDocument,
  deleteDocument,
  findDocumentByName,
  getBusiness,
  insertChunks,
  listNotes,
  recordEvent,
  setDocumentStatus,
} from "../db/queries.js";
import type { Env } from "../env.js";
import { listCorrections, renderOwnerUpdates } from "../products.js";
import { markExtractionPending, OWNER_UPDATES_FILENAME, runExtraction } from "./extract.js";
import { extractPdfText } from "./pdf.js";

/** Largest upload accepted. Telegram itself caps bot downloads at 20 MB. */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

/** Vectorize accepts a bounded number of vectors per upsert call. */
const UPSERT_BATCH = 100;

/** Embedding calls are batched to stay inside the per request subrequest budget. */
const EMBED_BATCH = 25;

/** Shortest body accepted. Less than this means nothing readable was found. */
const MIN_CONTENT_CHARS = 40;

/** Name of the document generated from hand entered products. */
// The retired synthetic catalogue. Migration 8 removes it from the data.

/**
 * Where an upload has got to, reported while it happens.
 *
 * An upload takes long enough that a still message reading "wait a moment"
 * leaves the operator with no way to tell a slow index from a broken one, so
 * they either sit staring at a chat or test too early and conclude it failed.
 * Embedding knows exactly how far along it is. The wait afterwards does not,
 * because the index never says how close it is, so that one is reported
 * against the time it is allowed rather than invented.
 */
export type IngestProgress =
  | { readonly phase: "embedding"; readonly done: number; readonly total: number }
  | { readonly phase: "settling"; readonly elapsedMs: number; readonly timeoutMs: number };

interface IngestCommon {
  readonly businessId: string;
  readonly filename: string;
  /** Called as work proceeds. Anything it throws is ignored. */
  readonly onProgress?: (progress: IngestProgress) => Promise<void> | void;
  /** How long to wait for the index, when the caller can show the wait. */
  readonly settleTimeoutMs?: number;
}

/** A file as it arrived: the bytes, and what the sender said they were. */
export interface IngestFile extends IngestCommon {
  readonly contentType: string;
  readonly body: ArrayBuffer;
}

/**
 * Text that has already been read out of a file, still under the file's name.
 *
 * A file is read into words once, at the door it came through, and the words
 * are what is kept. This is the shape for handing those words on. It exists
 * because the other shape cannot carry them honestly: text encoded back into
 * bytes under the name `menu.pdf` is not a PDF, and the reader, which decides
 * what a file is from its name, sent exactly that to the platform's document
 * converter — which has no converter for plain text and answered with an
 * error. So the owner's price list was read perfectly on arrival and then
 * refused on filing, every time, with a message about a conversion that should
 * never have been attempted.
 */
export interface IngestText extends IngestCommon {
  readonly text: string;
}

export type IngestInput = IngestFile | IngestText;

/** Whether an input still has to be read, or is already words. */
export function isAlreadyRead(input: IngestInput): input is IngestText {
  return "text" in input;
}

export interface IngestResult {
  readonly documentId: string;
  readonly chunkCount: number;
  /**
   * Whether the assistant can already find this document.
   *
   * The index accepts a write and makes it searchable a little later, so for
   * the first half minute a document is stored and unfindable at the same
   * time. That gap lands exactly where an operator tests: they upload a price
   * list, ask the bot about it straight away, and are told nobody knows. The
   * upload is fine and the answer is honest, but together they look like a
   * broken product, so the console has to say which of the two it is.
   */
  readonly searchable: boolean;
}

/**
 * How long ingestion waits for the index to catch up before giving up.
 *
 * Measured against a live index, a newly written vector became queryable after
 * about twenty seconds. Waiting the whole time would spend the budget the
 * runtime allows for work after a response, so this waits a little and reports
 * honestly when the index is still behind.
 */
const INDEX_VISIBLE_TIMEOUT_MS = 8_000;
const INDEX_POLL_MS = 1_500;

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

function isPdf(input: { filename: string; contentType: string }): boolean {
  return input.contentType.toLowerCase().includes("pdf") || extensionOf(input.filename) === "pdf";
}

/** Formats one parsed JSON record as readable lines. */
function renderRecord(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(renderRecord).join("\n");
  }
  return Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => `${key}: ${typeof item === "object" ? JSON.stringify(item) : String(item)}`)
    .join("\n");
}

/**
 * Turns JSON or JSONL into prose.
 *
 * Indexing raw JSON works poorly: braces and quotes dominate the text and a
 * search for a product name has to compete with punctuation. Rendering each
 * record as labelled lines retrieves far better.
 */
function renderJson(text: string, lineDelimited: boolean): string {
  if (lineDelimited) {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        try {
          return renderRecord(JSON.parse(line));
        } catch {
          // A malformed line is still worth indexing as written.
          return line;
        }
      })
      .join("\n\n");
  }
  try {
    return renderRecord(JSON.parse(text));
  } catch {
    return text;
  }
}

/**
 * Unwraps a markdown conversion response.
 *
 * The platform returns either a single result or an array, and either shape may
 * carry an error variant in place of the converted text.
 */
function unwrapConversion(
  response: ConversionResponse | ConversionResponse[],
  filename: string,
): string {
  const first = Array.isArray(response) ? response[0] : response;
  if (first === undefined) {
    throw new MuxelError("upstream_failure", "conversion returned no result", { filename });
  }
  if (first.format === "error") {
    throw new MuxelError("upstream_failure", "conversion failed", {
      filename,
      detail: first.error,
    });
  }
  return first.data;
}

/**
 * Removes the heading and metadata block the converter prepends.
 *
 * Conversion output starts with the file name as a heading and a `## Metadata`
 * list of properties like the PDF version and the author. None of that is
 * business content. Indexing it is worse than useless: it occupies a chunk, it
 * can match a customer question, and its presence makes an unreadable file look
 * like a successful upload.
 *
 * Only a metadata section made entirely of `- key=value` lines is dropped, so a
 * document that genuinely has a section by that name keeps it.
 */
export function stripConversionPreamble(markdown: string): string {
  const lines = markdown.split("\n");
  let index = 0;

  const skipBlank = (): void => {
    while (index < lines.length && (lines[index] as string).trim().length === 0) {
      index += 1;
    }
  };

  skipBlank();
  if (index < lines.length && /^#\s+\S/.test(lines[index] as string)) {
    index += 1;
  }

  skipBlank();
  if (index < lines.length && /^##\s+Metadata\s*$/i.test(lines[index] as string)) {
    const afterHeading = index + 1;
    let cursor = afterHeading;
    while (cursor < lines.length) {
      const line = (lines[cursor] as string).trim();
      if (line.length === 0 || /^-\s*[^=]+=/.test(line)) {
        cursor += 1;
        continue;
      }
      break;
    }
    if (cursor > afterHeading) {
      index = cursor;
    }
  }

  return lines
    .slice(index)
    .join("\n")
    .replace(/^#+\s*Contents\s*$/gim, "")
    .replace(/^#+\s*Page \d+\s*$/gim, "")
    .trim();
}

/** Produces the text of an upload, whatever format it arrived in. */
export async function readUpload(env: Env, input: IngestFile): Promise<string> {
  const extension = extensionOf(input.filename);

  // Already text. Decoding is exact and costs nothing.
  if (["txt", "md", "markdown", "log", "text"].includes(extension)) {
    return new TextDecoder().decode(input.body).trim();
  }
  if (extension === "jsonl" || extension === "ndjson") {
    return renderJson(new TextDecoder().decode(input.body), true);
  }
  if (extension === "json") {
    return renderJson(new TextDecoder().decode(input.body), false);
  }

  const converted = await env.AI.toMarkdown({
    name: input.filename,
    blob: new Blob([input.body], { type: input.contentType }),
  });
  let text = stripConversionPreamble(unwrapConversion(converted, input.filename));

  // The platform converter returns metadata and an empty body for some PDFs
  // that do contain text, including anything exported from Excel. Since a price
  // list is usually exactly that, an empty result is retried against the text
  // layer directly rather than accepted.
  if (text.length < MIN_CONTENT_CHARS && isPdf(input)) {
    const recovered = await extractPdfText(new Uint8Array(input.body));
    if (recovered.length > text.length) {
      console.warn("markdown conversion was empty, used the pdf text layer", {
        filename: input.filename,
        converted: text.length,
        recovered: recovered.length,
      });
      text = recovered;
    }
  }

  return text;
}

/**
 * Splits text, embeds it and records it as a document.
 *
 * Shared by uploads and by the generated product catalogue, so both are
 * retrieved identically.
 */
/**
 * Waits for a just written vector to become findable.
 *
 * Asked with the vector's own embedding, which is the only query guaranteed to
 * match it, and looks for its id rather than a score. A false here is not a
 * failure: the write succeeded and the index will catch up on its own. It only
 * decides which of two true things the console tells the operator.
 */
export async function waitUntilSearchable(
  env: Env,
  namespace: string,
  probe: { id: string; values: number[] },
  timeoutMs: number = INDEX_VISIBLE_TIMEOUT_MS,
  pollMs: number = INDEX_POLL_MS,
  onTick?: (elapsedMs: number, timeoutMs: number) => Promise<void> | void,
): Promise<boolean> {
  const started = Date.now();
  const deadline = started + timeoutMs;
  for (;;) {
    try {
      const found = await env.KNOWLEDGE.query(probe.values, { topK: 5, namespace });
      if (found.matches.some((match) => match.id === probe.id)) {
        return true;
      }
    } catch {
      // An index that cannot be queried yet is the case being waited on.
    }
    if (Date.now() + pollMs >= deadline) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    try {
      await onTick?.(Date.now() - started, timeoutMs);
    } catch {
      // Reporting the wait must never fail the upload.
    }
  }
}

async function indexText(
  env: Env,
  input: {
    businessId: string;
    filename: string;
    contentType: string;
    byteSize: number;
    text: string;
    onProgress?: (progress: IngestProgress) => Promise<void> | void;
    settleTimeoutMs?: number;
  },
): Promise<IngestResult> {
  /** Reporting progress must never be able to fail an upload that worked. */
  const report = async (progress: IngestProgress): Promise<void> => {
    try {
      await input.onProgress?.(progress);
    } catch {
      // Ignored deliberately.
    }
  };
  const document = await createDocument(env, {
    businessId: input.businessId,
    filename: input.filename,
    contentType: input.contentType,
    byteSize: input.byteSize,
  });

  try {
    await setDocumentStatus(env, { documentId: document.id, status: "processing" });

    const pieces = chunkText(input.text);
    if (pieces.length === 0) {
      throw new MuxelError("invalid_input", "no text could be extracted", {
        filename: input.filename,
      });
    }

    const records = pieces.map((text, ordinal) => ({ id: generateId(), ordinal, text }));
    let probe: { id: string; values: number[] } | null = null;

    // Chunk rows are written first so that a vector can never point at a row
    // that does not exist.
    await insertChunks(env, input.businessId, document.id, records);

    for (let offset = 0; offset < records.length; offset += EMBED_BATCH) {
      const slice = records.slice(offset, offset + EMBED_BATCH);
      const vectors = await embedBatch(
        env,
        slice.map((record) => record.text),
      );
      const payload = slice.map((record, index) => ({
        id: record.id,
        values: vectors[index] as number[],
        namespace: input.businessId,
      }));
      const first = payload[0];
      if (probe === null && first !== undefined) {
        probe = { id: first.id, values: first.values };
      }
      for (let start = 0; start < payload.length; start += UPSERT_BATCH) {
        await env.KNOWLEDGE.upsert(payload.slice(start, start + UPSERT_BATCH));
      }
      await report({
        phase: "embedding",
        done: Math.min(offset + EMBED_BATCH, records.length),
        total: records.length,
      });
    }

    const searchable =
      probe === null
        ? false
        : await waitUntilSearchable(
            env,
            input.businessId,
            probe,
            input.settleTimeoutMs ?? INDEX_VISIBLE_TIMEOUT_MS,
            INDEX_POLL_MS,
            (elapsedMs, timeoutMs) => report({ phase: "settling", elapsedMs, timeoutMs }),
          );

    await setDocumentStatus(env, {
      documentId: document.id,
      status: "ready",
      chunkCount: records.length,
    });

    return { documentId: document.id, chunkCount: records.length, searchable };
  } catch (error) {
    await setDocumentStatus(env, {
      documentId: document.id,
      status: "failed",
      error: error instanceof Error ? error.message.slice(0, 300) : "ingestion failed",
    });
    throw error;
  }
}

/** Refuses text too short to have been read from anything. */
function requireReadable(text: string, filename: string): void {
  if (text.length < MIN_CONTENT_CHARS) {
    throw new MuxelError(
      "invalid_input",
      "no readable text found in this file. A scanned page or a photograph has no text to read: send the content as a message, or upload the spreadsheet or document it came from",
      { filename, extracted: text.length },
    );
  }
}

export async function ingestDocument(env: Env, input: IngestInput): Promise<IngestResult> {
  if (isAlreadyRead(input)) {
    // Already words, so there is nothing to convert and nothing to archive:
    // the original bytes were never handed on, and a copy of the text under
    // the file's name would be an archive of something that is not the file.
    const text = input.text.trim();
    const byteSize = new TextEncoder().encode(text).byteLength;
    if (byteSize > MAX_DOCUMENT_BYTES) {
      throw new MuxelError("invalid_input", "document exceeds the size limit", {
        bytes: byteSize,
        limit: MAX_DOCUMENT_BYTES,
      });
    }
    requireReadable(text, input.filename);
    return indexText(env, {
      businessId: input.businessId,
      filename: input.filename,
      contentType: "text/plain",
      byteSize,
      text,
      ...(input.onProgress === undefined ? {} : { onProgress: input.onProgress }),
      ...(input.settleTimeoutMs === undefined ? {} : { settleTimeoutMs: input.settleTimeoutMs }),
    });
  }

  if (input.body.byteLength === 0) {
    throw new MuxelError("invalid_input", "document is empty", { filename: input.filename });
  }
  if (input.body.byteLength > MAX_DOCUMENT_BYTES) {
    throw new MuxelError("invalid_input", "document exceeds the size limit", {
      bytes: input.body.byteLength,
      limit: MAX_DOCUMENT_BYTES,
    });
  }

  // The original is not kept. It was, once, so that a document could be read
  // as structured data rather than as the prose it was flattened into — and
  // when that capability was removed the archive had no reader left. An
  // archive nothing reads is a copy of every customer's documents held for no
  // stated purpose, so it goes with the thing that needed it.

  const text = await readUpload(env, input);
  requireReadable(text, input.filename);

  return indexText(env, {
    businessId: input.businessId,
    filename: input.filename,
    contentType: input.contentType,
    byteSize: input.body.byteLength,
    text,
    ...(input.onProgress === undefined ? {} : { onProgress: input.onProgress }),
    ...(input.settleTimeoutMs === undefined ? {} : { settleTimeoutMs: input.settleTimeoutMs }),
  });
}

/** Deletes a document and the vectors it owned. */
export async function removeDocument(
  env: Env,
  businessId: string,
  documentId: string,
): Promise<void> {
  const ids = await deleteDocument(env, businessId, documentId);
  if (ids.length > 0) {
    await env.KNOWLEDGE.deleteByIds(ids);
  }
}

/**
 * Takes a file the owner gave, in one act.
 *
 * Reading it into the index and reading the price list out of it are two steps
 * that always happen together, and they were written out at one call site and
 * forgotten at the other: a price list uploaded from the web console was
 * searchable straight away and produced no price list items until a scheduled
 * run came round, which could be an hour.
 *
 * Extraction failing is not the upload failing. The document is in and
 * findable; the items are a second reading of it, and the scheduled run picks
 * up anything this could not finish.
 */
export async function addDocument(env: Env, input: IngestInput): Promise<IngestResult> {
  const result = await ingestDocument(env, input);

  // A generated document is this deployment's own rendering of rows it already
  // has. Reading a price list back out of one would be extracting from itself.
  if ((GENERATED_DOCUMENTS as readonly string[]).includes(input.filename)) {
    return result;
  }

  // Written here rather than at the three doors that upload a file, so a
  // fourth cannot arrive without it.
  await recordEvent(env, {
    businessId: input.businessId,
    kind: "document_added",
    detail: `${input.filename} — ${result.chunkCount} pieces`,
  }).catch(() => undefined);

  await markExtractionPending(env, { businessId: input.businessId, documentId: result.documentId })
    .then(async () => {
      const business = await getBusiness(env, input.businessId);
      await runExtraction(env, {
        businessId: input.businessId,
        documentId: result.documentId,
        model: business.model,
      });
    })
    .catch((error: unknown) => {
      console.error("extraction after upload failed", {
        businessId: input.businessId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  return result;
}

/** The name the owner's typed notes are indexed under. */
export const NOTES_FILENAME = "Notes (console)";

/**
 * The generated documents, and what rebuilds each one.
 *
 * Two things reach the assistant as documents without ever having been a file:
 * the owner's price corrections and their typed notes. Each is stored as rows
 * so it can be edited a line at a time, and rendered wholesale into one
 * document because a shop has tens of these, not thousands, and tracking which
 * vector belongs to which row would buy nothing.
 *
 * Listed here rather than remembered, so that adding a third kind is one entry
 * and not a search for every place that rebuilds.
 */
export const GENERATED_DOCUMENTS = [OWNER_UPDATES_FILENAME, NOTES_FILENAME] as const;

/**
 * Replaces one generated document with the text it should now hold.
 *
 * Removed first, which also removes its vectors, so a fact the owner deleted
 * stops being retrievable in the same call rather than at the next scheduled
 * anything. Empty text leaves nothing behind: a source with nothing in it is a
 * source the assistant should not find.
 */
async function replaceGenerated(
  env: Env,
  businessId: string,
  filename: string,
  text: string,
): Promise<void> {
  const existing = await findDocumentByName(env, businessId, filename);
  if (existing !== null) {
    await removeDocument(env, businessId, existing);
  }
  if (text.length === 0) {
    return;
  }
  await indexText(env, {
    businessId,
    filename,
    contentType: "text/plain",
    byteSize: text.length,
    text,
  });
}

/** Rebuilds the document carrying the owner's typed notes. */
export async function syncNotes(env: Env, businessId: string): Promise<void> {
  await replaceGenerated(env, businessId, NOTES_FILENAME, renderNotes(await listNotes(env, businessId)));
}

/**
 * Renders the notes into the document the assistant reads.
 *
 * A title is a heading and the body follows it, so retrieval can match either
 * the subject or the wording. A note with no body is skipped: a heading alone
 * is an invitation to answer from nothing.
 */
export function renderNotes(notes: readonly { title: string; body: string }[]): string {
  const usable = notes.filter((note) => note.body.trim().length > 0);
  if (usable.length === 0) {
    return "";
  }
  return [
    "Notes from the shop owner.",
    "",
    ...usable.flatMap((note) =>
      note.title.trim().length > 0
        ? [`## ${note.title.trim()}`, note.body.trim(), ""]
        : [note.body.trim(), ""],
    ),
  ].join("\n");
}

/**
 * Rebuilds everything the assistant reads that is not a file it was given.
 *
 * One door, so a new write path cannot arrive knowing about one generated
 * document and not the other.
 */
export async function syncKnowledge(env: Env, businessId: string): Promise<void> {
  await syncOwnerUpdates(env, businessId);
  await syncNotes(env, businessId);
}

/**
 * Rebuilds the document that carries the owner's corrections into RAG.
 *
 * Corrections are stored structurally so the products view can apply them, but
 * the assistant only reads documents, so they are rendered into one and
 * ingested through the same door as everything else. Regenerated wholesale on
 * every change: a shop has tens of corrections, not thousands, and tracking
 * which vector belongs to which row would buy nothing.
 */
export async function syncOwnerUpdates(env: Env, businessId: string): Promise<void> {
  await replaceGenerated(
    env,
    businessId,
    OWNER_UPDATES_FILENAME,
    renderOwnerUpdates(await listCorrections(env, businessId)),
  );
}
