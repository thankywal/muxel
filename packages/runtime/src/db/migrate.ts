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
  {
    version: 10,
    statements: [
      // Where a stored turn is also sitting on someone's phone.
      //
      // The transcript row and the Telegram copy were two facts with one
      // record between them, so the console could rewrite its own history and
      // the customer would still be reading the original. This is the missing
      // half: with a row here a message can be edited or withdrawn on both
      // sides, and without one the console can only change its own copy, which
      // is exactly what "delete for me" means. No consumer decides that for
      // itself; every one of them reads this.
      `CREATE TABLE IF NOT EXISTS message_wire (
         message_id      TEXT PRIMARY KEY REFERENCES message (id) ON DELETE CASCADE,
         bot_id          TEXT NOT NULL,
         chat_id         INTEGER NOT NULL,
         wire_message_id INTEGER NOT NULL
       )`,
    ],
  },
  {
    version: 11,
    statements: [
      // What the business is and where to find it.
      //
      // These were going into the instructions as prose, which works once and
      // then cannot be edited: an address buried in a paragraph is not a field.
      // They are columns so the console can show them as the form they are, and
      // the assistant reads a rendering of them, the same way it reads the
      // owner's price corrections. One record, and the prompt is a view of it.
      `CREATE TABLE IF NOT EXISTS business_profile (
         business_id TEXT PRIMARY KEY REFERENCES business (id) ON DELETE CASCADE,
         kind        TEXT NOT NULL DEFAULT '',
         about       TEXT NOT NULL DEFAULT '',
         address     TEXT NOT NULL DEFAULT '',
         map_url     TEXT NOT NULL DEFAULT '',
         phone       TEXT NOT NULL DEFAULT '',
         email       TEXT NOT NULL DEFAULT '',
         website     TEXT NOT NULL DEFAULT '',
         facebook    TEXT NOT NULL DEFAULT '',
         hours       TEXT NOT NULL DEFAULT '',
         updated_at  TEXT NOT NULL
       )`,
    ],
  },
  {
    version: 12,
    statements: [
      // Standing instructions, one to a row.
      //
      // These were a paragraph inside the persona, which is fine until there
      // are nine of them and one is wrong: you cannot switch off a sentence, or
      // say which of two contradicting ones wins. A row can be turned off,
      // reordered and edited on its own, and the assistant reads a rendering of
      // the active ones, the same way it reads the profile and the price
      // corrections.
      `CREATE TABLE IF NOT EXISTS business_rule (
         id          TEXT PRIMARY KEY,
         business_id TEXT NOT NULL REFERENCES business (id) ON DELETE CASCADE,
         kind        TEXT NOT NULL,
         content     TEXT NOT NULL,
         active      INTEGER NOT NULL DEFAULT 1,
         priority    INTEGER NOT NULL DEFAULT 100,
         created_at  TEXT NOT NULL,
         updated_at  TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS business_rule_idx ON business_rule (business_id, active, priority)`,

      // How this agent behaves, as opposed to what its business is.
      //
      // Its own table rather than a column on business, because this file
      // already says why: a migration that is a CREATE is safe to run twice and
      // an ALTER is not, and a batch that fails halfway leaves the version
      // unrecorded and the whole batch to run again. A missing row means the
      // defaults, so nothing has to be backfilled.
      //
      // Remembering is on by default, because that is what every existing
      // deployment has been doing. Turning it off has to actually stop it
      // rather than only hide it, so the reply path reads this before it
      // recalls or records anything.
      `CREATE TABLE IF NOT EXISTS agent_setting (
         business_id        TEXT PRIMARY KEY REFERENCES business (id) ON DELETE CASCADE,
         remember_customers INTEGER NOT NULL DEFAULT 1,
         updated_at         TEXT NOT NULL
       )`,
    ],
  },
  {
    version: 13,
    statements: [
      // Anything the owner knows that is not a document and not a price.
      //
      // Until now there was nowhere for it. Delivery areas, which day the
      // supplier comes, what to say about the car park: facts a shop has in its
      // head and no file. They went into the instructions or nowhere, and
      // instructions are read every turn whether or not they are relevant,
      // which is the wrong place for a hundred small facts.
      //
      // Rows, so one can be edited or removed on its own, rendered into a
      // single document and indexed through the same door as an upload. The
      // assistant does not know these came from a form rather than a file, and
      // does not need to.
      `CREATE TABLE IF NOT EXISTS business_note (
         id          TEXT PRIMARY KEY,
         business_id TEXT NOT NULL REFERENCES business (id) ON DELETE CASCADE,
         title       TEXT NOT NULL DEFAULT '',
         body        TEXT NOT NULL,
         created_at  TEXT NOT NULL,
         updated_at  TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS business_note_idx ON business_note (business_id, updated_at DESC)`,
    ],
  },
  {
    version: 14,
    statements: [
      // The owner's own conversation with their deployment.
      //
      // Kept apart from `message`, which is a customer talking to a business.
      // This is the owner talking to the thing that runs the businesses, and
      // folding the two together would put an owner's instructions into a
      // transcript the assistant reads back to customers.
      `CREATE TABLE IF NOT EXISTS operator_message (
         id         TEXT PRIMARY KEY,
         user_id    INTEGER NOT NULL,
         role       TEXT NOT NULL,
         content    TEXT NOT NULL,
         created_at TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS operator_message_idx ON operator_message (user_id, created_at)`,

      // A change the assistant wants to make, waiting for a yes.
      //
      // The model never runs a write. It describes one, it lands here, and the
      // owner's answer runs it. So the record of what was asked exists before
      // anything happens, and an approval that is never given leaves a row
      // saying what was declined rather than nothing at all.
      `CREATE TABLE IF NOT EXISTS operator_approval (
         id          TEXT PRIMARY KEY,
         user_id     INTEGER NOT NULL,
         message_id  TEXT NOT NULL,
         tool        TEXT NOT NULL,
         args        TEXT NOT NULL,
         summary     TEXT NOT NULL,
         state       TEXT NOT NULL DEFAULT 'waiting',
         result      TEXT NOT NULL DEFAULT '',
         created_at  TEXT NOT NULL,
         decided_at  TEXT
       )`,
      `CREATE INDEX IF NOT EXISTS operator_approval_idx ON operator_approval (user_id, state, created_at)`,
    ],
  },
  {
    version: 15,
    statements: [
      // The owner keeps more than one conversation with their assistant.
      //
      // One flat transcript meant every question shared a thread with every
      // other, so asking about a refund policy carried yesterday's argument
      // about delivery into it. A chat is a subject, and its title is the first
      // thing the owner said in it.
      `CREATE TABLE IF NOT EXISTS operator_chat (
         id         TEXT PRIMARY KEY,
         user_id    INTEGER NOT NULL,
         title      TEXT NOT NULL DEFAULT '',
         model      TEXT NOT NULL DEFAULT '',
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS operator_chat_idx ON operator_chat (user_id, updated_at DESC)`,

      // Messages belong to a chat now. The old table is dropped rather than
      // left beside the new one: it is a day old, it holds nothing but the
      // owner's own first few questions, and a second table nobody reads is a
      // place for the two to disagree later. DROP IF EXISTS is safe to run
      // twice, which is the rule this file keeps.
      `DROP TABLE IF EXISTS operator_message`,
      `CREATE TABLE IF NOT EXISTS operator_message (
         id         TEXT PRIMARY KEY,
         chat_id    TEXT NOT NULL REFERENCES operator_chat (id) ON DELETE CASCADE,
         user_id    INTEGER NOT NULL,
         role       TEXT NOT NULL,
         content    TEXT NOT NULL,
         created_at TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS operator_message_idx ON operator_message (chat_id, created_at)`,
    ],
  },
  {
    // What the assistant looked at on the way to an answer.
    //
    // The loop already knew this and threw it away when the request ended, so
    // reloading a conversation lost the working and left only the conclusion.
    // Its own table rather than a column, because the rule this file keeps is
    // that a migration stays a CREATE.
    version: 16,
    statements: [
      `CREATE TABLE IF NOT EXISTS operator_step (
         id         TEXT PRIMARY KEY,
         message_id TEXT NOT NULL REFERENCES operator_message (id) ON DELETE CASCADE,
         seq        INTEGER NOT NULL,
         tool       TEXT NOT NULL,
         ok         INTEGER NOT NULL,
         created_at TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS operator_step_idx ON operator_step (message_id, seq)`,
    ],
  },
  {
    // What each model was asked for today, and what each answer cost.
    //
    // Cloudflare reports neurons per model per day for the whole account, and
    // never per request. Tokens are the other half: knowing both for the same
    // model on the same day gives a rate this deployment actually paid, which
    // is how a single answer's share of the daily allowance is worked out
    // without hardcoding a published price that goes stale.
    version: 17,
    statements: [
      `CREATE TABLE IF NOT EXISTS model_usage_daily (
         model         TEXT NOT NULL,
         day           TEXT NOT NULL,
         calls         INTEGER NOT NULL DEFAULT 0,
         input_tokens  INTEGER NOT NULL DEFAULT 0,
         output_tokens INTEGER NOT NULL DEFAULT 0,
         PRIMARY KEY (model, day)
       )`,
      // One answer's own tokens, against the message it produced.
      `CREATE TABLE IF NOT EXISTS operator_usage (
         message_id    TEXT PRIMARY KEY REFERENCES operator_message (id) ON DELETE CASCADE,
         model         TEXT NOT NULL,
         input_tokens  INTEGER NOT NULL DEFAULT 0,
         output_tokens INTEGER NOT NULL DEFAULT 0,
         created_at    TEXT NOT NULL
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

export async function currentVersion(env: Env): Promise<number> {
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
