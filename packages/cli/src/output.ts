/**
 * Output handling.
 *
 * Every command writes through this module so that `--json` produces one
 * machine readable object on stdout and nothing else. Human readable progress
 * goes to stderr, which keeps a piped `muxel ... --json` clean even while the
 * command is reporting what it is doing.
 */

export type OutputMode = "human" | "json";

let mode: OutputMode = "human";

export function setOutputMode(next: OutputMode): void {
  mode = next;
}

export function outputMode(): OutputMode {
  return mode;
}

/** Writes progress for a human. Suppressed entirely in json mode. */
export function progress(message: string): void {
  if (mode === "human") {
    process.stderr.write(`${message}\n`);
  }
}

/** Writes a warning. Always shown, always on stderr. */
export function warn(message: string): void {
  process.stderr.write(`warning: ${message}\n`);
}

/**
 * Emits the result of a command.
 *
 * @param data Machine readable payload, printed as JSON in json mode.
 * @param render Human rendering, used only in human mode.
 */
export function emit(data: unknown, render: () => string): void {
  if (mode === "json") {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${render()}\n`);
}

/** Emits a failure payload in the same shape as a success payload. */
export function emitError(code: string, message: string, details?: Record<string, unknown>): void {
  if (mode === "json") {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: { code, message, ...(details ?? {}) } }, null, 2)}\n`,
    );
    return;
  }
  process.stderr.write(`error: ${message}\n`);
}

/** Renders a two column table for human output. */
export function table(rows: readonly (readonly [string, string])[]): string {
  const width = rows.reduce((max, [label]) => Math.max(max, label.length), 0);
  return rows.map(([label, value]) => `  ${label.padEnd(width)}  ${value}`).join("\n");
}
