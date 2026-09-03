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
 *
 * There is a second door for the owner who has no Telegram account, and it is
 * the one thing they hold that nobody else does: the key they set on their own
 * Worker. Presenting it is the same claim the bot makes on their behalf — I am
 * the person who deployed this — so it ends in the same session, minted by the
 * same code, and the two doors cannot drift apart.
 */

import { handleAdminUpdate, localeFor, pendingFor, screenFor } from "../telegram/admin.js";
import { CapturingClient } from "./capture.js";
import { sha256Hex } from "../crypto.js";
import { findOperator } from "../db/queries.js";
import { consoleKey, CONSOLE_KEY_MIN_LENGTH, WEB_OWNER_ID, type Env } from "../env.js";

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

/**
 * Compares two secrets without letting a near miss come back sooner.
 *
 * Written out here rather than imported so this door carries its own answer:
 * an early return on the first differing byte would let a caller recover the
 * key one character at a time from the timings alone.
 */
function sameSecret(presented: string, expected: string): boolean {
  const left = new TextEncoder().encode(presented);
  const right = new TextEncoder().encode(expected);
  // The length of a secret is not itself secret, so returning on it early is
  // safe, and it keeps the loop below constant with respect to content.
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= (left[i] as number) ^ (right[i] as number);
  }
  return diff === 0;
}

/**
 * Which console key a session was opened with, in sixteen characters.
 *
 * Not the key: a hash of it, so a copy of this deployment's KV still is not a
 * set of working secrets. It exists so that changing the key is a real remedy.
 * Without it, "change CONSOLE_KEY" only stops the next sign in — every browser
 * already carrying a thirty day token keeps working, which is exactly the case
 * you change a leaked key for.
 */
async function keyStamp(key: string): Promise<string> {
  return (await sha256Hex(key)).slice(0, 16);
}

/**
 * Mints the session both doors end in, for the operator that was recognised.
 *
 * A session opened with the console key remembers which key opened it. One
 * paired from Telegram does not, and is not affected by the key changing: it
 * was the console bot that vouched for that person, not a setting.
 */
async function issueSession(env: Env, userId: number, key?: string): Promise<Response> {
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  // Only the hash is kept, so a copy of this deployment's KV is not a set of
  // working tokens.
  const value = key === undefined ? String(userId) : `${userId}:${await keyStamp(key)}`;
  await env.STATE.put(sessionKey(await sha256Hex(token)), value, {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return json({ ok: true, token });
}

/** Trades a code for a token. The code is spent whether or not it was valid. */
async function pair(env: Env, code: string): Promise<Response> {
  const key = codeKey(code.trim().toUpperCase());
  const owner = await env.STATE.get(key);
  await env.STATE.delete(key);
  if (owner === null) {
    return json({ error: "bad_code", message: "That code is not valid any more." }, 401);
  }
  return issueSession(env, Number(owner));
}

/**
 * Trades this deployment's own console key for a token.
 *
 * Unlike a pairing code the key is not spent: it is a setting on the Worker,
 * it is how its owner gets in from every browser they own, and it stops working
 * the moment they change it.
 */
async function claim(env: Env, presented: string): Promise<Response> {
  const expected = consoleKey(env);
  if (expected === null) {
    return json(
      {
        error: "no_console_key",
        message:
          "This deployment has no console key. Add CONSOLE_KEY to the Worker's settings, at "
          + `least ${CONSOLE_KEY_MIN_LENGTH} characters, and open its address to finish setting up.`,
      },
      401,
    );
  }
  if (!sameSecret(presented.trim(), expected)) {
    return json({ error: "bad_key", message: "That is not this deployment's console key." }, 401);
  }
  return issueSession(env, WEB_OWNER_ID, expected);
}

/**
 * Resolves a bearer token back to the operator it was issued for.
 *
 * A session that names the key it was opened with is only good while that is
 * still the key. Changing CONSOLE_KEY is how an owner takes a leaked one back,
 * and it has to end the sessions it opened or it takes nothing back at all.
 * The row is deleted rather than left to expire, so the next call does not pay
 * for the same discovery again.
 */
export async function operatorFor(env: Env, request: Request): Promise<number | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token.length < 32) return null;
  const key = sessionKey(await sha256Hex(token));
  const held = await env.STATE.get(key);
  if (held === null) return null;
  const [owner, stamp] = held.split(":");
  if (stamp !== undefined) {
    const current = consoleKey(env);
    if (current === null || (await keyStamp(current)) !== stamp) {
      await env.STATE.delete(key);
      return null;
    }
  }
  return Number(owner);
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
  // Every header the console sends on an admin call has to be named here or
  // the browser's preflight refuses the request before the Worker sees it.
  // The failure is silent from the console's side, so a test walks the
  // console's own source against this line rather than trusting the list.
  "access-control-allow-headers":
    "content-type, authorization, accept, x-filename, x-caption, x-chat-id",
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

  if (path === "/claim") {
    const body = (await request.json().catch(() => ({}))) as { key?: string };
    return claim(env, String(body.key ?? ""));
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
      return json({ ...captured, pending: await pendingFor(env, userId) });
    }

    const screen = await screenFor(
      env,
      locale,
      userId,
      String(body.action ?? "home"),
      Array.isArray(body.args) ? body.args.map(String) : [],
    );
    return json({ text: screen.text, rows: screen.rows, pending: await pendingFor(env, userId) });
  }

  return null;
}
