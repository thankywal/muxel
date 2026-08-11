/**
 * Products as a view over the documents.
 *
 * The operator uploads whatever they have, a price list, an inventory sheet, a
 * policy page, and the console's products screen shows what is actually in it.
 * Nothing here is a second source of truth: the assistant answers from the
 * documents, and these rows exist so a person can see at a glance what the
 * assistant can see, and point at the file a wrong price came from.
 *
 * Extraction runs once per document, on upload when time allows and from the
 * scheduled run otherwise. It costs one inference call per document, roughly
 * what a single customer reply costs.
 */

import { generateId, MuxelError } from "@muxel/core";

import { generate } from "../ai/gateway.js";
import type { Env } from "../env.js";

/** The document that carries the operator's console corrections into RAG. */
export const OWNER_UPDATES_FILENAME = "Owner updates (console)";

/** More rows than any shop has products; fewer than a runaway model invents. */
const MAX_PRODUCTS_PER_DOCUMENT = 200;

/** Longest document slice sent for extraction. Covers hundreds of items. */
const MAX_EXTRACTION_CHARS = 24_000;

export interface ExtractedItem {
  readonly name: string;
  readonly price: string;
  readonly description: string;
}

const EXTRACTION_PROMPT = [
  "Read the document between the markers and list the products or services it offers.",
  "Reply with a JSON array only, no prose: [{\"name\":\"...\",\"price\":\"...\",\"description\":\"...\"}]",
  "Copy names and prices verbatim from the document, including currency symbols and units. Never invent or estimate a value; use an empty string for anything the document does not state.",
  "description is optional detail such as unit, brand or variant, at most a few words.",
  "The text may arrive as loose fragments on separate lines; that is normal, piece the items together.",
  "If the document offers no products or services, reply with [].",
].join(" ");

/**
 * Pulls the first complete JSON array out of a completion.
 *
 * Models wrap JSON in prose and code fences despite instructions, so the array
 * is located by bracket balance rather than by trusting the reply to be clean.
 * Returns null when there is nothing parseable, which the caller records as a
 * failed extraction rather than an empty catalogue.
 */
export function parseExtraction(reply: string): ExtractedItem[] | null {
  const start = reply.indexOf("[");
  if (start === -1) {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < reply.length; index += 1) {
    const character = reply[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = inString;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (character === "[") {
      depth += 1;
    } else if (character === "]") {
      depth -= 1;
      if (depth === 0) {
        return decodeItems(reply.slice(start, index + 1));
      }
    }
  }
  return null;
}

function decodeItems(json: string): ExtractedItem[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(raw)) {
    return null;
  }
  const items: ExtractedItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const name = String((entry as { name?: unknown }).name ?? "").trim();
    if (name.length === 0 || name.length > 120) {
      continue;
    }
    items.push({
      name,
      price: String((entry as { price?: unknown }).price ?? "").trim().slice(0, 60),
      description: String((entry as { description?: unknown }).description ?? "")
        .trim()
        .slice(0, 200),
    });
    if (items.length >= MAX_PRODUCTS_PER_DOCUMENT) {
      break;
    }
  }
  return items;
}

/** Joins a document's chunks back into readable text, in order. */
async function documentText(env: Env, businessId: string, documentId: string): Promise<string> {
  const rows = await env.DB.prepare(
    "SELECT text FROM chunk WHERE business_id = ? AND document_id = ? ORDER BY ordinal",
  )
    .bind(businessId, documentId)
    .all<{ text: string }>();
  return rows.results.map((row) => row.text).join("\n\n");
}

function now(): string {
  return new Date().toISOString();
}

export async function markExtractionPending(
  env: Env,
  input: { businessId: string; documentId: string },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO extraction_state (document_id, business_id, state, detail, updated_at)
     VALUES (?, ?, 'pending', '', ?)
     ON CONFLICT (document_id) DO UPDATE SET state = 'pending', detail = '', updated_at = excluded.updated_at`,
  )
    .bind(input.documentId, input.businessId, now())
    .run();
}

/** Documents still owed an extraction, oldest first. */
export async function pendingExtractions(
  env: Env,
  limit = 1,
): Promise<{ businessId: string; documentId: string }[]> {
  const rows = await env.DB.prepare(
    "SELECT document_id, business_id FROM extraction_state WHERE state = 'pending' ORDER BY updated_at LIMIT ?",
  )
    .bind(limit)
    .all<{ document_id: string; business_id: string }>();
  return rows.results.map((row) => ({ businessId: row.business_id, documentId: row.document_id }));
}

/** Whether any of a business's documents are still being read. */
export async function hasPendingExtraction(env: Env, businessId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT 1 AS one FROM extraction_state WHERE business_id = ? AND state = 'pending' LIMIT 1",
  )
    .bind(businessId)
    .first<{ one: number }>();
  return row !== null;
}

/**
 * Extracts the products of one document and replaces its rows.
 *
 * Failure leaves the state marked failed with the reason, and the scheduled
 * run does not retry it: a document that cannot be extracted twice in a row
 * would retry forever, and the operator's refresh button re-arms it on demand.
 */
export async function runExtraction(
  env: Env,
  input: { businessId: string; documentId: string; model: string },
): Promise<number> {
  try {
    const text = (await documentText(env, input.businessId, input.documentId)).slice(
      0,
      MAX_EXTRACTION_CHARS,
    );
    if (text.trim().length === 0) {
      throw new MuxelError("invalid_input", "document has no text to extract from");
    }

    const result = await generate(env, {
      model: input.model,
      system: EXTRACTION_PROMPT,
      history: [],
      userMessage: `<<<DOCUMENT\n${text}\nDOCUMENT>>>`,
      businessId: input.businessId,
    });

    const items = parseExtraction(result.text);
    if (items === null) {
      throw new MuxelError("upstream_failure", "extraction did not return a JSON list");
    }

    const stamp = now();
    const statements = [
      env.DB.prepare("DELETE FROM extracted_product WHERE document_id = ?").bind(input.documentId),
      ...items.map((item) =>
        env.DB.prepare(
          "INSERT INTO extracted_product (id, business_id, document_id, name, price, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).bind(
          generateId(),
          input.businessId,
          input.documentId,
          item.name,
          item.price,
          item.description,
          stamp,
        ),
      ),
      env.DB.prepare(
        "UPDATE extraction_state SET state = 'done', detail = ?, updated_at = ? WHERE document_id = ?",
      ).bind(`${items.length} items`, stamp, input.documentId),
    ];
    await env.DB.batch(statements);
    return items.length;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await env.DB.prepare(
      "UPDATE extraction_state SET state = 'failed', detail = ?, updated_at = ? WHERE document_id = ?",
    )
      .bind(detail.slice(0, 200), now(), input.documentId)
      .run();
    throw error;
  }
}
