/**
 * The website channel.
 *
 * A business can be reached from its own site as well as from Telegram, and
 * both go to the same assistant, the same documents and the same handover
 * queue. Everything downstream of a conversation is shared, so a web visitor
 * appears in the customer list, accumulates remembered facts, and can be taken
 * over by a person exactly like anyone who wrote from Telegram.
 *
 * That reuse is bought with one deliberate trick: a visitor is given a stable
 * negative identifier. Conversations and customers are keyed by a Telegram
 * account id, Telegram only ever issues positive ones, so the negative space
 * is free and cannot collide.
 */

import { generateId, generateShortId } from "@muxel/core";

import type { Env } from "../env.js";

export interface WebChannel {
  readonly id: string;
  readonly businessId: string;
  readonly key: string;
  readonly botId: string;
  readonly title: string;
  readonly greeting: string;
  readonly accent: string;
  readonly allowedOrigins: string;
  readonly dailyLimit: number;
  readonly enabled: boolean;
}

interface ChannelRow {
  id: string;
  business_id: string;
  key: string;
  bot_id: string;
  title: string;
  greeting: string;
  accent: string;
  allowed_origins: string;
  daily_limit: number;
  enabled: number;
}

function toChannel(row: ChannelRow): WebChannel {
  return {
    id: row.id,
    businessId: row.business_id,
    key: row.key,
    botId: row.bot_id,
    title: row.title,
    greeting: row.greeting,
    accent: row.accent,
    allowedOrigins: row.allowed_origins,
    dailyLimit: row.daily_limit,
    enabled: row.enabled === 1,
  };
}

export async function getChannelByKey(env: Env, key: string): Promise<WebChannel | null> {
  const row = await env.DB.prepare("SELECT * FROM web_channel WHERE key = ?")
    .bind(key)
    .first<ChannelRow>();
  return row === null ? null : toChannel(row);
}

export async function getChannelForBusiness(
  env: Env,
  businessId: string,
): Promise<WebChannel | null> {
  const row = await env.DB.prepare("SELECT * FROM web_channel WHERE business_id = ? LIMIT 1")
    .bind(businessId)
    .first<ChannelRow>();
  return row === null ? null : toChannel(row);
}

/**
 * Creates the channel and the hidden bot row a conversation has to point at.
 *
 * The bot is disabled and its webhook path is random, so it is unreachable
 * from Telegram twice over, and it is listed in `hidden_bot` so the console
 * never shows it among the bots a customer could write to.
 */
export async function createChannel(
  env: Env,
  input: { businessId: string; title: string },
): Promise<WebChannel> {
  const botId = generateId();
  const channelId = generateId();
  const key = `${generateShortId()}${generateShortId()}`;
  const stamp = new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO bot (id, business_id, role, username, webhook_path, token_ciphertext, webhook_secret_hash, enabled, created_at)
       VALUES (?, ?, 'reply', 'web', ?, '', '', 0, ?)`,
    ).bind(botId, input.businessId, `web-${generateId(24)}`, stamp),
    env.DB.prepare("INSERT INTO hidden_bot (bot_id, kind) VALUES (?, 'web')").bind(botId),
    env.DB.prepare(
      `INSERT INTO web_channel (id, business_id, key, bot_id, title, greeting, accent, allowed_origins, daily_limit, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, '', '#2563eb', '', 500, 1, ?)`,
    ).bind(channelId, input.businessId, key, botId, input.title.slice(0, 60), stamp),
  ]);

  const created = await getChannelByKey(env, key);
  if (created === null) {
    throw new Error("channel was not created");
  }
  return created;
}

export async function updateChannel(
  env: Env,
  channelId: string,
  patch: Partial<Pick<WebChannel, "title" | "greeting" | "accent" | "allowedOrigins" | "enabled">>,
): Promise<void> {
  const sets: string[] = [];
  const values: (string | number)[] = [];
  if (patch.title !== undefined) {
    sets.push("title = ?");
    values.push(patch.title.slice(0, 60));
  }
  if (patch.greeting !== undefined) {
    sets.push("greeting = ?");
    values.push(patch.greeting.slice(0, 300));
  }
  if (patch.accent !== undefined) {
    sets.push("accent = ?");
    values.push(patch.accent);
  }
  if (patch.allowedOrigins !== undefined) {
    sets.push("allowed_origins = ?");
    values.push(patch.allowedOrigins.slice(0, 500));
  }
  if (patch.enabled !== undefined) {
    sets.push("enabled = ?");
    values.push(patch.enabled ? 1 : 0);
  }
  if (sets.length === 0) {
    return;
  }
  values.push(channelId);
  await env.DB.prepare(`UPDATE web_channel SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function deleteChannel(env: Env, channel: WebChannel): Promise<void> {
  // The bot row goes too, which cascades the conversations and their
  // transcripts. Removing a widget from a site should not leave the console
  // showing chats nobody can reach any more.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM web_channel WHERE id = ?").bind(channel.id),
    env.DB.prepare("DELETE FROM hidden_bot WHERE bot_id = ?").bind(channel.botId),
    env.DB.prepare("DELETE FROM bot WHERE id = ?").bind(channel.botId),
  ]);
}

