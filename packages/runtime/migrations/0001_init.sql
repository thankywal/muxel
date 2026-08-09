-- Muxel initial schema.
--
-- Every table that holds business content carries a business_id and is indexed
-- on it. Retrieval, listing and deletion all filter on that column so that one
-- business can never observe another inside the same deployment.

PRAGMA foreign_keys = ON;

CREATE TABLE operator (
  telegram_user_id INTEGER PRIMARY KEY,
  label            TEXT,
  role             TEXT NOT NULL CHECK (role IN ('owner', 'admin')),
  created_at       TEXT NOT NULL
);

CREATE TABLE business (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  locale        TEXT NOT NULL DEFAULT 'en',
  system_prompt TEXT NOT NULL DEFAULT '',
  model         TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- Grants a non owner operator access to a single business. Owners bypass this
-- table and reach every business in the deployment.
CREATE TABLE business_operator (
  business_id      TEXT NOT NULL REFERENCES business (id) ON DELETE CASCADE,
  telegram_user_id INTEGER NOT NULL REFERENCES operator (telegram_user_id) ON DELETE CASCADE,
  created_at       TEXT NOT NULL,
  PRIMARY KEY (business_id, telegram_user_id)
);

CREATE TABLE bot (
  id                  TEXT PRIMARY KEY,
  business_id         TEXT NOT NULL REFERENCES business (id) ON DELETE CASCADE,
  role                TEXT NOT NULL CHECK (role IN ('admin', 'reply')),
  username            TEXT NOT NULL,
  webhook_path        TEXT NOT NULL UNIQUE,
  -- Bot token sealed with the deployment master key. Plaintext never lands in
  -- the database, the logs or the Telegram transcript.
  token_ciphertext    TEXT NOT NULL,
  -- SHA-256 of the value handed to Telegram as setWebhook secret_token.
  webhook_secret_hash TEXT NOT NULL,
  enabled             INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL
);

CREATE INDEX bot_business_idx ON bot (business_id);

CREATE TABLE document (
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
);

CREATE INDEX document_business_idx ON document (business_id, created_at DESC);

-- Chunk text is kept in D1 so that a retrieval hit can be rendered without a
-- second round trip to R2. Vectorize stores only the embedding and the ids.
CREATE TABLE chunk (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES business (id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES document (id) ON DELETE CASCADE,
  ordinal     INTEGER NOT NULL,
  text        TEXT NOT NULL
);

CREATE INDEX chunk_document_idx ON chunk (document_id, ordinal);
CREATE INDEX chunk_business_idx ON chunk (business_id);

CREATE TABLE conversation (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES business (id) ON DELETE CASCADE,
  bot_id       TEXT NOT NULL REFERENCES bot (id) ON DELETE CASCADE,
  chat_id      INTEGER NOT NULL,
  escalated    INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (bot_id, chat_id)
);

CREATE INDEX conversation_business_idx ON conversation (business_id, updated_at DESC);

CREATE TABLE message (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversation (id) ON DELETE CASCADE,
  business_id     TEXT NOT NULL REFERENCES business (id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE INDEX message_conversation_idx ON message (conversation_id, created_at DESC);

-- One row per business per UTC day. Written on the reply path and read by the
-- admin console, so that usage reporting never calls a billing API.
CREATE TABLE usage_daily (
  business_id   TEXT NOT NULL REFERENCES business (id) ON DELETE CASCADE,
  day           TEXT NOT NULL,
  messages      INTEGER NOT NULL DEFAULT 0,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (business_id, day)
);
