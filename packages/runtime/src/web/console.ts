/**
 * The web console's door into this deployment.
 *
 * Telegram authenticates an operator for free: an update arrives with a user id
 * the platform has already vouched for. HTTP does not, so this pairs the two.
 * The owner asks the console bot for a code, types it into the web console
 * once, and gets back a token this deployment recognises afterwards.
 *
 * The pairing goes through the bot on purpose. It is the channel the owner is
 * already trusted on, so no password is invented, no email is sent, and nothing
 * about the owner is stored anywhere outside their own deployment.
 */

import { localeFor, screenFor } from "../telegram/admin.js";
import { sha256Hex } from "../crypto.js";
import { findOperator } from "../db/queries.js";
import type { Env } from "../env.js";

/** Codes are short because they are typed by hand, and brief because of it. */
const CODE_TTL_SECONDS = 600;
/** A session lasts long enough that a shop is not asked again every morning. */
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

const codeKey = (code: string): string => `console:pair:${code}`;
const sessionKey = (hash: string): string => `console:session:${hash}`;

/** Unambiguous on a phone: no O/0, no I/1. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/**
 * Issues a pairing code for an owner. Called from the console bot, which is
 * the only place that already knows who is asking.
 */
export async function issuePairingCode(env: Env, userId: number): Promise<string> {
  const code = newCode();
  await env.STATE.put(codeKey(code), String(userId), { expirationTtl: CODE_TTL_SECONDS });
  return code;
}

/** Trades a code for a token. The code is spent whether or not it was valid. */
async function pair(env: Env, code: string): Promise<Response> {
  const key = codeKey(code.trim().toUpperCase());
  const owner = await env.STATE.get(key);
  await env.STATE.delete(key);
  if (owner === null) {
    return json({ error: "bad_code", message: "That code is not valid any more." }, 401);
  }
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  // Only the hash is kept, so a copy of this deployment's KV is not a set of
  // working tokens.
  await env.STATE.put(sessionKey(await sha256Hex(token)), owner, {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return json({ ok: true, token });
}

/** Resolves a bearer token back to the operator it was issued for. */
async function operatorFor(env: Env, request: Request): Promise<number | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token.length < 32) return null;
  const owner = await env.STATE.get(sessionKey(await sha256Hex(token)));
  return owner === null ? null : Number(owner);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      // The console is served from a different origin by design: it is a client
      // of this deployment, not a part of it.
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, authorization",
      "access-control-allow-methods": "POST, OPTIONS",
      "cache-control": "no-store",
    },
  });
}

/**
 * Routes every /admin request. Returns null when the path is not ours, so the
 * caller can carry on to its other routes.
 */
export async function handleConsoleRequest(
  env: Env,
  request: Request,
  path: string,
): Promise<Response | null> {
  if (request.method === "OPTIONS") return json({}, 204);
  if (request.method !== "POST") return null;

  if (path === "/pair") {
    const body = (await request.json().catch(() => ({}))) as { code?: string };
    return pair(env, String(body.code ?? ""));
  }

  if (path === "/screen") {
    const userId = await operatorFor(env, request);
    if (userId === null) {
      return json({ error: "unauthorised", message: "Pair this console first." }, 401);
    }
    // An operator can be removed after a token was issued, so access is checked
    // on every call rather than only at pairing.
    if ((await findOperator(env, userId)) === null) {
      return json({ error: "no_access", message: "This console is private." }, 403);
    }
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      args?: string[];
    };
    const locale = await localeFor(env, userId);
    const screen = await screenFor(
      env,
      locale,
      userId,
      String(body.action ?? "home"),
      Array.isArray(body.args) ? body.args.map(String) : [],
    );
    return json({ text: screen.text, rows: screen.rows });
  }

  return null;
}