/**
 * Derives a stable negative identifier from a session id.
 *
 * FNV-1a over the session, folded into 45 bits so it stays well inside a safe
 * integer, then negated. Positive values belong to Telegram accounts; nothing
 * else has to change for a browser to have a customer record.
 */
export function pseudoIdFor(sessionId: string): number {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(sessionId)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return -Number(hash % 0x200000000000n) - 1;
}

/** Accepts a session id the browser generated, or mints one. */
export function normaliseSession(candidate: string | undefined): string {
  const trimmed = (candidate ?? "").trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(trimmed) ? trimmed : `${generateShortId()}${generateShortId()}`;
}

export async function touchSession(
  env: Env,
  input: { channel: WebChannel; sessionId: string },
): Promise<number> {
  const pseudoId = pseudoIdFor(input.sessionId);
  const stamp = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO web_session (id, channel_id, business_id, pseudo_id, created_at, last_seen)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET last_seen = excluded.last_seen`,
  )
    .bind(input.sessionId, input.channel.id, input.channel.businessId, pseudoId, stamp, stamp)
    .run();
  return pseudoId;
}

/**
 * Decides whether a page may talk to this channel.
 *
 * An empty allowlist accepts anyone, which is what a widget being tried out
 * needs, and the console says plainly that it is open. Once a domain is named,
 * only that domain and its subdomains are served, so a copied script tag on
 * someone else's site cannot spend this shop's allowance.
 */
export function originAllowed(channel: WebChannel, origin: string | null): boolean {
  const list = channel.allowedOrigins
    .split(/[\s,]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  if (list.length === 0) {
    return true;
  }
  if (origin === null) {
    // A same origin request, such as the preview page, sends no Origin header.
    return true;
  }
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  return list.some((entry) => {
    const bare = entry.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    return host === bare || host.endsWith(`.${bare}`);
  });
}

/**
 * Counts a message against the channel's daily allowance.
 *
 * The widget is open to the internet and inference is the one thing here that
 * costs money, so an unbounded channel is an unbounded bill on someone else's
 * account. Held in KV because it is a counter nobody needs to read afterwards.
 */
export async function withinDailyLimit(env: Env, channel: WebChannel): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const key = `web:count:${channel.id}:${day}`;
  const current = Number((await env.STATE.get(key)) ?? "0");
  if (current >= channel.dailyLimit) {
    return false;
  }
  await env.STATE.put(key, String(current + 1), { expirationTtl: 172_800 });
  return true;
}

/**
 * Reports whether a conversation belongs to the website rather than Telegram.
 *
 * An operator's reply is delivered differently for each, and the console has
 * only the conversation's bot id to go on.
 */
export async function isWebBot(env: Env, botId: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT 1 AS one FROM hidden_bot WHERE bot_id = ? AND kind = 'web'")
    .bind(botId)
    .first<{ one: number }>();
  return row !== null;
}
