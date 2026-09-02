/**
 * Reading a document as data, through Nutrient DWS, on the owner's own key.
 *
 * The extraction this deployment already does asks a language model to read the
 * prose a file was flattened into and reply with a JSON list. It works, and it
 * has the failure a language model always has: it is equally fluent when it is
 * right and when it is wrong. Nothing in its answer says which rows it was sure
 * of, so nothing downstream can treat those two cases differently, and a price
 * list with one hallucinated row looks exactly like one with none.
 *
 * Nutrient DWS reads the original file rather than the flattening of it, and
 * returns a confidence with each field. That is the part that matters here: a
 * number that says "check this one" turns a wall of extracted rows into a small
 * pile that needs a person and a large pile that does not.
 *
 * So the confidence is not decoration. It decides. Rows DWS is sure of are
 * proposed as they are; rows it is not are marked, and the model is told to say
 * so. Either way the owner taps Yes on each — the approval card this deployment
 * already has is the human in the loop, and every tap is a row in
 * operator_approval with who, what and when, which is the audit trail.
 *
 * The key is the owner's, sealed in their own KV. It is worth being exact about
 * what that costs: with a key set, a document the owner asks to be read this way
 * is sent to Nutrient. That is a service outside their Cloudflare account, and
 * it is their choice, made with their credentials, on the file they name. It is
 * off until they set the key, and the console says plainly what leaves.
 */

import { MuxelError } from "@muxel/core";

import type { Env } from "../env.js";
import { getSecret } from "../web/secrets-vault.js";

const ENDPOINT = "https://api.nutrient.io/extraction/extract";
const TIMEOUT_MS = 55_000;

/** More rows than any price list has; fewer than a runaway extraction invents. */
const MAX_ITEMS = 200;

/**
 * Below this a row is shown to the owner as one to look at.
 *
 * Not a threshold that decides anything on its own — every row is approved by a
 * person either way — but the line between "here is what it found" and "it was
 * not sure about this one", which is the only thing that makes a long list
 * reviewable at all.
 */
export const UNSURE_BELOW = 0.75;

export interface ReadItem {
  readonly name: string;
  readonly price: string;
  readonly description: string;
  /** 0 to 1, or null when DWS returned none for this row. */
  readonly confidence: number | null;
}

export interface ReadDocument {
  readonly items: readonly ReadItem[];
  /** How many of them fell below UNSURE_BELOW, counted once so every reader agrees. */
  readonly unsure: number;
}

/** Thrown when the capability is switched off, as distinct from having failed. */
export class ExtractionUnavailable extends Error {}

/**
 * Whether this deployment can read a document as data.
 *
 * One reader, for the same reason web search has one: the tool, the prompt and
 * the settings page all ask, and three answers that can disagree is how a
 * prompt ends up offering what a tool then refuses.
 */
export async function documentDataConfigured(env: Env): Promise<boolean> {
  return (await getSecret(env, "nutrient_key")) !== null;
}

/**
 * What DWS is asked to find.
 *
 * A JSON Schema, because the extract endpoint maps a document onto one and
 * answers with those fields — which is the whole reason to use it over asking
 * a model to read prose. Named fields also mean the confidences come back
 * named: output.metadata mirrors output.data, so the confidence for
 * data.items[3].price is at metadata.items[3].price.
 */
const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      description: "Every product or service the document offers, in the order it lists them.",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "The item's name, copied from the document." },
          price: { type: "string", description: "Its price as written, currency and units included." },
          description: { type: "string", description: "Unit, brand or variant, at most a few words." },
        },
        required: ["name"],
      },
    },
  },
  required: ["items"],
} as const;

