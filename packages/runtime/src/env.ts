/**
 * Bindings and configuration available to the Worker.
 *
 * The required set is deliberately small. A one click deploy asks the owner for
 * two values and nothing else, because the default model runs on the Workers AI
 * binding, which needs no account identifier and no API token. Credentials only
 * become necessary when a business selects a model from another provider.
 */
export interface Env {
  // Storage and compute bindings, all provisioned inside the operator account.
  readonly DB: D1Database;
  readonly STATE: KVNamespace;
  readonly KNOWLEDGE: Vectorize;
  readonly AI: Ai;

  // Configuration with defaults in wrangler.jsonc.
  readonly MUXEL_ENV: string;
  readonly EMBEDDING_MODEL: string;
  readonly DEFAULT_MODEL: string;
  readonly AI_GATEWAY_ID: string;
  /** Default reply language for a new business, as a language tag such as "my". */
  readonly BUSINESS_LOCALE?: string;

  // Required at setup, but as two doors: either of these on its own is enough.
  /**
   * The string that signs the owner into the web console.
   *
   * Setup used to refuse to finish without a Telegram bot, because the console
   * bot was the only thing that could say who was asking. Somebody with no
   * Telegram account could not use their own deployment at all, which is the
   * first wall a new owner walks into. This is the other door, and it is one
   * box: a string they make up, typed into the console once.
   */
  readonly CONSOLE_KEY?: string;
  /** Token of the Telegram bot that serves the operator console. */
  readonly ADMIN_BOT_TOKEN?: string;
  /** Telegram account permitted to claim ownership of this deployment. */
  readonly OWNER_TELEGRAM_ID?: string;

  // Optional. Needed only for models outside the Workers AI catalogue.
  readonly CF_ACCOUNT_ID?: string;
  readonly AI_GATEWAY_TOKEN?: string;

  /**
   * Read only token used to report account usage in the console.
   *
   * Muxel records what it spends itself, but only Cloudflare knows the account
   * total, and an operator who wants to see how much of the free allowance is
   * left needs the real figure rather than an estimate. Needs Account
   * Analytics: Read and nothing more. Absent means the console shows Muxel's
   * own measurements and says how to enable the rest.
   */
  readonly CF_API_TOKEN?: string;

  /**
   * Key sealing bot tokens at rest.
   *
   * Set by the command line tool during provisioning. When absent the Worker
   * generates one on first use and keeps it in KV.
   */
  readonly MASTER_KEY?: string;

  /**
   * Optional archive of uploaded files.
   *
   * Nothing reads it back. It exists only so that a future change to the
   * segmentation strategy could be replayed without asking the owner to upload
   * everything again, which is not worth putting a billing prompt in front of
   * someone setting up their first shop. Add an R2 binding named DOCUMENTS to
   * turn it on.
   */
  readonly DOCUMENTS?: R2Bucket;
}

/**
 * The shortest console key this deployment will treat as a lock.
 *
 * A Worker's address is public, so the key is the only thing between a
 * stranger and the console, and its length is the whole of that defence.
 */
export const CONSOLE_KEY_MIN_LENGTH = 16;

/**
 * The operator id of an owner who arrived through the console, not Telegram.
 *
 * Operators are keyed by Telegram account id because that is the number
 * Telegram vouches for. Somebody holding the console key has no such number,
 * and everything downstream — the access check, the message log, the console
 * language — takes a numeric id, so one is reserved for them rather than
 * teaching each of those about a second kind of person. Zero is safe: it is a
 * legal INTEGER PRIMARY KEY, Telegram issues no account with it, and
 * ownerTelegramId below refuses zero as a configured owner, so this row can
 * never turn out to be somebody's real account.
 */
export const WEB_OWNER_ID = 0;

const isSet = (value: string | undefined): boolean =>
  typeof value === "string" && value.trim().length > 0;

/**
 * Returns the console key when this deployment has one, and null when it does
 * not. A key too short to be a lock is not one: the callers that ask this
 * question are asking whether somebody can be let in, and the answer there is
 * no. Setup asks the narrower question itself, so that it can say which of the
 * two mistakes was made.
 */
export function consoleKey(env: Env): string | null {
  const raw = env.CONSOLE_KEY?.trim() ?? "";
  return raw.length >= CONSOLE_KEY_MIN_LENGTH ? raw : null;
}

/** Reports whether this deployment can be signed into with a console key. */
export function hasConsoleKey(env: Env): boolean {
  return consoleKey(env) !== null;
}

/** Reports whether this deployment has a Telegram console to connect. */
export function hasTelegramConsole(env: Env): boolean {
  return isSet(env.ADMIN_BOT_TOKEN) && isSet(env.OWNER_TELEGRAM_ID);
}

/**
 * Returns the names of any settings that setup cannot proceed without.
 *
 * There are two ways in and either one is enough, so this is not a list of
 * required names any more: it is the shortest honest answer to "what do I
 * still have to do", and it is empty as soon as one door is complete.
 *
 * The health endpoint reports this list so a misconfigured deployment is
 * diagnosable without reading Worker logs. Only names are reported, never
 * values.
 */
export function missingConfiguration(env: Env): string[] {
  if (hasConsoleKey(env) || hasTelegramConsole(env)) {
    return [];
  }
  // Somebody with one of the two Telegram values has been to BotFather and is
  // halfway through that door. Answering them with the name of a different
  // door would read as though the work they had already done was wrong, so
  // they are told which half is still missing.
  if (isSet(env.ADMIN_BOT_TOKEN) !== isSet(env.OWNER_TELEGRAM_ID)) {
    return [isSet(env.ADMIN_BOT_TOKEN) ? "OWNER_TELEGRAM_ID" : "ADMIN_BOT_TOKEN"];
  }
  // Nobody has started either door, so the one named is the one that is a
  // single box and needs no second account, no other app and no bot.
  return ["CONSOLE_KEY"];
}

/** Parses the configured owner, returning null when it is absent or malformed. */
export function ownerTelegramId(env: Env): number | null {
  const raw = env.OWNER_TELEGRAM_ID?.trim();
  if (raw === undefined || raw.length === 0) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
