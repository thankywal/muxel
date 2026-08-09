/**
 * Schema management.
 *
 * A one click deploy provisions the database but never runs migrations, so the
 * Worker cannot assume its tables exist. Migrations are embedded here rather
 * than read from disk, and every statement is written so that running it twice
 * is harmless. The applied version is recorded, so a later release only runs
 * what is new.
 *
 * Two requests can reach a cold deployment at the same time. Every statement
 * uses IF NOT EXISTS and the version row is written with INSERT OR REPLACE, so
 * a concurrent second run converges on the same result rather than failing.
 */

import type { Env } from "../env.js";

interface Migration {
  readonly version: number;
  readonly statements: readonly string[];
}

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS operator (
         telegram_user_id INTEGER PRIMARY KEY,
         label            TEXT,
         role             TEXT NOT NULL CHECK (role IN ('owner', 'admin')),
         created_at       TEXT NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS business (
         id            TEXT PRIMARY KEY,
         name          TEXT NOT NULL,
         locale        TEXT NOT NULL DEFAULT 'en',
         system_prompt TEXT NOT NULL DEFAULT '',
         model         TEXT NOT NULL,
         created_at    TEXT NOT NULL,
         updated_at    TEXT NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS business_operator (
         business_id      TEXT NOT NULL REFERENCES business (id) ON DELETE CASCADE,
         telegram_user_id INTEGER NOT NULL REFERENCES operator (telegram_user_id) ON DELETE CASCADE,
         created_at       TEXT NOT NULL,
         PRIMARY KEY (business_id, telegram_user_id)
       )`,
      `CREATE TABLE IF NOT EXISTS bot (
         id                  TEXT PRIMARY KEY,
         business_id         TEXT NOT NULL REFERENCES business (id) ON DELETE CASCADE,
         role                TEXT NOT NULL CHECK (role IN ('admin', 'reply')),
         username            TEXT NOT NULL,
         webhook_path        TEXT NOT NULL UNIQUE,
         token_ciphertext    TEXT NOT NULL,
         webhook_secret_hash TEXT NOT NULL,
         enabled             INTEGER NOT NULL DEFAULT 1,
         created_at          TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS bot_business_idx ON bot (business_id)`,
      `CREATE TABLE IF NOT EXISTS document (
         id           TEXT PRIMARY KEY,
         business_id  TEXT NOT NULL REFERENCES business (id) ON DELETE CASCADE,
         filename     TEXT NOT NULL,
         content_type TEXT NOT NULL,
         byte_size    INTEGER NOT NULL,
         object_key   TEXT NOT NULL,
         status       TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
         chunk_count  INTEGER NOT NULL DEFAULT 0,
         error        TEXT,
         created_at   TEXT NOT NULL,
         updated_at   TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS document_business_idx ON document (business_id, created_at DESC)`,
      `CREATE TABLE IF NOT EXISTS chunk (
         id          TEXT PRIMARY KEY,
         business_id TEXT NOT NULL REFERENCES business (id) ON DELETE CASCADE,
         document_id TEXT NOT NULL REFERENCES document (id) ON DELETE CASCADE,
         ordinal     INTEGER NOT NULL,
         text        TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS chunk_document_idx ON chunk (document_id, ordinal)`,
      `CREATE INDEX IF NOT EXISTS chunk_business_idx ON chunk (business_id)`,
      `CREATE TABLE IF NOT EXISTS conversation (
         id          TEXT PRIMARY KEY,
         business_id TEXT NOT NULL REFERENCES business (id) ON DELETE CASCADE,
         bot_id      TEXT NOT NULL REFERENCES bot (id) ON DELETE CASCADE,
         chat_id     INTEGER NOT NULL,
         escalated   INTEGER NOT NULL DEFAULT 0,
         created_at  TEXT NOT NULL,
         updated_at  TEXT NOT NULL,
         UNIQUE (bot_id, chat_id)
       )`,
      `CREATE INDEX IF NOT EXISTS conversation_business_idx ON conversation (business_id, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS message (
         id              TEXT PRIMARY KEY,
         conversation_id TEXT NOT NULL REFERENCES conversation (id) ON DELETE CASCADE,
         business_id     TEXT NOT NULL REFERENCES business (id) ON DELETE CASCADE,
         role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
         content         TEXT NOT NULL,
         created_at      TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS message_conversation_idx ON message (conversation_id, created_at DESC)`,
      `CREATE TABLE IF NOT EXISTS usage_daily (
         business_id   TEXT NOT NULL REFERENCES business (id) ON DELETE CASCADE,
         day           TEXT NOT NULL,
         messages      INTEGER NOT NULL DEFAULT 0,
         input_tokens  INTEGER NOT NULL DEFAULT 0,
         output_tokens INTEGER NOT NULL DEFAULT 0,
         PRIMARY KEY (business_id, day)
       )`,
    ],
  },
  {
    version: 2,
    statements: [
      // One row per person who has ever written to a reply bot. This is the
      // customer record the console lists and the anchor for remembered facts.
      `CREATE TABLE IF NOT EXISTS customer (
         id               TEXT PRIMARY KEY,
         business_id      TEXT NOT NULL REFERENCES business (id) ON DELETE CASCADE,
         telegram_user_id INTEGER NOT NULL,
         chat_id          INTEGER NOT NULL,
         display_name     TEXT NOT NULL DEFAULT '',
         username         TEXT NOT NULL DEFAULT '',
         stage            TEXT NOT NULL DEFAULT 'new'
                            CHECK (stage IN ('new', 'lead', 'customer', 'blocked')),
         tags             TEXT NOT NULL DEFAULT '',
         note             TEXT NOT NULL DEFAULT '',
         message_count    INTEGER NOT NULL DEFAULT 0,
         first_seen       TEXT NOT NULL,
         last_seen        TEXT NOT NULL,
         UNIQUE (business_id, telegram_user_id)
       )`,
      `CREATE INDEX IF NOT EXISTS customer_business_idx ON customer (business_id, last_seen DESC)`,

      // Durable facts distilled from conversations. Deliberately not embedded:
      // a customer accumulates tens of facts, not thousands, so every one can
      // be loaded by key. That keeps the Vectorize allowance for documents.
      `CREATE TABLE IF NOT EXISTS customer_memory (
         id          TEXT PRIMARY KEY,
         business_id TEXT NOT NULL REFERENCES business (id) ON DELETE CASCADE,
         customer_id TEXT NOT NULL REFERENCES customer (id) ON DELETE CASCADE,
         fact        TEXT NOT NULL,
         created_at  TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS customer_memory_idx ON customer_memory (customer_id, created_at DESC)`,

      // Previous instruction documents, so a prompt that breaks the assistant
      // can be rolled back. A bad prompt fails quietly, which is exactly the
      // kind of mistake that needs an undo.
      `CREATE TABLE IF NOT EXISTS prompt_version (
         id          TEXT PRIMARY KEY,
         business_id TEXT NOT NULL REFERENCES business (id) ON DELETE CASCADE,
         prompt      TEXT NOT NULL,
         created_at  TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS prompt_version_idx ON prompt_version (business_id, created_at DESC)`,
    ],
  },
];

/** Highest migration this build knows about. */
export const TARGET_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

/**
 * Remembers the version this isolate has already confirmed.
 *
 * Without it every request would pay a read to check a value that changes at
 * most once per release.
 */
let verifiedVersion = 0;

async function currentVersion(env: Env): Promise<number> {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS schema_version (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)",
  ).run();
  const row = await env.DB.prepare("SELECT version FROM schema_version WHERE id = 1").first<{
    version: number;
  }>();
  return row?.version ?? 0;
}

/**
 * Applies any migrations the database is missing.
 *
 * @returns The version the database is at once this call completes.
 */
export async function ensureSchema(env: Env): Promise<number> {
  if (verifiedVersion >= TARGET_VERSION) {
    return verifiedVersion;
  }

  const applied = await currentVersion(env);
  if (applied >= TARGET_VERSION) {
    verifiedVersion = applied;
    return applied;
  }

  for (const migration of MIGRATIONS) {
    if (migration.version <= applied) {
      continue;
    }
    await env.DB.batch(migration.statements.map((sql) => env.DB.prepare(sql)));
    await env.DB.prepare(
      "INSERT OR REPLACE INTO schema_version (id, version) VALUES (1, ?)",
    )
      .bind(migration.version)
      .run();
  }

  verifiedVersion = TARGET_VERSION;
  return TARGET_VERSION;
}
