/**
 * Process exit statuses.
 *
 * Codes are stable across releases so that a script or an agent can branch on
 * the reason a command failed without reading the message text.
 */

import type { MuxelErrorCode } from "@muxel/core";

export const EXIT = {
  /** The command completed. */
  ok: 0,
  /** An unclassified failure. */
  failure: 1,
  /** The arguments were wrong. Retrying without a change will not help. */
  usage: 2,
  /** A prerequisite is missing, for example wrangler or a Cloudflare login. */
  notConfigured: 3,
  /** Credentials were rejected. */
  unauthorized: 4,
  /** A dependency of the command failed, for example the Cloudflare API. */
  upstream: 5,
  /** The requested object does not exist. */
  notFound: 6,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

const BY_ERROR_CODE: Readonly<Record<MuxelErrorCode, ExitCode>> = {
  invalid_input: EXIT.usage,
  not_found: EXIT.notFound,
  unauthorized: EXIT.unauthorized,
  conflict: EXIT.failure,
  quota_exceeded: EXIT.upstream,
  upstream_failure: EXIT.upstream,
  not_configured: EXIT.notConfigured,
  internal: EXIT.failure,
};

export function exitCodeFor(code: MuxelErrorCode): ExitCode {
  return BY_ERROR_CODE[code];
}
