/**
 * The public surface a website talks to.
 *
 * Four paths under `/w/:key`. The key is public by design, so nothing here
 * trusts it for anything beyond naming a business, and every request is
 * checked against the channel's origin allowlist and daily allowance before it
 * can cost the operator anything.
 *
 * Unlike the Telegram path, a browser is holding the connection open, so the
 * answer is produced inside the request rather than after it.
 */

import { answerQuestion, MAX_INPUT_CHARS } from "../answer.js";
import {
  appendMessage,
  getBusiness,
  getHandover,
  openHandover,
  touchCustomer,
  upsertConversation,
} from "../db/queries.js";
import type { Env } from "../env.js";
import { alertOwner } from "../escalation.js";
import { remember, shouldExtract } from "../memory.js";
import {
  getChannelByKey,
  normaliseSession,
  originAllowed,
  touchSession,
  withinDailyLimit,
  type WebChannel,
} from "./channel.js";
import { previewPage, widgetScript } from "./widget.js";

/** How long a browser may wait for an answer before being told to retry. */
const ANSWER_DEADLINE_MS = 24_000;

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    // Echoed rather than starred because the widget may later need credentials,
    // and a starred origin cannot carry them. Requests are already filtered by
    // the channel's allowlist before reaching here.
    "access-control-allow-origin": origin ?? "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders(origin) },
  });
}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([work, expiry]).finally(() => clearTimeout(timer ?? null));
}

/**
 * Messages the browser has not seen, newest last.
 *
 * Ordered by rowid rather than by time, because a customer message and the
 * reply to it are written with the same timestamp and a browser polling on
 * time alone would show them in either order.
 */
async function messagesAfter(
  env: Env,
  conversationId: string,
  after: number,
): Promise<{ seq: number; role: string; text: string }[]> {
  const rows = await env.DB.prepare(
    `SELECT rowid AS seq, role, content FROM message
      WHERE conversation_id = ? AND rowid > ?
      ORDER BY rowid LIMIT 50`,
  )
    .bind(conversationId, after)
    .all<{ seq: number; role: string; content: string }>();
  return rows.results.map((row) => ({ seq: row.seq, role: row.role, text: row.content }));
}

/** Resolves the conversation and customer behind a browser session. */
async function sessionContext(
  env: Env,
  channel: WebChannel,
  sessionId: string,
): Promise<{ conversationId: string; customerId: string; pseudoId: number }> {
  const pseudoId = await touchSession(env, { channel, sessionId });
  const customer = await touchCustomer(env, {
    businessId: channel.businessId,
    telegramUserId: pseudoId,
    chatId: pseudoId,
    displayName: "Website visitor",
    username: "",
  });
  const conversationId = await upsertConversation(env, {
    businessId: channel.businessId,
    botId: channel.botId,
    chatId: pseudoId,
  });
  return { conversationId, customerId: customer.id, pseudoId };
}

export async function handleWebRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  path: string,
): Promise<Response> {
  const origin = request.headers.get("origin");
  const [key, action = ""] = path.split("/");

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (key === undefined || key.length === 0) {
    return new Response("not found", { status: 404 });
  }

  const channel = await getChannelByKey(env, key);
  if (channel === null || !channel.enabled) {
    // Same answer for a disabled channel as for one that never existed, so a
    // key cannot be probed for whether it once worked.
    return new Response("not found", { status: 404 });
  }
  if (!originAllowed(channel, origin)) {
    return json({ error: "This site is not allowed to use this assistant." }, 403, origin);
  }

  const url = new URL(request.url);

  if (action === "widget.js") {
    return new Response(widgetScript({ origin: url.origin, channel }), {
      headers: {
        "content-type": "text/javascript; charset=utf-8",
        // Short, so a colour change reaches visitors within the hour without
        // making every page load pay for the script again.
        "cache-control": "public, max-age=900",
        ...corsHeaders(origin),
      },
    });
  }

  if (action === "") {
    return new Response(previewPage({ origin: url.origin, channel }), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-robots-tag": "noindex",
      },
    });
  }

  if (action === "poll" && request.method === "GET") {
    const session = url.searchParams.get("session") ?? "";
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(session)) {
      return json({ messages: [] }, 200, origin);
    }
    const { conversationId } = await sessionContext(env, channel, session);
    const after = Number(url.searchParams.get("after") ?? "0");
    const messages = await messagesAfter(
      env,
      conversationId,
      Number.isSafeInteger(after) && after > 0 ? after : 0,
    );
    return json({ messages }, 200, origin);
  }

  if (action === "send" && request.method === "POST") {
    return handleSend(request, env, ctx, channel, origin);
  }

  return new Response("not found", { status: 404 });
}

