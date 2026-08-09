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

/** Returns the console bot for this deployment, if one has been connected. */
export async function getAdminBot(env: Env): Promise<Bot | null> {
  const row = await env.DB.prepare(
    "SELECT * FROM bot WHERE role = 'admin' ORDER BY created_at LIMIT 1",
  ).first<BotRow>();
  return row === null ? null : toBot(row);
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
  const result = await env.DB.prepare(
    "SELECT * FROM bot WHERE business_id = ? ORDER BY created_at",
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
