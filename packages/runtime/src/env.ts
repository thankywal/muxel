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

  // Required at setup.
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

/** Settings that must be present before setup can complete. */
const REQUIRED_FOR_SETUP = ["ADMIN_BOT_TOKEN", "OWNER_TELEGRAM_ID"] as const;

/**
 * Returns the names of any settings that setup cannot proceed without.
 *
 * The health endpoint reports this list so a misconfigured deployment is
 * diagnosable without reading Worker logs. Only names are reported, never
 * values.
 */
export function missingConfiguration(env: Env): string[] {
  return REQUIRED_FOR_SETUP.filter((key) => {
    const value = env[key];
    return typeof value !== "string" || value.length === 0;
  });
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
