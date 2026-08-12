/**
 * Data access layer.
 *
 * Every function that reads or writes business content takes a `businessId` and
 * includes it in the WHERE clause. Isolation is enforced here rather than at the
 * call sites so that a missed check in a handler cannot cross the boundary.
 */

import {
  assertValidId,
  generateId,
  notFound,
  type Bot,
  type BotRole,
  type Business,
  type BusinessDocument,
  type ChatTurn,
  type Customer,
  type CustomerFact,
  type CustomerStage,
  type DocumentStatus,
  type Product,
} from "@muxel/core";

import type { Env } from "../env.js";

function now(): string {
  return new Date().toISOString();
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

interface BusinessRow {
  id: string;
  name: string;
  locale: string;
  system_prompt: string;
  model: string;
  created_at: string;
  updated_at: string;
}

interface BotRow {
  id: string;
  business_id: string;
  role: string;
  username: string;
  webhook_path: string;
  token_ciphertext: string;
  webhook_secret_hash: string;
  enabled: number;
  created_at: string;
}

function toBusiness(row: BusinessRow): Business {
  return {
    id: row.id,
    name: row.name,
    locale: row.locale,
    systemPrompt: row.system_prompt,
    model: row.model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toBot(row: BotRow): Bot {
  return {
    id: row.id,
    businessId: row.business_id,
    role: row.role as BotRole,
    username: row.username,
    webhookPath: row.webhook_path,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
  };
}

// Operators ------------------------------------------------------------------

export async function countOperators(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM operator").first<{ n: number }>();
  return row?.n ?? 0;
}

export async function findOperator(
  env: Env,
  telegramUserId: number,
): Promise<{ telegramUserId: number; role: "owner" | "admin" } | null> {
  const row = await env.DB.prepare(
    "SELECT telegram_user_id, role FROM operator WHERE telegram_user_id = ?",
  )
    .bind(telegramUserId)
    .first<{ telegram_user_id: number; role: string }>();
  if (row === null) {
    return null;
  }
  return { telegramUserId: row.telegram_user_id, role: row.role as "owner" | "admin" };
}

/** Returns the Telegram account of the deployment owner, if one is installed. */
export async function findOwner(env: Env): Promise<number | null> {
  const row = await env.DB.prepare(
    "SELECT telegram_user_id FROM operator WHERE role = 'owner' ORDER BY created_at LIMIT 1",
  ).first<{ telegram_user_id: number }>();
  return row?.telegram_user_id ?? null;
}

export async function addOperator(
  env: Env,
  input: { telegramUserId: number; role: "owner" | "admin"; label?: string },
): Promise<void> {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO operator (telegram_user_id, label, role, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(input.telegramUserId, input.label ?? null, input.role, now())
    .run();
}

/** Reports whether an operator may act on a business. Owners reach everything. */
export async function canAccessBusiness(
  env: Env,
  telegramUserId: number,
  businessId: string,
): Promise<boolean> {
  const operator = await findOperator(env, telegramUserId);
  if (operator === null) {
    return false;
  }
  if (operator.role === "owner") {
    return true;
  }
  const row = await env.DB.prepare(
    "SELECT 1 AS ok FROM business_operator WHERE business_id = ? AND telegram_user_id = ?",
  )
    .bind(businessId, telegramUserId)
    .first<{ ok: number }>();
  return row !== null;
}

// Businesses -----------------------------------------------------------------

export async function createBusiness(
  env: Env,
  input: { name: string; locale: string; model: string; systemPrompt?: string },
): Promise<Business> {
  const id = generateId();
  const timestamp = now();
  await env.DB.prepare(
    `INSERT INTO business (id, name, locale, system_prompt, model, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, input.name, input.locale, input.systemPrompt ?? "", input.model, timestamp, timestamp)
    .run();
  return {
    id,
    name: input.name,
    locale: input.locale,
    systemPrompt: input.systemPrompt ?? "",
    model: input.model,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function listBusinesses(env: Env, telegramUserId: number): Promise<Business[]> {
  const operator = await findOperator(env, telegramUserId);
  if (operator === null) {
    return [];
  }
  const statement =
    operator.role === "owner"
      ? env.DB.prepare("SELECT * FROM business ORDER BY created_at DESC")
      : env.DB.prepare(
          `SELECT b.* FROM business b
           JOIN business_operator bo ON bo.business_id = b.id
           WHERE bo.telegram_user_id = ?
           ORDER BY b.created_at DESC`,
        ).bind(telegramUserId);
  const result = await statement.all<BusinessRow>();
  return result.results.map(toBusiness);
}

export async function getBusiness(env: Env, businessId: string): Promise<Business> {
  assertValidId(businessId, "businessId");
  const row = await env.DB.prepare("SELECT * FROM business WHERE id = ?")
    .bind(businessId)
    .first<BusinessRow>();
  if (row === null) {
    throw notFound("business not found", { businessId });
  }
  return toBusiness(row);
}

export async function updateBusinessModel(
  env: Env,
  businessId: string,
  model: string,
): Promise<void> {
  assertValidId(businessId, "businessId");
  await env.DB.prepare("UPDATE business SET model = ?, updated_at = ? WHERE id = ?")
    .bind(model, now(), businessId)
    .run();
}

// Bots -----------------------------------------------------------------------

export async function createBot(
  env: Env,
  input: {
    businessId: string;
    role: BotRole;
    username: string;
    webhookPath: string;
    tokenCiphertext: string;
    webhookSecretHash: string;
  },
): Promise<Bot> {
  assertValidId(input.businessId, "businessId");
  const id = generateId();
  const timestamp = now();
  await env.DB.prepare(
    `INSERT INTO bot
       (id, business_id, role, username, webhook_path, token_ciphertext, webhook_secret_hash, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
  )
    .bind(
      id,
      input.businessId,
      input.role,
      input.username,
      input.webhookPath,
      input.tokenCiphertext,
      input.webhookSecretHash,
      timestamp,
    )
    .run();
  return {
    id,
    businessId: input.businessId,
    role: input.role,
    username: input.username,
    webhookPath: input.webhookPath,
    enabled: true,
    createdAt: timestamp,
  };
}

/** Loads the bot bound to a webhook path, including its sealed credentials. */
export async function getBotByWebhookPath(
  env: Env,
  webhookPath: string,
): Promise<(Bot & { tokenCiphertext: string; webhookSecretHash: string }) | null> {
  const row = await env.DB.prepare("SELECT * FROM bot WHERE webhook_path = ? AND enabled = 1")
    .bind(webhookPath)
    .first<BotRow>();
  if (row === null) {
    return null;
  }
  return {
    ...toBot(row),
    tokenCiphertext: row.token_ciphertext,
    webhookSecretHash: row.webhook_secret_hash,
  };
}

export interface ConsoleBot {
  readonly username: string;
  readonly webhookPath: string;
  readonly tokenCiphertext: string;
  readonly webhookSecretHash: string;
}

/**
 * Returns the bot that serves the console, if one has been connected.
 *
 * The console bot belongs to the deployment rather than to a business. It is
 * never listed among a business's bots and customers never reach it.
 */
export async function getConsoleBot(env: Env): Promise<ConsoleBot | null> {
  const row = await env.DB.prepare("SELECT * FROM console_bot WHERE id = 1").first<{
    username: string;
    webhook_path: string;
    token_ciphertext: string;
    webhook_secret_hash: string;
  }>();
  if (row === null) {
    return null;
  }
  return {
    username: row.username,
    webhookPath: row.webhook_path,
    tokenCiphertext: row.token_ciphertext,
    webhookSecretHash: row.webhook_secret_hash,
  };
}

/** Creates or replaces the console bot. */
export async function putConsoleBot(env: Env, input: ConsoleBot): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO console_bot
       (id, username, webhook_path, token_ciphertext, webhook_secret_hash, created_at)
     VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       username            = excluded.username,
       webhook_path        = excluded.webhook_path,
       token_ciphertext    = excluded.token_ciphertext,
       webhook_secret_hash = excluded.webhook_secret_hash`,
  )
    .bind(
      input.username,
      input.webhookPath,
      input.tokenCiphertext,
      input.webhookSecretHash,
      now(),
    )
    .run();
}

/** Returns the oldest business, used as the default target during setup. */
export async function firstBusiness(env: Env): Promise<Business | null> {
  const row = await env.DB.prepare(
    "SELECT * FROM business ORDER BY created_at LIMIT 1",
  ).first<BusinessRow>();
  return row === null ? null : toBusiness(row);
}

/**
 * Points an existing bot row at a different Telegram bot.
 *
 * Used both when an operator swaps the console bot from the console and when
 * the ADMIN_BOT_TOKEN secret changes and setup runs again. Updating the
 * credentials and the username together is what makes a swap actually take
 * effect rather than leaving the row describing the previous bot.
 */
export async function replaceBotIdentity(
  env: Env,
  input: {
    botId: string;
    username: string;
    tokenCiphertext: string;
    webhookPath: string;
    webhookSecretHash: string;
  },
): Promise<void> {
  await env.DB.prepare(
    `UPDATE bot
        SET username = ?, token_ciphertext = ?, webhook_path = ?, webhook_secret_hash = ?
      WHERE id = ?`,
  )
    .bind(
      input.username,
      input.tokenCiphertext,
      input.webhookPath,
      input.webhookSecretHash,
      input.botId,
    )
    .run();
}

export async function listBots(env: Env, businessId: string): Promise<Bot[]> {
  assertValidId(businessId, "businessId");
  // The website channel owns a bot row so its conversations have something to
  // reference, but it is not a bot anyone can write to on Telegram and must
  // not appear where those are listed.
  const result = await env.DB.prepare(
    `SELECT * FROM bot
      WHERE business_id = ? AND id NOT IN (SELECT bot_id FROM hidden_bot)
      ORDER BY created_at`,
  )
    .bind(businessId)
    .all<BotRow>();
  return result.results.map(toBot);
}

// Documents ------------------------------------------------------------------

export async function createDocument(
  env: Env,
  input: {
    businessId: string;
    filename: string;
    contentType: string;
    byteSize: number;
    objectKey: string;
  },
): Promise<BusinessDocument> {
  assertValidId(input.businessId, "businessId");
  const id = generateId();
  const timestamp = now();
  await env.DB.prepare(
    `INSERT INTO document
       (id, business_id, filename, content_type, byte_size, object_key, status, chunk_count, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, NULL, ?, ?)`,
  )
    .bind(
      id,
      input.businessId,
      input.filename,
      input.contentType,
      input.byteSize,
      input.objectKey,
      timestamp,
      timestamp,
    )
    .run();
  return {
    id,
    businessId: input.businessId,
    filename: input.filename,
    contentType: input.contentType,
    byteSize: input.byteSize,
    objectKey: input.objectKey,
    status: "pending",
    chunkCount: 0,
    error: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function setDocumentStatus(
  env: Env,
  input: { documentId: string; status: DocumentStatus; chunkCount?: number; error?: string | null },
): Promise<void> {
  assertValidId(input.documentId, "documentId");
  await env.DB.prepare(
    `UPDATE document
        SET status = ?, chunk_count = COALESCE(?, chunk_count), error = ?, updated_at = ?
      WHERE id = ?`,
  )
    .bind(
      input.status,
      input.chunkCount ?? null,
      input.error ?? null,
      now(),
      input.documentId,
    )
    .run();
}

export async function listDocuments(
  env: Env,
  businessId: string,
  limit = 20,
): Promise<BusinessDocument[]> {
  assertValidId(businessId, "businessId");
  const result = await env.DB.prepare(
    "SELECT * FROM document WHERE business_id = ? ORDER BY created_at DESC LIMIT ?",
  )
    .bind(businessId, limit)
    .all<{
      id: string;
      business_id: string;
      filename: string;
      content_type: string;
      byte_size: number;
      object_key: string;
      status: string;
      chunk_count: number;
      error: string | null;
      created_at: string;
      updated_at: string;
    }>();
  return result.results.map((row) => ({
    id: row.id,
    businessId: row.business_id,
    filename: row.filename,
    contentType: row.content_type,
    byteSize: row.byte_size,
    objectKey: row.object_key,
    status: row.status as DocumentStatus,
    chunkCount: row.chunk_count,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

// Chunks ---------------------------------------------------------------------

export async function insertChunks(
  env: Env,
  businessId: string,
  documentId: string,
  chunks: readonly { id: string; ordinal: number; text: string }[],
): Promise<void> {
  assertValidId(businessId, "businessId");
  if (chunks.length === 0) {
    return;
  }
  const statement = env.DB.prepare(
    "INSERT INTO chunk (id, business_id, document_id, ordinal, text) VALUES (?, ?, ?, ?, ?)",
  );
  await env.DB.batch(
    chunks.map((chunk) =>
      statement.bind(chunk.id, businessId, documentId, chunk.ordinal, chunk.text),
    ),
  );
}

export async function loadChunkTexts(
  env: Env,
  businessId: string,
  chunkIds: readonly string[],
): Promise<Map<string, { text: string; filename: string }>> {
  assertValidId(businessId, "businessId");
  const out = new Map<string, { text: string; filename: string }>();
  if (chunkIds.length === 0) {
    return out;
  }
  const placeholders = chunkIds.map(() => "?").join(", ");
  const result = await env.DB.prepare(
    `SELECT c.id, c.text, d.filename
       FROM chunk c
       JOIN document d ON d.id = c.document_id
      WHERE c.business_id = ? AND c.id IN (${placeholders})`,
  )
    .bind(businessId, ...chunkIds)
    .all<{ id: string; text: string; filename: string }>();
  for (const row of result.results) {
    out.set(row.id, { text: row.text, filename: row.filename });
  }
  return out;
}

// Conversations --------------------------------------------------------------

export async function upsertConversation(
  env: Env,
  input: { businessId: string; botId: string; chatId: number },
): Promise<string> {
  const existing = await env.DB.prepare(
    "SELECT id FROM conversation WHERE bot_id = ? AND chat_id = ?",
  )
    .bind(input.botId, input.chatId)
    .first<{ id: string }>();
  if (existing !== null) {
    await env.DB.prepare("UPDATE conversation SET updated_at = ? WHERE id = ?")
      .bind(now(), existing.id)
      .run();
    return existing.id;
  }
  const id = generateId();
  const timestamp = now();
  await env.DB.prepare(
    `INSERT INTO conversation (id, business_id, bot_id, chat_id, escalated, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`,
  )
    .bind(id, input.businessId, input.botId, input.chatId, timestamp, timestamp)
    .run();
  return id;
}

export async function appendMessage(
  env: Env,
  input: {
    conversationId: string;
    businessId: string;
    role: "user" | "assistant";
    content: string;
  },
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO message (id, conversation_id, business_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(generateId(), input.conversationId, input.businessId, input.role, input.content, now())
    .run();
}

/**
 * Removes every product in a business.
 *
 * A bad import can create hundreds of rows in one press, and deleting those one
 * at a time through a phone keyboard is not a repair anyone would attempt.
 */
export async function deleteAllProducts(env: Env, businessId: string): Promise<number> {
  const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM product WHERE business_id = ?")
    .bind(businessId)
    .first<{ n: number }>();
  await env.DB.prepare("DELETE FROM product WHERE business_id = ?").bind(businessId).run();
  return before?.n ?? 0;
}

/** Records that a reply was typed by a person rather than produced by the model. */
export async function appendHumanMessage(
  env: Env,
  input: { conversationId: string; businessId: string; content: string },
): Promise<void> {
  const id = generateId();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO message (id, conversation_id, business_id, role, content, created_at) VALUES (?, ?, ?, 'assistant', ?, ?)",
    ).bind(id, input.conversationId, input.businessId, input.content, now()),
    // Marked separately so the transcript can show who spoke while the model
    // still reads it as an ordinary turn from the business.
    env.DB.prepare("INSERT INTO message_author (message_id, sent_by) VALUES (?, 'human')").bind(id),
  ]);
}

/**
 * Records a customer turn that carried a photo, video, sticker or file.
 *
 * The attachment row is written in the same batch as the message, so a
 * transcript can never show a turn that promises an image the console cannot
 * find.
 */
export async function appendMessageWithMedia(
  env: Env,
  input: {
    conversationId: string;
    businessId: string;
    botId: string;
    content: string;
    media: { kind: string; fileId: string; label: string } | null;
  },
): Promise<void> {
  const id = generateId();
  const statements = [
    env.DB.prepare(
      "INSERT INTO message (id, conversation_id, business_id, role, content, created_at) VALUES (?, ?, ?, 'user', ?, ?)",
    ).bind(id, input.conversationId, input.businessId, input.content, now()),
  ];
  if (input.media !== null) {
    statements.push(
      env.DB.prepare(
        "INSERT INTO message_media (message_id, bot_id, kind, file_id, label) VALUES (?, ?, ?, ?, ?)",
      ).bind(id, input.botId, input.media.kind, input.media.fileId, input.media.label.slice(0, 120)),
    );
  }
  await env.DB.batch(statements);
}

export interface StoredMedia {
  readonly messageId: string;
  readonly botId: string;
  readonly kind: string;
  readonly fileId: string;
  readonly label: string;
}

/** Loads one attachment so the console can ask Telegram to fetch it. */
export async function getMedia(env: Env, messageId: string): Promise<StoredMedia | null> {
  const row = await env.DB.prepare("SELECT * FROM message_media WHERE message_id = ?")
    .bind(messageId)
    .first<{
      message_id: string;
      bot_id: string;
      kind: string;
      file_id: string;
      label: string;
    }>();
  return row === null
    ? null
    : {
        messageId: row.message_id,
        botId: row.bot_id,
        kind: row.kind,
        fileId: row.file_id,
        label: row.label,
      };
}

export interface TranscriptTurn {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly sentBy: "bot" | "human";
  readonly createdAt: string;
  /** Present when the turn carried an attachment. */
  readonly media: { readonly kind: string; readonly label: string } | null;
}

/**
 * Returns a conversation as a person would read it, newest last.
 *
 * Separate from `recentTurns` because the two have different jobs: that one
 * feeds a prompt and must stay small, this one is read by an operator deciding
 * whether to step in.
 */
export async function transcript(
  env: Env,
  conversationId: string,
  limit = 30,
): Promise<TranscriptTurn[]> {
  const result = await env.DB.prepare(
    `SELECT m.id, m.role, m.content, m.created_at,
            COALESCE(a.sent_by, 'bot') AS sent_by,
            md.kind AS media_kind, md.label AS media_label
       FROM message m
       LEFT JOIN message_author a ON a.message_id = m.id
       LEFT JOIN message_media  md ON md.message_id = m.id
      WHERE m.conversation_id = ?
      ORDER BY m.created_at DESC
      LIMIT ?`,
  )
    .bind(conversationId, limit)
    .all<{
      id: string;
      role: string;
      content: string;
      created_at: string;
      sent_by: string;
      media_kind: string | null;
      media_label: string | null;
    }>();
  return result.results
    .map((row) => ({
      id: row.id,
      role: row.role as "user" | "assistant",
      content: row.content,
      sentBy: row.sent_by === "human" ? ("human" as const) : ("bot" as const),
      createdAt: row.created_at,
      media:
        row.media_kind === null
          ? null
          : { kind: row.media_kind, label: row.media_label ?? "" },
    }))
    .reverse();
}

export type HandoverState = "waiting" | "human";

export interface Handover {
  readonly conversationId: string;
  readonly businessId: string;
  readonly customerId: string | null;
  readonly state: HandoverState;
  readonly reason: string;
  readonly updatedAt: string;
}

function toHandover(row: {
  conversation_id: string;
  business_id: string;
  customer_id: string | null;
  state: string;
  reason: string;
  updated_at: string;
}): Handover {
  return {
    conversationId: row.conversation_id,
    businessId: row.business_id,
    customerId: row.customer_id,
    state: row.state === "human" ? "human" : "waiting",
    reason: row.reason,
    updatedAt: row.updated_at,
  };
}

export async function getHandover(env: Env, conversationId: string): Promise<Handover | null> {
  const row = await env.DB.prepare("SELECT * FROM handover WHERE conversation_id = ?")
    .bind(conversationId)
    .first<Parameters<typeof toHandover>[0]>();
  return row === null ? null : toHandover(row);
}

/**
 * Flags a conversation for a person to look at.
 *
 * An existing flag is left alone rather than reopened, so a customer asking
 * three questions the documents do not cover produces one item of work and does
 * not drag a chat a person is already answering back into the queue.
 */
export async function openHandover(
  env: Env,
  input: {
    conversationId: string;
    businessId: string;
    customerId: string | null;
    reason: string;
  },
): Promise<void> {
  const stamp = now();
  await env.DB.prepare(
    `INSERT INTO handover (conversation_id, business_id, customer_id, state, reason, opened_at, updated_at)
     VALUES (?, ?, ?, 'waiting', ?, ?, ?)
     ON CONFLICT (conversation_id) DO UPDATE SET updated_at = excluded.updated_at`,
  )
    .bind(
      input.conversationId,
      input.businessId,
      input.customerId,
      input.reason.slice(0, 200),
      stamp,
      stamp,
    )
    .run();
}

/** Puts a person in charge of a conversation, silencing the assistant there. */
export async function takeOverConversation(
  env: Env,
  input: { conversationId: string; businessId: string; customerId: string | null },
): Promise<void> {
  const stamp = now();
  await env.DB.prepare(
    `INSERT INTO handover (conversation_id, business_id, customer_id, state, reason, opened_at, updated_at)
     VALUES (?, ?, ?, 'human', '', ?, ?)
     ON CONFLICT (conversation_id) DO UPDATE SET state = 'human', updated_at = excluded.updated_at`,
  )
    .bind(input.conversationId, input.businessId, input.customerId, stamp, stamp)
    .run();
}

/** Returns the conversation to the assistant and clears the flag. */
export async function endHandover(env: Env, conversationId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM handover WHERE conversation_id = ?")
    .bind(conversationId)
    .run();
}

/** Conversations across every business that still need someone to look. */
export async function listHandovers(env: Env, limit = 20): Promise<
  (Handover & { businessName: string; customerName: string })[]
> {
  const result = await env.DB.prepare(
    `SELECT h.*, b.name AS business_name,
            COALESCE(NULLIF(c.display_name, ''), NULLIF(c.username, ''), '') AS customer_name
       FROM handover h
       JOIN business b ON b.id = h.business_id
       LEFT JOIN customer c ON c.id = h.customer_id
      ORDER BY h.updated_at DESC
      LIMIT ?`,
  )
    .bind(limit)
    .all<Parameters<typeof toHandover>[0] & { business_name: string; customer_name: string }>();
  return result.results.map((row) => ({
    ...toHandover(row),
    businessName: row.business_name,
    customerName: row.customer_name,
  }));
}

/** Finds the chat a customer is talking in, so an operator can answer into it. */
export async function conversationForCustomer(
  env: Env,
  input: { businessId: string; chatId: number },
): Promise<{ id: string; botId: string; chatId: number } | null> {
  const row = await env.DB.prepare(
    "SELECT id, bot_id, chat_id FROM conversation WHERE business_id = ? AND chat_id = ? ORDER BY updated_at DESC LIMIT 1",
  )
    .bind(input.businessId, input.chatId)
    .first<{ id: string; bot_id: string; chat_id: number }>();
  return row === null ? null : { id: row.id, botId: row.bot_id, chatId: row.chat_id };
}

/** Loads a bot with its sealed token, for sending on behalf of a business. */
export async function getBotById(
  env: Env,
  botId: string,
): Promise<(Bot & { tokenCiphertext: string }) | null> {
  const row = await env.DB.prepare("SELECT * FROM bot WHERE id = ?")
    .bind(botId)
    .first<BotRow>();
  return row === null ? null : { ...toBot(row), tokenCiphertext: row.token_ciphertext };
}

/** Returns recent turns in chronological order, bounded to keep prompts small. */
export async function recentTurns(
  env: Env,
  conversationId: string,
  limit = 8,
): Promise<ChatTurn[]> {
  const result = await env.DB.prepare(
    "SELECT role, content FROM message WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?",
  )
    .bind(conversationId, limit)
    .all<{ role: string; content: string }>();
  return result.results
    .map((row) => ({ role: row.role as "user" | "assistant", content: row.content }))
    .reverse();
}

// Console language -------------------------------------------------------------

/** Returns the console language an operator chose, or null for the default. */
export async function getOperatorLocale(env: Env, telegramUserId: number): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT locale FROM operator_locale WHERE telegram_user_id = ?",
  )
    .bind(telegramUserId)
    .first<{ locale: string }>();
  return row?.locale ?? null;
}

export async function setOperatorLocale(
  env: Env,
  telegramUserId: number,
  locale: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO operator_locale (telegram_user_id, locale) VALUES (?, ?)
     ON CONFLICT (telegram_user_id) DO UPDATE SET locale = excluded.locale`,
  )
    .bind(telegramUserId, locale)
    .run();
}

// Products ----------------------------------------------------------------------

export async function createProduct(
  env: Env,
  input: { businessId: string; name: string; price: string; description: string },
): Promise<string> {
  assertValidId(input.businessId, "businessId");
  const id = generateId();
  await env.DB.prepare(
    "INSERT INTO product (id, business_id, name, price, description, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(id, input.businessId, input.name, input.price, input.description, now())
    .run();
  return id;
}

/**
 * Inserts a whole imported list in as few round trips as possible.
 *
 * Written one row at a time, a hundred and forty products meant a hundred and
 * forty sequential trips to the database, which took the import past the time
 * the runtime allows for work after a response. It was cancelled halfway: the
 * rows existed, the catalogue the assistant reads did not, and the operator saw
 * no reply at all. Batches keep an import of any plausible size well inside the
 * budget.
 */
export async function createProducts(
  env: Env,
  businessId: string,
  items: readonly { name: string; price: string; description: string }[],
): Promise<number> {
  assertValidId(businessId, "businessId");
  if (items.length === 0) {
    return 0;
  }
  const stamp = now();
  const statement = env.DB.prepare(
    "INSERT INTO product (id, business_id, name, price, description, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  // Chunked because a single batch of unbounded size is its own failure mode.
  const BATCH = 50;
  for (let start = 0; start < items.length; start += BATCH) {
    await env.DB.batch(
      items
        .slice(start, start + BATCH)
        .map((item) =>
          statement.bind(generateId(), businessId, item.name, item.price, item.description, stamp),
        ),
    );
  }
  return items.length;
}

export async function listProducts(env: Env, businessId: string): Promise<Product[]> {
  assertValidId(businessId, "businessId");
  const result = await env.DB.prepare(
    "SELECT id, business_id, name, price, description, created_at FROM product WHERE business_id = ? ORDER BY name",
  )
    .bind(businessId)
    .all<{
      id: string;
      business_id: string;
      name: string;
      price: string;
      description: string;
      created_at: string;
    }>();
  return result.results.map((row) => ({
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    price: row.price,
    description: row.description,
    createdAt: row.created_at,
  }));
}

export async function getProduct(env: Env, productId: string): Promise<Product> {
  assertValidId(productId, "productId");
  const row = await env.DB.prepare("SELECT * FROM product WHERE id = ?")
    .bind(productId)
    .first<{
      id: string;
      business_id: string;
      name: string;
      price: string;
      description: string;
      created_at: string;
    }>();
  if (row === null) {
    throw notFound("product not found", { productId });
  }
  return {
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    price: row.price,
    description: row.description,
    createdAt: row.created_at,
  };
}

export async function deleteProduct(env: Env, productId: string): Promise<void> {
  assertValidId(productId, "productId");
  await env.DB.prepare("DELETE FROM product WHERE id = ?").bind(productId).run();
}

// Deletion ----------------------------------------------------------------------

/**
 * Removes a document and returns the ids of the vectors it owned.
 *
 * The caller deletes those from the index. Doing it in this order means a
 * failure leaves orphaned vectors, which retrieval already tolerates, rather
 * than rows pointing at vectors that are gone.
 */
export async function deleteDocument(
  env: Env,
  businessId: string,
  documentId: string,
): Promise<string[]> {
  assertValidId(businessId, "businessId");
  assertValidId(documentId, "documentId");
  const chunks = await env.DB.prepare(
    "SELECT id FROM chunk WHERE business_id = ? AND document_id = ?",
  )
    .bind(businessId, documentId)
    .all<{ id: string }>();
  await env.DB.prepare("DELETE FROM document WHERE id = ? AND business_id = ?")
    .bind(documentId, businessId)
    .run();
  return chunks.results.map((row) => row.id);
}

/** Removes a business and returns the ids of every vector it owned. */
export async function deleteBusiness(env: Env, businessId: string): Promise<string[]> {
  assertValidId(businessId, "businessId");
  const chunks = await env.DB.prepare("SELECT id FROM chunk WHERE business_id = ?")
    .bind(businessId)
    .all<{ id: string }>();
  // Every other table references business with ON DELETE CASCADE.
  await env.DB.prepare("DELETE FROM business WHERE id = ?").bind(businessId).run();
  return chunks.results.map((row) => row.id);
}

/** Finds the generated catalogue document for a business, if it exists. */
export async function findDocumentByName(
  env: Env,
  businessId: string,
  filename: string,
): Promise<string | null> {
  assertValidId(businessId, "businessId");
  const row = await env.DB.prepare(
    "SELECT id FROM document WHERE business_id = ? AND filename = ? ORDER BY created_at DESC LIMIT 1",
  )
    .bind(businessId, filename)
    .first<{ id: string }>();
  return row?.id ?? null;
}

// Events ------------------------------------------------------------------------

export interface LoggedEvent {
  readonly kind: string;
  readonly detail: string;
  readonly createdAt: string;
  readonly businessName: string | null;
}

/** Keeps the log short enough to read and small enough to ignore. */
const EVENT_LIMIT = 40;

/**
 * Records something the operator would want to know went wrong.
 *
 * Failures are already written to the Worker logs, but reading those needs a
 * dashboard and an account. This copy is for the person who only has the
 * console. Never called on the customer path in a way that can itself fail the
 * reply: the caller swallows any error from here.
 */
export async function recordEvent(
  env: Env,
  input: { businessId?: string; kind: string; detail: string },
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO event_log (id, business_id, kind, detail, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(generateId(), input.businessId ?? null, input.kind, input.detail.slice(0, 400), now())
    .run();

  await env.DB.prepare(
    `DELETE FROM event_log WHERE id NOT IN (
       SELECT id FROM event_log ORDER BY created_at DESC LIMIT ?
     )`,
  )
    .bind(EVENT_LIMIT)
    .run();
}

export async function listEvents(env: Env, limit = 10): Promise<LoggedEvent[]> {
  const result = await env.DB.prepare(
    `SELECT e.kind, e.detail, e.created_at, b.name AS business_name
       FROM event_log e
       LEFT JOIN business b ON b.id = e.business_id
      ORDER BY e.created_at DESC LIMIT ?`,
  )
    .bind(limit)
    .all<{ kind: string; detail: string; created_at: string; business_name: string | null }>();
  return result.results.map((row) => ({
    kind: row.kind,
    detail: row.detail,
    createdAt: row.created_at,
    businessName: row.business_name,
  }));
}

// Customers ------------------------------------------------------------------

interface CustomerRow {
  id: string;
  business_id: string;
  telegram_user_id: number;
  chat_id: number;
  display_name: string;
  username: string;
  stage: string;
  tags: string;
  note: string;
  message_count: number;
  first_seen: string;
  last_seen: string;
}

function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    businessId: row.business_id,
    telegramUserId: row.telegram_user_id,
    chatId: row.chat_id,
    displayName: row.display_name,
    username: row.username,
    stage: row.stage as CustomerStage,
    tags: row.tags,
    note: row.note,
    messageCount: row.message_count,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
  };
}

/**
 * Records that a person wrote to a reply bot.
 *
 * Called on every inbound customer message, so it has to be a single round trip
 * in the common case. The insert carries the counters and the update bumps them,
 * which avoids reading first.
 */
export async function touchCustomer(
  env: Env,
  input: {
    businessId: string;
    telegramUserId: number;
    chatId: number;
    displayName: string;
    username: string;
  },
): Promise<{ id: string; messageCount: number }> {
  const timestamp = now();
  await env.DB.prepare(
    `INSERT INTO customer
       (id, business_id, telegram_user_id, chat_id, display_name, username,
        stage, tags, note, message_count, first_seen, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, 'new', '', '', 1, ?, ?)
     ON CONFLICT (business_id, telegram_user_id) DO UPDATE SET
       chat_id       = excluded.chat_id,
       display_name  = excluded.display_name,
       username      = excluded.username,
       message_count = message_count + 1,
       last_seen     = excluded.last_seen`,
  )
    .bind(
      generateId(),
      input.businessId,
      input.telegramUserId,
      input.chatId,
      input.displayName,
      input.username,
      timestamp,
      timestamp,
    )
    .run();

  const row = await env.DB.prepare(
    "SELECT id, message_count FROM customer WHERE business_id = ? AND telegram_user_id = ?",
  )
    .bind(input.businessId, input.telegramUserId)
    .first<{ id: string; message_count: number }>();
  if (row === null) {
    throw notFound("customer row vanished after upsert", { businessId: input.businessId });
  }
  return { id: row.id, messageCount: row.message_count };
}

export async function listCustomers(
  env: Env,
  businessId: string,
  limit = 20,
): Promise<Customer[]> {
  assertValidId(businessId, "businessId");
  const result = await env.DB.prepare(
    "SELECT * FROM customer WHERE business_id = ? ORDER BY last_seen DESC LIMIT ?",
  )
    .bind(businessId, limit)
    .all<CustomerRow>();
  return result.results.map(toCustomer);
}

export async function getCustomer(env: Env, customerId: string): Promise<Customer> {
  assertValidId(customerId, "customerId");
  const row = await env.DB.prepare("SELECT * FROM customer WHERE id = ?")
    .bind(customerId)
    .first<CustomerRow>();
  if (row === null) {
    throw notFound("customer not found", { customerId });
  }
  return toCustomer(row);
}

export async function setCustomerStage(
  env: Env,
  customerId: string,
  stage: CustomerStage,
): Promise<void> {
  assertValidId(customerId, "customerId");
  await env.DB.prepare("UPDATE customer SET stage = ? WHERE id = ?").bind(stage, customerId).run();
}

export async function setCustomerNote(
  env: Env,
  customerId: string,
  note: string,
): Promise<void> {
  assertValidId(customerId, "customerId");
  await env.DB.prepare("UPDATE customer SET note = ? WHERE id = ?").bind(note, customerId).run();
}

/** Removes a customer along with everything remembered about them. */
export async function forgetCustomer(env: Env, customerId: string): Promise<void> {
  assertValidId(customerId, "customerId");
  await env.DB.prepare("DELETE FROM customer WHERE id = ?").bind(customerId).run();
}

// Memory ----------------------------------------------------------------------

export async function listFacts(
  env: Env,
  customerId: string,
  limit = 40,
): Promise<CustomerFact[]> {
  assertValidId(customerId, "customerId");
  const result = await env.DB.prepare(
    "SELECT id, fact, created_at FROM customer_memory WHERE customer_id = ? ORDER BY created_at DESC LIMIT ?",
  )
    .bind(customerId, limit)
    .all<{ id: string; fact: string; created_at: string }>();
  return result.results.map((row) => ({
    id: row.id,
    fact: row.fact,
    createdAt: row.created_at,
  }));
}

export async function addFacts(
  env: Env,
  input: { businessId: string; customerId: string; facts: readonly string[] },
): Promise<void> {
  if (input.facts.length === 0) {
    return;
  }
  const statement = env.DB.prepare(
    "INSERT INTO customer_memory (id, business_id, customer_id, fact, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  const timestamp = now();
  await env.DB.batch(
    input.facts.map((fact) =>
      statement.bind(generateId(), input.businessId, input.customerId, fact, timestamp),
    ),
  );
}

/** Drops the oldest facts once a customer has accumulated more than `keep`. */
export async function trimFacts(env: Env, customerId: string, keep: number): Promise<void> {
  assertValidId(customerId, "customerId");
  await env.DB.prepare(
    `DELETE FROM customer_memory
      WHERE customer_id = ?
        AND id NOT IN (
          SELECT id FROM customer_memory WHERE customer_id = ? ORDER BY created_at DESC LIMIT ?
        )`,
  )
    .bind(customerId, customerId, keep)
    .run();
}

export async function forgetFacts(env: Env, customerId: string): Promise<void> {
  assertValidId(customerId, "customerId");
  await env.DB.prepare("DELETE FROM customer_memory WHERE customer_id = ?")
    .bind(customerId)
    .run();
}

// Instructions ----------------------------------------------------------------

/**
 * Replaces the instruction document for a business, keeping the previous one.
 *
 * A prompt that breaks the assistant does so quietly, so the old text is
 * retained and the console offers a rollback.
 */
export async function setBusinessPrompt(
  env: Env,
  businessId: string,
  prompt: string,
): Promise<void> {
  assertValidId(businessId, "businessId");
  const current = await getBusiness(env, businessId);
  if (current.systemPrompt.length > 0) {
    await env.DB.prepare(
      "INSERT INTO prompt_version (id, business_id, prompt, created_at) VALUES (?, ?, ?, ?)",
    )
      .bind(generateId(), businessId, current.systemPrompt, now())
      .run();
  }
  await env.DB.prepare("UPDATE business SET system_prompt = ?, updated_at = ? WHERE id = ?")
    .bind(prompt, now(), businessId)
    .run();
}

/** Returns the most recent superseded instruction document, if there is one. */
export async function previousPrompt(env: Env, businessId: string): Promise<string | null> {
  assertValidId(businessId, "businessId");
  const row = await env.DB.prepare(
    "SELECT prompt FROM prompt_version WHERE business_id = ? ORDER BY created_at DESC LIMIT 1",
  )
    .bind(businessId)
    .first<{ prompt: string }>();
  return row?.prompt ?? null;
}

// Usage ----------------------------------------------------------------------

export async function recordUsage(
  env: Env,
  input: { businessId: string; inputTokens: number; outputTokens: number },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO usage_daily (business_id, day, messages, input_tokens, output_tokens)
     VALUES (?, ?, 1, ?, ?)
     ON CONFLICT (business_id, day) DO UPDATE SET
       messages = messages + 1,
       input_tokens = input_tokens + excluded.input_tokens,
       output_tokens = output_tokens + excluded.output_tokens`,
  )
    .bind(input.businessId, utcDay(), input.inputTokens, input.outputTokens)
    .run();
}

/**
 * Totals what this deployment has answered today, across every business.
 *
 * Recorded by Muxel itself rather than read from Cloudflare, so it is available
 * on a deployment that has no API token configured.
 */
export async function todayUsageAll(
  env: Env,
): Promise<{ messages: number; inputTokens: number; outputTokens: number }> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(messages), 0) AS messages,
            COALESCE(SUM(input_tokens), 0) AS input_tokens,
            COALESCE(SUM(output_tokens), 0) AS output_tokens
       FROM usage_daily WHERE day = ?`,
  )
    .bind(utcDay())
    .first<{ messages: number; input_tokens: number; output_tokens: number }>();
  return {
    messages: row?.messages ?? 0,
    inputTokens: row?.input_tokens ?? 0,
    outputTokens: row?.output_tokens ?? 0,
  };
}

export async function todayUsage(
  env: Env,
  businessId: string,
): Promise<{ messages: number; inputTokens: number; outputTokens: number }> {
  const row = await env.DB.prepare(
    "SELECT messages, input_tokens, output_tokens FROM usage_daily WHERE business_id = ? AND day = ?",
  )
    .bind(businessId, utcDay())
    .first<{ messages: number; input_tokens: number; output_tokens: number }>();
  return {
    messages: row?.messages ?? 0,
    inputTokens: row?.input_tokens ?? 0,
    outputTokens: row?.output_tokens ?? 0,
  };
}
