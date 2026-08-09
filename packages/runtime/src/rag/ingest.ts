/**
 * Document ingestion.
 *
 * The original file is kept in R2 so that a change to the chunking strategy can
 * be replayed without asking the operator to upload anything again. Extraction
 * uses the platform markdown conversion, which understands PDF, DOCX, XLSX,
 * HTML and CSV, rather than bundling a parser into the Worker.
 */

import { generateId, MuxelError } from "@muxel/core";

import { embedBatch } from "../ai/gateway.js";
import { createDocument, insertChunks, setDocumentStatus } from "../db/queries.js";
import type { Env } from "../env.js";
import { chunkText } from "./chunk.js";

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
  return first.data;
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

  const objectKey = `${input.businessId}/${generateId()}/${input.filename}`;
  await env.DOCUMENTS.put(objectKey, input.body, {
    httpMetadata: { contentType: input.contentType },
  });

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
