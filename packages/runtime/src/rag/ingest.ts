/**
 * Document ingestion.
 *
 * The original file is kept in R2 so that a change to the chunking strategy can
 * be replayed without asking the operator to upload anything again. Extraction
 * uses the platform markdown conversion, which understands PDF, DOCX, XLSX,
 * HTML and CSV, rather than bundling a parser into the Worker.
 */

import { chunkText, generateId, MuxelError } from "@muxel/core";

import { embedBatch } from "../ai/gateway.js";
import { createDocument, insertChunks, setDocumentStatus } from "../db/queries.js";
import type { Env } from "../env.js";

/** Largest upload accepted. Telegram itself caps bot downloads at 20 MB. */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

/** Vectorize accepts a bounded number of vectors per upsert call. */
const UPSERT_BATCH = 100;

/** Embedding calls are batched to stay inside the per request subrequest budget. */
const EMBED_BATCH = 25;

export interface IngestInput {
  readonly businessId: string;
  readonly filename: string;
  readonly contentType: string;
  readonly body: ArrayBuffer;
}

export interface IngestResult {
  readonly documentId: string;
  readonly chunkCount: number;
}

/**
 * Shortest body accepted after the preamble is removed.
 *
 * A file that yields less than this has no usable content, whatever the
 * converter reported.
 */
const MIN_CONTENT_CHARS = 80;

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
    // Only treat it as a preamble if it actually held property lines.
    if (cursor > afterHeading) {
      index = cursor;
    }
  }

  return lines.slice(index).join("\n").trim();
}

/**
 * Unwraps a markdown conversion response.
 *
 * The platform returns either a single result or an array, and either shape may
 * carry an error variant in place of the converted text. Both are normalised
 * here so the caller sees a string or a typed failure.
 */
function extractMarkdown(
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

  const body = stripConversionPreamble(first.data);
  if (body.length < MIN_CONTENT_CHARS) {
    // Scans and form templates convert to nothing but properties. Saying so is
    // far more useful than storing the properties and reporting success.
    throw new MuxelError(
      "invalid_input",
      "no readable text found in this file. If it is a scan or a form template, export it as text or send the content as a message instead",
      { filename, extracted: body.length },
    );
  }
  return body;
}

export async function ingestDocument(env: Env, input: IngestInput): Promise<IngestResult> {
  if (input.body.byteLength === 0) {
    throw new MuxelError("invalid_input", "document is empty", { filename: input.filename });
  }
  if (input.body.byteLength > MAX_DOCUMENT_BYTES) {
    throw new MuxelError("invalid_input", "document exceeds the size limit", {
      bytes: input.body.byteLength,
      limit: MAX_DOCUMENT_BYTES,
    });
  }

  // Archiving the original is optional. Nothing reads it back, and requiring
  // it would put an R2 billing prompt in front of someone setting up their
  // first shop for a convenience they may never use.
  let objectKey = "";
  if (env.DOCUMENTS !== undefined) {
    objectKey = `${input.businessId}/${generateId()}/${input.filename}`;
    await env.DOCUMENTS.put(objectKey, input.body, {
      httpMetadata: { contentType: input.contentType },
    });
  }

  const document = await createDocument(env, {
    businessId: input.businessId,
    filename: input.filename,
    contentType: input.contentType,
    byteSize: input.body.byteLength,
    objectKey,
  });

  try {
    await setDocumentStatus(env, { documentId: document.id, status: "processing" });

    const converted = await env.AI.toMarkdown({
      name: input.filename,
      blob: new Blob([input.body], { type: input.contentType }),
    });
    const pieces = chunkText(extractMarkdown(converted, input.filename));
    if (pieces.length === 0) {
      throw new MuxelError("invalid_input", "no text could be extracted", {
        filename: input.filename,
      });
    }

    const records = pieces.map((text, ordinal) => ({ id: generateId(), ordinal, text }));

    // Embed in batches, then index. Chunk rows are written first so that a
    // vector can never point at a row that does not exist.
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
      for (let start = 0; start < payload.length; start += UPSERT_BATCH) {
        await env.KNOWLEDGE.upsert(payload.slice(start, start + UPSERT_BATCH));
      }
    }

    await setDocumentStatus(env, {
      documentId: document.id,
      status: "ready",
      chunkCount: records.length,
    });

    return { documentId: document.id, chunkCount: records.length };
  } catch (error) {
    await setDocumentStatus(env, {
      documentId: document.id,
      status: "failed",
      error: error instanceof Error ? error.message.slice(0, 300) : "ingestion failed",
    });
    throw error;
  }
}
