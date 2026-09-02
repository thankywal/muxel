/**
 * The products view and the operator's corrections.
 *
 * What a business sells lives in its documents. The console needs to answer
 * two things about that without creating a second store: what did the
 * documents say, and what has the owner overridden since.
 *
 * Extracted rows answer the first. Corrections answer the second, and they are
 * deliberately not edits of the extraction: an extraction is regenerated
 * whenever a document changes, and an edit written into it would be lost on
 * the next pass. A correction survives because it is keyed by the item's name
 * and applied on top, whichever document the item next arrives from.
 *
 * The assistant never reads these tables. Corrections reach it as a rendered
 * document through the same ingestion as everything else, so the reference
 * material remains the assistant's single world.
 */

import { generateId } from "@muxel/core";
import { syncOwnerUpdates } from "./rag/ingest.js";

import type { Env } from "./env.js";

/**
 * Collapses a name to the identity corrections are keyed by.
 *
 * Extraction may render the same item as "Whole Milk " one pass and
 * "whole milk" the next, and a correction must follow it across passes.
 */
export function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface ProductEntry {
  /** The correction key, which is also how a button refers to the item. */
  readonly key: string;
  readonly name: string;
  readonly price: string;
  readonly description: string;
  /** Filename the item was extracted from; empty for one the owner typed. */
  readonly source: string;
  /** True when a correction changed or created this entry. */
  readonly edited: boolean;
}

export interface Correction {
  readonly nameKey: string;
  readonly name: string;
  readonly price: string;
  readonly description: string;
  readonly removed: boolean;
}

