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

  // Every one of these is optional. A deployment is asked for nothing at all:
  // it issues itself a console key on first run, and Telegram is a second door
  // for owners who want one.
  /**
   * Overrides the console key this deployment issued to itself.
   *
   * Set only when an owner wants to choose their own key, or has to replace one
   * that leaked. It wins over the issued key, and setting it ends every session
   * the old one opened. See console-key.ts for where a key comes from when this
   * is absent, which is the ordinary case.
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
}

// Re-exported rather than declared: the command line has to refuse the same
// key this deployment would, and it cannot import the runtime. See
// @muxel/core console-key.ts for why the length is the whole of the rule.
export { CONSOLE_KEY_MIN_LENGTH } from "@muxel/core";
import { CONSOLE_KEY_MIN_LENGTH } from "@muxel/core";

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
 * Returns the console key set as a secret, and null when none is set.
 *
 * A key too short to be a lock is not one: the callers that ask this question
 * are asking whether somebody can be let in, and the answer there is no. Setup
 * asks the narrower question itself, so that it can say which mistake was made.
 *
 * This is the configured key only. Most deployments have none and are signed
 * into with the key they issued themselves, so nearly every caller wants
 * peekConsoleKey from console-key.ts instead.
 */
export function consoleKey(env: Env): string | null {
  const raw = env.CONSOLE_KEY?.trim() ?? "";
  return raw.length >= CONSOLE_KEY_MIN_LENGTH ? raw : null;
}

/** Reports whether this deployment has a Telegram console to connect. */
export function hasTelegramConsole(env: Env): boolean {
  return isSet(env.ADMIN_BOT_TOKEN) && isSet(env.OWNER_TELEGRAM_ID);
}

/**
 * Returns the names of any settings that setup cannot proceed without.
 *
 * Almost always empty, and that is the design: a deployment issues itself a
 * console key on first run, so there is no setting anybody has to supply for it
 * to work. The one thing still worth naming is a Telegram door somebody started
 * and did not finish, because half of that pair registers a webhook for a bot
 * the deployment cannot name an owner for.
 *
 * The health endpoint reports this list so a misconfigured deployment is
 * diagnosable without reading Worker logs. Only names are reported, never
 * values.
 */
export function missingConfiguration(env: Env): string[] {
  // Somebody with one of the two Telegram values has been to BotFather and is
  // halfway through that door. They are told which half is still missing.
  if (isSet(env.ADMIN_BOT_TOKEN) !== isSet(env.OWNER_TELEGRAM_ID)) {
    return [isSet(env.ADMIN_BOT_TOKEN) ? "OWNER_TELEGRAM_ID" : "ADMIN_BOT_TOKEN"];
  }
  return [];
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
