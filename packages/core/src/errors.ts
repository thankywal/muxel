/**
 * Error taxonomy shared by the runtime and the CLI.
 *
 * Every failure carries a stable machine readable `code`. The CLI maps codes to
 * process exit statuses so that automated callers can branch on the reason a
 * command failed instead of parsing human text.
 */

export type MuxelErrorCode =
  | "invalid_input"
  | "not_found"
  | "unauthorized"
  | "conflict"
  | "quota_exceeded"
  | "upstream_failure"
  | "not_configured"
  | "internal";

export class MuxelError extends Error {
  readonly code: MuxelErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: MuxelErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "MuxelError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }

  toJSON(): { code: MuxelErrorCode; message: string; details: Record<string, unknown> } {
    return { code: this.code, message: this.message, details: { ...this.details } };
  }
}

export function isMuxelError(value: unknown): value is MuxelError {
  return value instanceof MuxelError;
}

export function invalidInput(message: string, details?: Record<string, unknown>): MuxelError {
  return new MuxelError("invalid_input", message, details);
}

export function notFound(message: string, details?: Record<string, unknown>): MuxelError {
  return new MuxelError("not_found", message, details);
}

export function unauthorized(message: string, details?: Record<string, unknown>): MuxelError {
  return new MuxelError("unauthorized", message, details);
}