export async function upsertCorrection(
  env: Env,
  input: {
    businessId: string;
    name: string;
    price: string;
    description: string;
    removed: boolean;
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO product_correction (id, business_id, name_key, name, price, description, removed, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (business_id, name_key) DO UPDATE SET
       name = excluded.name,
       price = excluded.price,
       description = excluded.description,
       removed = excluded.removed,
       updated_at = excluded.updated_at`,
  )
    .bind(
      generateId(),
      input.businessId,
      nameKey(input.name),
      input.name.trim().slice(0, 120),
      input.price.trim().slice(0, 60),
      input.description.trim().slice(0, 200),
      input.removed ? 1 : 0,
      new Date().toISOString(),
    )
    .run();
}

export async function listCorrections(env: Env, businessId: string): Promise<Correction[]> {
  const rows = await env.DB.prepare(
    "SELECT name_key, name, price, description, removed FROM product_correction WHERE business_id = ? ORDER BY name",
  )
    .bind(businessId)
    .all<{ name_key: string; name: string; price: string; description: string; removed: number }>();
  return rows.results.map((row) => ({
    nameKey: row.name_key,
    name: row.name,
    price: row.price,
    description: row.description,
    removed: row.removed === 1,
  }));
}

/**
 * The list the products screen shows: extraction with corrections on top.
 *
 * When two documents mention the same item, the newer extraction wins, which
 * is what an operator uploading a corrected price list expects to happen.
 */
export async function productsView(env: Env, businessId: string): Promise<ProductEntry[]> {
  const rows = await env.DB.prepare(
    `SELECT p.name, p.price, p.description, p.created_at, COALESCE(d.filename, '') AS source
       FROM extracted_product p
       LEFT JOIN document d ON d.id = p.document_id
      WHERE p.business_id = ?
      ORDER BY p.created_at`,
  )
    .bind(businessId)
    .all<{ name: string; price: string; description: string; created_at: string; source: string }>();

  const merged = new Map<string, ProductEntry>();
  for (const row of rows.results) {
    // Later rows overwrite earlier ones, and the query is ordered oldest
    // first, so the newest extraction of a name is the one that stays.
    merged.set(nameKey(row.name), {
      key: nameKey(row.name),
      name: row.name,
      price: row.price,
      description: row.description,
      source: row.source,
      edited: false,
    });
  }

  for (const correction of await listCorrections(env, businessId)) {
    if (correction.removed) {
      merged.delete(correction.nameKey);
      continue;
    }
    const existing = merged.get(correction.nameKey);
    merged.set(correction.nameKey, {
      key: correction.nameKey,
      name: correction.name,
      price: correction.price.length > 0 ? correction.price : (existing?.price ?? ""),
      description:
        correction.description.length > 0 ? correction.description : (existing?.description ?? ""),
      source: existing?.source ?? "",
      edited: true,
    });
  }

  return [...merged.values()].sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Records an owner's price list change and makes the assistant able to read it.
 *
 * These are two writes and one act. The correction lands in the database, and
 * then the owner-updates document is rewritten and re-indexed, because that
 * document is the only way a correction reaches the assistant. A caller that
 * does the first and forgets the second stores the new price and leaves the
 * assistant quoting the old one, which looks exactly like the change not having
 * been made, except that the console shows it.
 *
 * It was written out longhand at three call sites before this, which is three
 * chances to forget and one that already had been: the web console wrote to a
 * table nothing reads.
 */
export async function saveProductEntry(
  env: Env,
  input: {
    businessId: string;
    name: string;
    price: string;
    description: string;
    removed: boolean;
  },
  after?: After,
): Promise<void> {
  await upsertCorrection(env, input);
  await follow(after, syncOwnerUpdates(env, input.businessId), "the price list's index");
}

/**
 * Something to run once the answer has gone out. On a Worker that is
 * ctx.waitUntil; a caller with no such thing leaves it undefined and waits.
 */
export type After = (work: Promise<unknown>) => void;

/**
 * The index is a view of the record, and a view can catch up.
 *
 * Every yes on a price re-rendered the owner-updates document, deleted its
 * vectors, embedded it again and wrote it back, inside the request, before the
 * tap was answered. On this account that is several seconds to the better part
 * of twenty, during which the card did not move. Owners took it for a button
 * that did nothing and reloaded, sometimes in the middle of a run.
 *
 * The correction row is what the console, the assistant and the Price list
 * read, and it is written before this. What follows is the copy the customer's
 * agent retrieves from, and it can be a few seconds behind the tap the way it
 * always was behind the tap in practice. So it is handed to the caller's after
 * hook when there is one, and awaited when there is not, because a caller with
 * no way to run work after the response has to finish it before.
 *
 * A failure after the answer is logged, not lost silently: the record is right
 * and the index is stale until the next sync of the same document, which every
 * later change to the same business performs.
 */
export function follow(after: After | undefined, work: Promise<unknown>, what: string): Promise<void> {
  if (after === undefined) return work.then(() => undefined);
  after(work.catch((error: unknown) => {
    console.error(`${what} did not update after the answer:`, error instanceof Error ? error.message : error);
  }));
  return Promise.resolve();
}

/** Just the names, for the reply path's empty-retrieval fallback. */
export async function productNames(env: Env, businessId: string, cap = 60): Promise<string[]> {
  const view = await productsView(env, businessId);
  return view.slice(0, cap).map((entry) =>
    entry.price.length > 0 ? `${entry.name} (${entry.price})` : entry.name,
  );
}

/**
 * Renders the corrections into the document the assistant reads.
 *
 * The supersede line matters: the original document still says the old price,
 * and retrieval may surface both. The assistant is told plainly which voice
 * wins, in the material itself, where the instruction survives any prompt
 * change.
 */
export function renderOwnerUpdates(corrections: readonly Correction[]): string {
  if (corrections.length === 0) {
    return "";
  }
  const lines = [
    "Updates from the shop owner.",
    "These supersede anything older elsewhere in the reference material.",
    "",
  ];
  for (const correction of corrections) {
    if (correction.removed) {
      lines.push(`${correction.name}: no longer available.`);
    } else {
      lines.push(
        [correction.name, correction.price, correction.description]
          .filter((part) => part.length > 0)
          .join(" - "),
      );
    }
  }
  return lines.join("\n");
}