export async function readDocumentData(
  env: Env,
  input: { bytes: ArrayBuffer; filename: string; contentType: string },
): Promise<ReadDocument> {
  const key = await getSecret(env, "nutrient_key");
  if (key === null) {
    throw new ExtractionUnavailable(
      "This deployment has no Nutrient DWS key, so it cannot read a document as data. "
      + "The owner adds one under Settings, in Document data.",
    );
  }

  const form = new FormData();
  form.append("file", new Blob([input.bytes], { type: input.contentType }), input.filename);
  // One outer "instructions" field holding the schema, as the API requires.
  // Sending schema as its own form field is the documented way to get a 400.
  form.append(
    "instructions",
    JSON.stringify({
      schema: SCHEMA,
      // "understand" reads the document rather than only its text layer, which
      // is what a price list exported from a spreadsheet needs.
      parseConfig: { mode: "understand" },
      options: { includeCitations: true },
      instructions:
        "This is a price list. Each item is one product or service with the price as written, "
        + "including its currency and unit. Copy names and prices verbatim. Never invent a value.",
    }),
  );

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new MuxelError(
      "upstream_failure",
      `Nutrient DWS could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const raw = await response.text();
  if (!response.ok) {
    // DWS puts the reason in the body. Passing it through means an exhausted
    // credit balance says so, rather than arriving as a bare 402.
    throw new MuxelError("upstream_failure", `Nutrient DWS refused the file: ${reasonOf(raw, response.status)}`);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new MuxelError("upstream_failure", "Nutrient DWS returned something that was not JSON");
  }

  const items = itemsOf(body);
  return { items, unsure: items.filter((item) => item.confidence !== null && item.confidence < UNSURE_BELOW).length };
}

function reasonOf(raw: string, status: number): string {
  try {
    const body = JSON.parse(raw) as { error?: unknown; message?: unknown; detail?: unknown };
    for (const value of [body.error, body.message, body.detail]) {
      if (typeof value === "string" && value.length > 0) return value.slice(0, 200);
    }
  } catch {
    // Not JSON. The status is still the fact we have.
  }
  return `HTTP ${status}`;
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/**
 * Pulls the rows out of whichever shape DWS answered in.
 *
 * The confidences arrive beside the data rather than inside it, and the payload
 * has been seen wrapped one level deep. Reading both shapes here means a
 * response that is merely arranged differently is not reported as an empty
 * document — which is the failure that looks exactly like a document with
 * nothing in it.
 */
function itemsOf(body: unknown): ReadItem[] {
  const output = ((body ?? {}) as Record<string, unknown>).output;
  const held = (output ?? body ?? {}) as Record<string, unknown>;
  const data = (held.data ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(data.items) ? data.items : [];
  // metadata mirrors data exactly, so the citation for data.items[i] is at
  // metadata.items[i]. Reading it positionally is not a guess about the shape;
  // it is the shape the API documents.
  const meta = (held.metadata ?? {}) as Record<string, unknown>;
  const citations = Array.isArray(meta.items) ? meta.items : [];

  const items: ReadItem[] = [];
  for (const [index, entry] of rows.entries()) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const name = text(row.name).slice(0, 120);
    if (name.length === 0) continue;
    items.push({
      name,
      price: text(row.price).slice(0, 60),
      description: text(row.description).slice(0, 200),
      confidence: scoreAt(citations[index]),
    });
    if (items.length >= MAX_ITEMS) break;
  }
  return items;
}

/**
 * @returns The confidence for one row, or null when DWS gave none.
 *
 * Null rather than a default, because the API's own wording is that confidence
 * is present "when available". A row whose confidence is unknown and a row DWS
 * was certain about are not the same thing, and defaulting to 1 would quietly
 * turn the first into the second — on exactly the row that needed a person.
 */
function scoreAt(citation: unknown): number | null {
  if (typeof citation !== "object" || citation === null) return null;
  const fields = citation as Record<string, unknown>;

  // Per field, so the row is only as good as its weakest part: a name read
  // perfectly beside a price that was a guess is not a confident row, and the
  // price is the half that goes on the price list.
  const each = ["name", "price", "description"]
    .map((field) => confidenceOf(fields[field]))
    .filter((value): value is number => value !== null);
  if (each.length > 0) return Math.min(...each);

  // A scalar row rather than an object of fields.
  return confidenceOf(citation);
}

/** Reads the composite confidence off one citation object. */
function confidenceOf(value: unknown): number | null {
  if (typeof value === "number") return numberOf(value);
  if (typeof value !== "object" || value === null) return null;
  const citation = value as Record<string, unknown>;
  const composite = numberOf(citation.confidence);
  if (composite !== null) return composite;
  // Falls back to the OCR score only when there is no composite one. It is a
  // narrower signal — how well the characters were read, not how sure the API
  // is that this is the right field — so it is never preferred over the other.
  return numberOf(citation.recognitionScore);
}

function numberOf(value: unknown): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  // DWS reports 0-1; a percentage is normalised so a threshold means one thing.
  const scaled = value > 1 ? value / 100 : value;
  return scaled < 0 ? 0 : scaled > 1 ? 1 : scaled;
}
