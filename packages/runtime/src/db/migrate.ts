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
  {
    version: 3,
    statements: [
      // Console language per operator. Held in its own table rather than as a
      // column on operator so the migration stays a CREATE, which is safe to
      // run twice. ALTER TABLE is not.
      `CREATE TABLE IF NOT EXISTS operator_locale (
         telegram_user_id INTEGER PRIMARY KEY,
         locale           TEXT NOT NULL
       )`,

      // Items an operator enters by hand, one at a time or in bulk. Kept
      // structured so a single item can be corrected or removed, rather than
      // living inside an uploaded file that has to be replaced wholesale.
      `CREATE TABLE IF NOT EXISTS product (
         id          TEXT PRIMARY KEY,
         business_id TEXT NOT NULL REFERENCES business (id) ON DELETE CASCADE,
         name        TEXT NOT NULL,
         price       TEXT NOT NULL DEFAULT '',
         description TEXT NOT NULL DEFAULT '',
         created_at  TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS product_business_idx ON product (business_id, name)`,
    ],
  },
  {
    version: 4,
    statements: [
      // The console bot belongs to the deployment, not to a business. Holding it
      // in the bot table forced it to reference one, which then appeared in that
      // business's bot list as though customers could reach it. There is exactly
      // one, so the row is pinned to id 1.
      `CREATE TABLE IF NOT EXISTS console_bot (
         id                  INTEGER PRIMARY KEY CHECK (id = 1),
         username            TEXT NOT NULL,
         webhook_path        TEXT NOT NULL UNIQUE,
         token_ciphertext    TEXT NOT NULL,
         webhook_secret_hash TEXT NOT NULL,
         created_at          TEXT NOT NULL
       )`,
      // Carry an existing console bot across so a running deployment keeps
      // working through the upgrade without re-registering anything.
      `INSERT OR IGNORE INTO console_bot
         (id, username, webhook_path, token_ciphertext, webhook_secret_hash, created_at)
       SELECT 1, username, webhook_path, token_ciphertext, webhook_secret_hash, created_at
         FROM bot WHERE role = 'admin' ORDER BY created_at LIMIT 1`,
      `DELETE FROM bot WHERE role = 'admin'`,
    ],
  },
  {
    version: 5,
    statements: [
      // Recent failures, readable from the console.
      //
      // When the assistant does not answer, the reason is in the Worker logs,
      // which means a dashboard, an account and knowing where to look. A shop
      // owner has none of that, and neither does anyone helping them by
      // message. Keeping the last few problems here puts the answer in the
      // place they already are.
      `CREATE TABLE IF NOT EXISTS event_log (
         id          TEXT PRIMARY KEY,
         business_id TEXT,
         kind        TEXT NOT NULL,
         detail      TEXT NOT NULL,
         created_at  TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS event_log_idx ON event_log (created_at DESC)`,
    ],
  },
  {
    version: 6,
    statements: [
      // Conversations a person needs to look at, and conversations a person is
      // currently answering.
      //
      // `waiting` means the assistant met a question the documents do not cover
      // and said so. The assistant keeps answering everything else in that
      // chat, because going mute after one hard question would be worse than
      // the question itself. `human` means an operator has taken the chat over
      // and the assistant stays out of the way until they hand it back.
      //
      // Its own table rather than a column on conversation, so the migration is
      // a CREATE and stays safe if it is ever replayed.
      `CREATE TABLE IF NOT EXISTS handover (
         conversation_id TEXT PRIMARY KEY REFERENCES conversation (id) ON DELETE CASCADE,
         business_id     TEXT NOT NULL REFERENCES business (id) ON DELETE CASCADE,
         customer_id     TEXT,
         state           TEXT NOT NULL CHECK (state IN ('waiting', 'human')),
         reason          TEXT NOT NULL DEFAULT '',
         opened_at       TEXT NOT NULL,
         updated_at      TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS handover_business_idx ON handover (business_id, updated_at DESC)`,

      // Which replies came from a person rather than the assistant.
      //
      // The transcript has to show the difference, but the model must not: a
      // reply typed by the owner is still the business speaking, so it stays a
      // normal assistant turn in `message` and is marked here instead. Only
      // human replies get a row, so this stays small.
      `CREATE TABLE IF NOT EXISTS message_author (
         message_id TEXT PRIMARY KEY REFERENCES message (id) ON DELETE CASCADE,
         sent_by    TEXT NOT NULL
       )`,
    ],
  },
  {
    version: 7,
    statements: [
      // Photos, videos, stickers and files a customer sent.
      //
      // Only the Telegram file id is kept, never the bytes. Storing the bytes
      // would mean R2, and R2 asks for a payment method, which this project
      // promises is unnecessary. The id is enough: the business bot can turn it
      // into a temporary link on demand, and the console asks Telegram to fetch
      // that link when an operator wants to look.
      //
      // A file id belongs to the bot that received it, so the bot is recorded
      // alongside it. The console cannot resolve one on its own.
      `CREATE TABLE IF NOT EXISTS message_media (
         message_id TEXT PRIMARY KEY REFERENCES message (id) ON DELETE CASCADE,
         bot_id     TEXT NOT NULL,
         kind       TEXT NOT NULL,
         file_id    TEXT NOT NULL,
         label      TEXT NOT NULL DEFAULT ''
       )`,
    ],
  },
  {
    version: 8,
    statements: [
      // Products become a view over the uploaded documents instead of a second
      // store the operator maintains by hand. Two stores of the same facts was
      // the cause of a whole class of faults: a PDF imported as products
      // became a hundred rows of noise, and a price in a document could
      // disagree with the same price typed into the table.
      //
      // What the assistant knows still comes only from the documents. These
      // rows are read by the console alone, extracted once per document, and
      // regenerated whenever the operator asks.
      `CREATE TABLE IF NOT EXISTS extracted_product (
         id          TEXT PRIMARY KEY,
         business_id TEXT NOT NULL REFERENCES business (id) ON DELETE CASCADE,
         document_id TEXT NOT NULL,
         name        TEXT NOT NULL,
         price       TEXT NOT NULL DEFAULT '',
         description TEXT NOT NULL DEFAULT '',
         created_at  TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS extracted_product_idx ON extracted_product (business_id, name)`,

      // Which documents still owe an extraction. The upload tries immediately,
      // but it runs inside a bounded invocation, so the scheduled run finishes
      // whatever did not fit.
      `CREATE TABLE IF NOT EXISTS extraction_state (
         document_id TEXT PRIMARY KEY,
         business_id TEXT NOT NULL,
         state       TEXT NOT NULL CHECK (state IN ('pending', 'done', 'failed')),
         detail      TEXT NOT NULL DEFAULT '',
         updated_at  TEXT NOT NULL
       )`,

      // Corrections the operator makes from the console: a price fixed, an item
      // withdrawn, an item added by typing. Stored structurally so the products
      // view can apply them, and rendered into a single owner-updates document
      // so the assistant learns them through the same door as everything else.
      `CREATE TABLE IF NOT EXISTS product_correction (
         id          TEXT PRIMARY KEY,
         business_id TEXT NOT NULL REFERENCES business (id) ON DELETE CASCADE,
         name_key    TEXT NOT NULL,
         name        TEXT NOT NULL,
         price       TEXT NOT NULL DEFAULT '',
         description TEXT NOT NULL DEFAULT '',
         removed     INTEGER NOT NULL DEFAULT 0,
         updated_at  TEXT NOT NULL
       )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS product_correction_idx ON product_correction (business_id, name_key)`,

      // The synthetic catalogue document is retired: it was the second voice in
      // the reference material. Vectors it left in the index are tolerated by
      // retrieval, which skips matches without a backing row.
      `DELETE FROM chunk WHERE document_id IN (SELECT id FROM document WHERE filename = 'Product catalogue')`,
      `DELETE FROM document WHERE filename = 'Product catalogue'`,
    ],
  },
  {
    version: 9,
    statements: [
      // The same assistant, reached from a website instead of Telegram.
      //
      // The key is public by nature: it sits in a script tag on a page anyone
      // can read. It therefore identifies a business and nothing else, and the
      // protections that matter are the origin allowlist and the daily cap,
      // not secrecy. Colour and greeting live here so the operator can change
      // how the widget looks without touching their site again.
      `CREATE TABLE IF NOT EXISTS web_channel (
         id              TEXT PRIMARY KEY,
         business_id     TEXT NOT NULL REFERENCES business (id) ON DELETE CASCADE,
         key             TEXT NOT NULL UNIQUE,
         bot_id          TEXT NOT NULL,
         title           TEXT NOT NULL DEFAULT '',
         greeting        TEXT NOT NULL DEFAULT '',
         accent          TEXT NOT NULL DEFAULT '#2563eb',
         allowed_origins TEXT NOT NULL DEFAULT '',
         daily_limit     INTEGER NOT NULL DEFAULT 500,
         enabled         INTEGER NOT NULL DEFAULT 1,
         created_at      TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS web_channel_business_idx ON web_channel (business_id)`,

      // A visitor's browser holds a random session id in local storage. It is
      // mapped to a stable negative number here, because a conversation and a
      // customer are both keyed by a Telegram account id and Telegram never
      // issues a negative one. Reusing those tables rather than adding a
      // parallel pair is what lets the transcript, the customer list, memory
      // and human takeover work on a web visitor with no changes at all.
      `CREATE TABLE IF NOT EXISTS web_session (
         id          TEXT PRIMARY KEY,
         channel_id  TEXT NOT NULL REFERENCES web_channel (id) ON DELETE CASCADE,
         business_id TEXT NOT NULL,
         pseudo_id   INTEGER NOT NULL,
         created_at  TEXT NOT NULL,
         last_seen   TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS web_session_channel_idx ON web_session (channel_id, last_seen DESC)`,

      // A web channel needs a row in `bot` because a conversation references
      // one, but it is not a Telegram bot and must never appear where those
      // are listed or be reachable on a webhook path. Naming it here keeps the
      // bot table's shape untouched, which matters because its role column has
      // a CHECK constraint that a migration cannot widen safely.
      `CREATE TABLE IF NOT EXISTS hidden_bot (
         bot_id TEXT PRIMARY KEY,
         kind   TEXT NOT NULL
       )`,
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
