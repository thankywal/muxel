/**
 * The reads a dashboard makes, and nothing else.
 *
 * These are aggregates over the same tables the rest of the product writes.
 * Nothing here is a second source of truth: every number is counted at the
 * moment it is asked for, so a panel cannot drift from the record behind it.
 *
 * Every function takes the businesses the operator may actually see. An owner
 * sees all of them and an admin sees the ones they were added to, and that list
 * is resolved once by the caller rather than re-derived here, so a new panel
 * cannot forget to scope itself.
 */

import type { Env } from "../env.js";

/** SQL fragment plus bindings for `business_id IN (…)`. Empty is handled. */
function scope(ids: readonly string[]): { sql: string; values: string[] } {
  if (ids.length === 0) return { sql: "NULL", values: [] };
  return { sql: ids.map(() => "?").join(", "), values: [...ids] };
}

/** The last `days` calendar days in UTC, oldest first, including today. */
export function recentDays(days: number, from = new Date()): string[] {
  const out: string[] = [];
  for (let back = days - 1; back >= 0; back -= 1) {
    const day = new Date(from.getTime() - back * 86400000);
    out.push(day.toISOString().slice(0, 10));
  }
  return out;
}

export interface DayPoint {
  day: string;
  messages: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Usage per day, with the quiet days present rather than missing.
 *
 * `usage_daily` only has a row on a day something happened. A chart drawn
 * straight from those rows joins Monday to Thursday with a straight line and
 * hides the two silent days, which is the opposite of what a volume chart is
 * for. The zeroes are filled in here, once.
 */
export async function usageSeries(
  env: Env,
  ids: readonly string[],
  days: number,
): Promise<DayPoint[]> {
  const wanted = recentDays(days);
  const empty = wanted.map((day) => ({ day, messages: 0, inputTokens: 0, outputTokens: 0 }));
  if (ids.length === 0) return empty;

  const where = scope(ids);
  const result = await env.DB.prepare(
    `SELECT day,
            SUM(messages)      AS messages,
            SUM(input_tokens)  AS input_tokens,
            SUM(output_tokens) AS output_tokens
       FROM usage_daily
      WHERE business_id IN (${where.sql}) AND day >= ?
      GROUP BY day`,
  )
    .bind(...where.values, wanted[0])
    .all<{ day: string; messages: number; input_tokens: number; output_tokens: number }>();

  const byDay = new Map(result.results.map((row) => [row.day, row]));
  return empty.map((point) => {
    const row = byDay.get(point.day);
    return row === undefined
      ? point
      : {
          day: point.day,
          messages: row.messages ?? 0,
          inputTokens: row.input_tokens ?? 0,
          outputTokens: row.output_tokens ?? 0,
        };
  });
}

export interface ConversationSummary {
  conversationId: string;
  customerId: string | null;
  customerName: string;
  businessId: string;
  businessName: string;
  channel: "telegram" | "web";
  lastMessage: string;
  lastRole: "user" | "assistant";
  updatedAt: string;
  /** waiting for a person, a person is in it, or neither. */
  state: "waiting" | "human" | "settled";
}

/**
 * The most recent conversations across every business the operator can see.
 *
 * The channel is read from whether the conversation's bot is the hidden one a
 * web channel creates, which is the same test the reply path uses. Nothing
 * infers it from the shape of a chat id.
 */
export async function recentConversations(
  env: Env,
  ids: readonly string[],
  limit = 8,
): Promise<ConversationSummary[]> {
  if (ids.length === 0) return [];
  const where = scope(ids);
  const result = await env.DB.prepare(
    `SELECT c.id, c.business_id, c.updated_at, c.bot_id,
            b.name AS business_name,
            cu.id  AS customer_id,
            COALESCE(NULLIF(cu.display_name, ''), NULLIF(cu.username, ''), '') AS customer_name,
            h.state AS handover_state,
            w.id AS web_channel_id,
            (SELECT m.content FROM message m WHERE m.conversation_id = c.id
              ORDER BY m.created_at DESC LIMIT 1) AS last_message,
            (SELECT m.role FROM message m WHERE m.conversation_id = c.id
              ORDER BY m.created_at DESC LIMIT 1) AS last_role
       FROM conversation c
       JOIN business b ON b.id = c.business_id
       LEFT JOIN customer cu ON cu.business_id = c.business_id AND cu.chat_id = c.chat_id
       LEFT JOIN handover h ON h.conversation_id = c.id
       LEFT JOIN web_channel w ON w.bot_id = c.bot_id
      WHERE c.business_id IN (${where.sql})
      ORDER BY c.updated_at DESC
      LIMIT ?`,
  )
    .bind(...where.values, limit)
    .all<{
      id: string;
      business_id: string;
      updated_at: string;
      business_name: string;
      customer_id: string | null;
      customer_name: string;
      handover_state: string | null;
      web_channel_id: string | null;
      last_message: string | null;
      last_role: string | null;
    }>();

  return result.results.map((row) => ({
    conversationId: row.id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    businessId: row.business_id,
    businessName: row.business_name,
    channel: row.web_channel_id === null ? "telegram" : "web",
    lastMessage: row.last_message ?? "",
    lastRole: row.last_role === "user" ? "user" : "assistant",
    updatedAt: row.updated_at,
    state:
      row.handover_state === "human"
        ? "human"
        : row.handover_state === "waiting"
          ? "waiting"
          : "settled",
  }));
}

/**
 * How much of the work each business handled without a person.
 *
 * This is the honest version of a "resolution rate": the share of that
 * business's conversations that never had to be handed to someone. It is
 * counted from the handover table, so a conversation a person is in right now
 * lowers it, and stops lowering it when they hand it back.
 */
export async function unaidedShare(
  env: Env,
  ids: readonly string[],
): Promise<Map<string, { conversations: number; handed: number }>> {
  const out = new Map<string, { conversations: number; handed: number }>();
  if (ids.length === 0) return out;
  const where = scope(ids);
  const result = await env.DB.prepare(
    `SELECT c.business_id,
            COUNT(*) AS conversations,
            SUM(CASE WHEN h.conversation_id IS NULL THEN 0 ELSE 1 END) AS handed
       FROM conversation c
       LEFT JOIN handover h ON h.conversation_id = c.id
      WHERE c.business_id IN (${where.sql})
      GROUP BY c.business_id`,
  )
    .bind(...where.values)
    .all<{ business_id: string; conversations: number; handed: number }>();
  for (const row of result.results) {
    out.set(row.business_id, { conversations: row.conversations, handed: row.handed ?? 0 });
  }
  return out;
}

/**
 * Messages per channel.
 *
 * Muxel answers on Telegram and on a website, and that is the whole list. A
 * chart with six slices would be a nicer picture and a false one.
 */
export async function channelSplit(
  env: Env,
  ids: readonly string[],
): Promise<{ telegram: number; web: number }> {
  if (ids.length === 0) return { telegram: 0, web: 0 };
  const where = scope(ids);
  const result = await env.DB.prepare(
    `SELECT CASE WHEN w.id IS NULL THEN 'telegram' ELSE 'web' END AS channel,
            COUNT(*) AS total
       FROM message m
       JOIN conversation c ON c.id = m.conversation_id
       LEFT JOIN web_channel w ON w.bot_id = c.bot_id
      WHERE m.business_id IN (${where.sql})
      GROUP BY channel`,
  )
    .bind(...where.values)
    .all<{ channel: string; total: number }>();
  const out = { telegram: 0, web: 0 };
  for (const row of result.results) {
    if (row.channel === "web") out.web = row.total;
    else out.telegram = row.total;
  }
  return out;
}

export interface CustomerRowView {
  id: string;
  name: string;
  username: string;
  businessId: string;
  businessName: string;
  channel: "telegram" | "web";
  messageCount: number;
  conversations: number;
  lastSeen: string;
}

/** Every customer the operator can see, a page at a time. */
export async function customersPage(
  env: Env,
  ids: readonly string[],
  limit: number,
  offset: number,
): Promise<{ customers: CustomerRowView[]; total: number }> {
  if (ids.length === 0) return { customers: [], total: 0 };
  const where = scope(ids);
  const [rows, count] = await Promise.all([
    env.DB.prepare(
      `SELECT cu.id, cu.business_id, cu.display_name, cu.username, cu.message_count, cu.last_seen,
              b.name AS business_name,
              (SELECT COUNT(*) FROM conversation c
                WHERE c.business_id = cu.business_id AND c.chat_id = cu.chat_id) AS conversations,
              (SELECT w.id FROM conversation c
                 LEFT JOIN web_channel w ON w.bot_id = c.bot_id
                WHERE c.business_id = cu.business_id AND c.chat_id = cu.chat_id LIMIT 1) AS web_channel_id
         FROM customer cu
         JOIN business b ON b.id = cu.business_id
        WHERE cu.business_id IN (${where.sql})
        ORDER BY cu.last_seen DESC
        LIMIT ? OFFSET ?`,
    )
      .bind(...where.values, limit, offset)
      .all<{
        id: string;
        business_id: string;
        display_name: string;
        username: string;
        message_count: number;
        last_seen: string;
        business_name: string;
        conversations: number;
        web_channel_id: string | null;
      }>(),
    env.DB.prepare(`SELECT COUNT(*) AS total FROM customer WHERE business_id IN (${where.sql})`)
      .bind(...where.values)
      .first<{ total: number }>(),
  ]);

  return {
    total: count?.total ?? 0,
    customers: rows.results.map((row) => ({
      id: row.id,
      name: row.display_name || (row.username ? `@${row.username}` : ""),
      username: row.username,
      businessId: row.business_id,
      businessName: row.business_name,
      channel: row.web_channel_id === null ? "telegram" : "web",
      messageCount: row.message_count,
      conversations: row.conversations,
      lastSeen: row.last_seen,
    })),
  };
}

/**
 * Whatever the operator typed, matched against the things they can open.
 *
 * Deliberately three narrow queries rather than one clever one: a business, a
 * customer and a message are three different destinations, and a combined
 * relevance score across them would be a ranking nobody asked for.
 */
export async function search(
  env: Env,
  ids: readonly string[],
  term: string,
): Promise<{
  businesses: { id: string; name: string }[];
  customers: { id: string; name: string; businessName: string }[];
  messages: { customerId: string | null; content: string; businessName: string; createdAt: string }[];
}> {
  const empty = { businesses: [], customers: [], messages: [] };
  const needle = term.trim();
  if (ids.length === 0 || needle.length < 2) return empty;
  const like = `%${needle.replace(/[%_]/g, (c) => `\\${c}`)}%`;
  const where = scope(ids);

  const [businesses, customers, messages] = await Promise.all([
    env.DB.prepare(
      `SELECT id, name FROM business WHERE id IN (${where.sql}) AND name LIKE ? ESCAPE '\\' LIMIT 5`,
    )
      .bind(...where.values, like)
      .all<{ id: string; name: string }>(),
    env.DB.prepare(
      `SELECT cu.id, COALESCE(NULLIF(cu.display_name, ''), NULLIF(cu.username, ''), '') AS name,
              b.name AS business_name
         FROM customer cu JOIN business b ON b.id = cu.business_id
        WHERE cu.business_id IN (${where.sql})
          AND (cu.display_name LIKE ? ESCAPE '\\' OR cu.username LIKE ? ESCAPE '\\')
        LIMIT 5`,
    )
      .bind(...where.values, like, like)
      .all<{ id: string; name: string; business_name: string }>(),
    env.DB.prepare(
      `SELECT cu.id AS customer_id, m.content, m.created_at, b.name AS business_name
         FROM message m
         JOIN conversation c ON c.id = m.conversation_id
         JOIN business b ON b.id = m.business_id
         LEFT JOIN customer cu ON cu.business_id = c.business_id AND cu.chat_id = c.chat_id
        WHERE m.business_id IN (${where.sql}) AND m.content LIKE ? ESCAPE '\\'
        ORDER BY m.created_at DESC LIMIT 6`,
    )
      .bind(...where.values, like)
      .all<{ customer_id: string | null; content: string; created_at: string; business_name: string }>(),
  ]);

  return {
    businesses: businesses.results,
    customers: customers.results.map((row) => ({
      id: row.id,
      name: row.name,
      businessName: row.business_name,
    })),
    messages: messages.results.map((row) => ({
      customerId: row.customer_id,
      content: row.content,
      businessName: row.business_name,
      createdAt: row.created_at,
    })),
  };
}

/** When each business last had anything happen in it. */
export async function lastActivity(
  env: Env,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const where = scope(ids);
  const result = await env.DB.prepare(
    `SELECT business_id, MAX(updated_at) AS at FROM conversation
      WHERE business_id IN (${where.sql}) GROUP BY business_id`,
  )
    .bind(...where.values)
    .all<{ business_id: string; at: string }>();
  for (const row of result.results) out.set(row.business_id, row.at);
  return out;
}
