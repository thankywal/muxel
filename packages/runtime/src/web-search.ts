/**
 * Live web data, through SerpApi, on the owner's own key.
 *
 * Everything else this deployment answers from is material the owner gave it: a
 * price list, a document, a rule they wrote. That is the right default for a
 * customer's question, and it stays the default — this is not on the path that
 * answers customers. It is on the owner's own path, where the question is
 * usually about the world rather than about their shelf: what do others charge
 * for this, is my listing right, what is on that page.
 *
 * Three of SerpApi's engines rather than one, because those are three different
 * questions and a general search answers none of them well:
 *
 *   web       what a page says
 *   shopping  what a thing sells for, with the seller named
 *   local     who else is nearby, from the map
 *
 * The key is the owner's. It is sealed in their own KV alongside the Cloudflare
 * and GitHub tokens, the call leaves from their Worker, and nothing about the
 * query reaches the project that published this code. Without a key there is no
 * search: the tool says so, in words that name the setting to open, rather than
 * returning an empty list that reads like "nothing found".
 *
 * What comes back always carries where it came from. A price with no seller and
 * no link is a number the owner cannot check, and a number they cannot check is
 * one they should not put on their own price list.
 */

import type { Env } from "./env.js";
import { getSecret } from "./web/secrets-vault.js";

const ENDPOINT = "https://serpapi.com/search.json";
const TIMEOUT_MS = 12_000;

/** Enough to decide something; short enough to leave room in the transcript. */
const MAX_RESULTS = 8;

/** The three questions, and the SerpApi engine that answers each. */
export const SEARCH_KINDS = {
  web: "google",
  shopping: "google_shopping",
  local: "google_maps",
} as const;

export type SearchKind = keyof typeof SEARCH_KINDS;

export function isSearchKind(value: string): value is SearchKind {
  return Object.hasOwn(SEARCH_KINDS, value);
}

export interface SearchResult {
  readonly title: string;
  /** Where this came from, so the owner can go and look at it. */
  readonly link: string;
  /** One line of what it says, when the engine gives one. */
  readonly snippet: string;
  /** As written by the seller, currency and all. Empty unless shopping. */
  readonly price: string;
  /** Who is selling or who is listed. Empty when the engine gives no name. */
  readonly source: string;
}

export interface SearchAnswer {
  readonly kind: SearchKind;
  readonly query: string;
  readonly results: readonly SearchResult[];
  /**
   * The engine's own direct answer, when it had one.
   *
   * Kept separate from the results rather than folded in as a first row: it is
   * a claim by the search engine, not a page, and the model should be able to
   * tell the owner which of the two it is repeating.
   */
  readonly directAnswer: string;
}

/** Thrown so the caller can tell "no key" from "the search failed". */
export class SearchUnavailable extends Error {}

/**
 * Whether this deployment can search at all.
 *
 * One reader, because three things ask: the tool, the system prompt that must
 * not promise a capability that is switched off, and the settings page. Each
 * working it out for itself is how the prompt ends up offering something the
 * tool then refuses.
 */
export async function webSearchConfigured(env: Env): Promise<boolean> {
  return (await getSecret(env, "serpapi_key")) !== null;
}

export async function webSearch(
  env: Env,
  input: { query: string; kind: SearchKind; location?: string },
): Promise<SearchAnswer> {
  const query = input.query.trim();
  if (query.length === 0) throw new SearchUnavailable("Give me something to search for.");

  const key = await getSecret(env, "serpapi_key");
  if (key === null) {
    throw new SearchUnavailable(
      "This deployment has no SerpApi key, so it cannot search the web. "
      + "The owner adds one under Settings, in Web search.",
    );
  }

  const url = new URL(ENDPOINT);
  url.searchParams.set("engine", SEARCH_KINDS[input.kind]);
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(MAX_RESULTS));
  url.searchParams.set("api_key", key);
  // The maps engine answers about a place, so it needs one. Where the owner has
  // not said, SerpApi's own default applies rather than a guess of ours.
  const location = input.location?.trim() ?? "";
  if (location.length > 0) url.searchParams.set("location", location);

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    // The cause, not just "failed". A timeout and a refused connection are two
    // different things for whoever has to fix it.
    throw new Error(`SerpApi could not be reached: ${error instanceof Error ? error.message : String(error)}`);
  }

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    // SerpApi puts the reason in the body. Passing it through means an expired
    // key says so instead of arriving as a bare 401.
    const said = typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
    throw new Error(`SerpApi refused the search: ${said}`);
  }
  if (typeof body.error === "string") throw new Error(`SerpApi refused the search: ${body.error}`);

  return {
    kind: input.kind,
    query,
    results: rowsOf(body, input.kind),
    directAnswer: directAnswerOf(body),
  };
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function rowsOf(body: Record<string, unknown>, kind: SearchKind): SearchResult[] {
  const list = (name: string): Record<string, unknown>[] => {
    const raw = body[name];
    return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  };

  if (kind === "shopping") {
    return list("shopping_results").slice(0, MAX_RESULTS).map((row) => ({
      title: text(row.title),
      link: text(row.product_link) || text(row.link),
      snippet: text(row.snippet) || text(row.delivery),
      price: text(row.price),
      source: text(row.source) || text(row.store),
    }));
  }

  if (kind === "local") {
    return list("local_results").slice(0, MAX_RESULTS).map((row) => ({
      title: text(row.title),
      link: text(row.website) || text(row.link),
      // Address and rating are what distinguishes one café from the next; a
      // snippet field that held neither would make the whole row useless.
      snippet: [text(row.address), text(row.type), ratingOf(row)].filter((part) => part.length > 0).join(" · "),
      price: text(row.price),
      source: text(row.phone),
    }));
  }

  return list("organic_results").slice(0, MAX_RESULTS).map((row) => ({
    title: text(row.title),
    link: text(row.link),
    snippet: text(row.snippet),
    price: "",
    source: text(row.displayed_link) || text(row.source),
  }));
}

function ratingOf(row: Record<string, unknown>): string {
  const rating = typeof row.rating === "number" ? row.rating : null;
  if (rating === null) return "";
  const reviews = typeof row.reviews === "number" ? row.reviews : null;
  return reviews === null ? `${rating}★` : `${rating}★ (${reviews})`;
}

/**
 * The engine's own answer, when it gave one.
 *
 * Read from whichever box holds it rather than from one field, because Google
 * returns the same kind of answer under three different names depending on the
 * question, and reading only one of them means a direct answer sometimes
 * silently becomes no answer at all.
 */
function directAnswerOf(body: Record<string, unknown>): string {
  const box = (name: string): Record<string, unknown> => {
    const raw = body[name];
    return typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  };
  const answer = box("answer_box");
  const graph = box("knowledge_graph");
  return (
    text(answer.answer)
    || text(answer.result)
    || text(answer.snippet)
    || text(graph.description)
  ).slice(0, 600);
}
