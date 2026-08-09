/**
 * Ownership bootstrap.
 *
 * A Telegram account number typed into a form proves nothing. Instead the CLI
 * writes a single use code into the deployment and the first person to present
 * it through the console bot becomes the owner, which requires actually
 * controlling that Telegram account.
 */

import { generateId } from "@muxel/core";

import { emit } from "../output.js";
import { requireWrangler } from "../wrangler.js";

const CLAIM_KEY = "bootstrap:claim";
const CLAIM_TTL_SECONDS = 900;

export interface ClaimResult {
  readonly ok: true;
  readonly code: string;
  readonly expiresInSeconds: number;
}

export async function runClaim(options: { cwd: string; binding: string }): Promise<ClaimResult> {
  const code = generateId(8);

  await requireWrangler(
    [
      "kv",
      "key",
      "put",
      CLAIM_KEY,
      code,
      "--binding",
      options.binding,
      "--ttl",
      String(CLAIM_TTL_SECONDS),
      "--remote",
    ],
    { cwd: options.cwd },
  );

  const result: ClaimResult = { ok: true, code, expiresInSeconds: CLAIM_TTL_SECONDS };

  emit(result, () =>
    [
      "Claim code issued.",
      "",
      `  Send this to your console bot:  /claim ${code}`,
      "",
      `The code expires in ${CLAIM_TTL_SECONDS / 60} minutes and works once.`,
    ].join("\n"),
  );

  return result;
}