async function handleSend(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  channel: WebChannel,
  origin: string | null,
): Promise<Response> {
  let body: { session?: string; text?: string };
  try {
    body = (await request.json()) as { session?: string; text?: string };
  } catch {
    return json({ error: "invalid request" }, 400, origin);
  }

  const question = (body.text ?? "").trim().slice(0, MAX_INPUT_CHARS);
  const session = normaliseSession(body.session);
  if (question.length === 0) {
    return json({ session, error: "empty message" }, 400, origin);
  }

  if (!(await withinDailyLimit(env, channel))) {
    return json(
      { session, error: "This assistant has reached today's limit. Please try again tomorrow." },
      429,
      origin,
    );
  }

  const business = await getBusiness(env, channel.businessId);
  const { conversationId, customerId } = await sessionContext(env, channel, session);

  await appendMessage(env, {
    conversationId,
    businessId: business.id,
    role: "user",
    content: question,
  });

  // A person is answering this chat. The visitor's message is already stored
  // and the operator is told; the widget will collect their reply by polling.
  const handover = await getHandover(env, conversationId);
  if (handover?.state === "human") {
    ctx.waitUntil(
      alertOwner(env, {
        businessName: business.name,
        customerName: "Website visitor",
        question,
        customerId,
        duringTakeover: true,
      }).catch(() => undefined),
    );
    const seq = await latestSeq(env, conversationId);
    return json({ session, seq, reply: "" }, 200, origin);
  }

  let answer;
  try {
    answer = await withDeadline(
      answerQuestion(env, { business, conversationId, customerId, question }),
      ANSWER_DEADLINE_MS,
    );
  } catch (error) {
    console.error("web reply failed", {
      businessId: business.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return json(
      { session, error: "Sorry, I could not answer that just now. Please try again." },
      502,
      origin,
    );
  }

  await appendMessage(env, {
    conversationId,
    businessId: business.id,
    role: "assistant",
    content: answer.text,
  });
  const seq = await latestSeq(env, conversationId);

  if (answer.escalated) {
    ctx.waitUntil(
      openHandover(env, {
        conversationId,
        businessId: business.id,
        customerId,
        reason: question,
      })
        .then(() =>
          alertOwner(env, {
            businessName: business.name,
            customerName: "Website visitor",
            question,
            customerId,
          }),
        )
        .catch(() => undefined),
    );
  }

  // Distillation after the answer is on its way, exactly as on Telegram.
  ctx.waitUntil(
    (async () => {
      const count = await countTurns(env, conversationId);
      if (!shouldExtract(count)) {
        return;
      }
      await remember(env, {
        businessId: business.id,
        customerId,
        model: business.model,
        turns: [
          ...answer.history,
          { role: "user", content: question },
          { role: "assistant", content: answer.text },
        ],
        existing: answer.facts,
      });
    })().catch(() => undefined),
  );

  return json({ session, seq, reply: answer.text }, 200, origin);
}

async function latestSeq(env: Env, conversationId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COALESCE(MAX(rowid), 0) AS seq FROM message WHERE conversation_id = ?",
  )
    .bind(conversationId)
    .first<{ seq: number }>();
  return row?.seq ?? 0;
}

async function countTurns(env: Env, conversationId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM message WHERE conversation_id = ? AND role = 'user'",
  )
    .bind(conversationId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
