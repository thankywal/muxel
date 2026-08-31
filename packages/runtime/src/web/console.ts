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

import { handleAdminUpdate, hasPending, localeFor, screenFor } from "../telegram/admin.js";
import { CapturingClient } from "./capture.js";
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
export async function operatorFor(env: Env, request: Request): Promise<number | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token.length < 32) return null;
  const owner = await env.STATE.get(sessionKey(await sha256Hex(token)));
  return owner === null ? null : Number(owner);
}

/** The headers every answer from this door carries. */
export const CORS = {
  // The console is a client of this deployment, not a part of it, so it is
  // served from somewhere else by design and calls in from the browser.
  //
  // Wide open on purpose: every one of these paths already refuses anyone
  // without this deployment's own bearer token, so an origin allowlist would
  // add a second lock to a door that is already locked, while breaking the one
  // property that matters here, which is that the page the owner opens talks
  // to their Worker with nothing in between.
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, authorization, x-filename, x-caption",
  "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
  "access-control-max-age": "86400",
} as const;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...CORS,
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
  // A preflight is answered with no body at all. Handing 204 a body is a
  // TypeError in Workers, which surfaced as a 500 on every OPTIONS.
  // A preflight is answered with no body at all. Handing 204 a body is a
  // TypeError in Workers, which surfaced as a 500 on every OPTIONS.
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
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
      answer?: string;
    };
    const locale = await localeFor(env, userId);
    const origin = new URL(request.url).origin;

    // A typed reply runs the same handler Telegram runs, with a client that
    // answers into memory. One code path, so the two consoles cannot drift.
    if (typeof body.answer === "string" && body.answer.length > 0) {
      const client = new CapturingClient();
      await handleAdminUpdate(
        env,
        client,
        {
          message: {
            message_id: 0,
            date: Math.floor(Date.now() / 1000),
            chat: { id: userId, type: "private" },
            from: { id: userId, is_bot: false, first_name: "web" },
            text: body.answer,
          },
        } as never,
        origin,
      );
      const captured = client.result();
      return json({ ...captured, pending: await hasPending(env, userId) });
    }

    const screen = await screenFor(
      env,
      locale,
      userId,
      String(body.action ?? "home"),
      Array.isArray(body.args) ? body.args.map(String) : [],
    );
    return json({ text: screen.text, rows: screen.rows, pending: await hasPending(env, userId) });
  }

  return null;
}
