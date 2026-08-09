/**
 * Bindings and configuration available to the Worker.
 *
 * Values under `vars` are plain configuration and appear in wrangler.jsonc.
 * Everything listed under secrets is set with `wrangler secret put` and is
 * never written to the database, a log line or a Telegram message.
 */
export interface Env {
  // Storage and compute bindings, all provisioned inside the operator account.
  readonly DB: D1Database;
  readonly DOCUMENTS: R2Bucket;
  readonly STATE: KVNamespace;
  readonly KNOWLEDGE: VectorizeIndex;
  readonly AI: Ai;

  // Configuration.
  readonly MUXEL_ENV: string;
  readonly EMBEDDING_MODEL: string;
  readonly DEFAULT_MODEL: string;
  readonly AI_GATEWAY_ID: string;

  // Secrets.
  /** Base64 encoded 32 byte key that seals bot tokens at rest. */
  readonly MASTER_KEY: string;
  /** Cloudflare account identifier, used to build the gateway URL. */
  readonly CF_ACCOUNT_ID: string;
  /** Token presented to the AI Gateway compatibility endpoint. */
  readonly AI_GATEWAY_TOKEN: string;
}

/** Configuration keys that must be present before the Worker can serve traffic. */
const REQUIRED_KEYS = [
  "MASTER_KEY",
  "CF_ACCOUNT_ID",
  "AI_GATEWAY_TOKEN",
  "EMBEDDING_MODEL",
  "DEFAULT_MODEL",
  "AI_GATEWAY_ID",
] as const satisfies readonly (keyof Env)[];

/**
 * Returns the names of any required settings that are missing.
 *
 * The health endpoint reports this list so that a misconfigured deployment is
 * diagnosable without reading Worker logs.
 */
export function missingConfiguration(env: Env): string[] {
  return REQUIRED_KEYS.filter((key) => {
    const value = env[key];
    return typeof value !== "string" || value.length === 0;
  });
}
