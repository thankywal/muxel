/**
 * Wrangler process wrapper.
 *
 * Provisioning goes through the official CLI rather than the REST API. Wrangler
 * already handles authentication, account selection and the resource shapes, so
 * reimplementing that surface would add a second thing to keep current with the
 * platform.
 */

import { spawn } from "node:child_process";

import { MuxelError } from "@muxel/core";

export interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunOptions {
  readonly cwd?: string;
  /** Stream child output to this process instead of capturing it. */
  readonly inherit?: boolean;
  /**
   * Written to the child stdin and then closed.
   *
   * Secrets are passed this way rather than as arguments so that the value
   * never appears in the process list of a shared machine.
   */
  readonly stdin?: string;
}

/** Runs wrangler and resolves with its output regardless of exit status. */
export function runWrangler(
  args: readonly string[],
  options: RunOptions = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["--yes", "wrangler", ...args], {
      cwd: options.cwd ?? process.cwd(),
      stdio: options.inherit
        ? "inherit"
        : [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    });

    if (options.stdin !== undefined && child.stdin !== null) {
      child.stdin.end(options.stdin);
    }

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(
        new MuxelError("not_configured", "could not start wrangler", {
          reason: error.message,
        }),
      );
    });

    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/** Runs wrangler and throws when it exits non zero. */
export async function requireWrangler(
  args: readonly string[],
  options: RunOptions = {},
): Promise<RunResult> {
  const result = await runWrangler(args, options);
  if (result.code !== 0) {
    throw new MuxelError("upstream_failure", `wrangler ${args[0] ?? ""} failed`, {
      code: result.code,
      stderr: result.stderr.trim().slice(0, 800),
    });
  }
  return result;
}

export interface WranglerIdentity {
  readonly authenticated: boolean;
  readonly account: string | null;
  readonly accountId: string | null;
}

/** Reports whether wrangler is installed and logged in. */
export async function identity(): Promise<WranglerIdentity> {
  const result = await runWrangler(["whoami"]);
  const combined = `${result.stdout}\n${result.stderr}`;
  if (result.code !== 0 || /not authenticated/i.test(combined)) {
    return { authenticated: false, account: null, accountId: null };
  }
  // The table wrangler prints uses box drawing characters around the columns.
  const match = combined.match(/│\s*([^│]+?)\s*│\s*([0-9a-f]{32})\s*│/);
  return {
    authenticated: true,
    account: match?.[1]?.trim() ?? null,
    accountId: match?.[2] ?? null,
  };
}

export async function version(): Promise<string | null> {
  const result = await runWrangler(["--version"]);
  if (result.code !== 0) {
    return null;
  }
  const match = `${result.stdout}${result.stderr}`.match(/(\d+\.\d+\.\d+)/);
  return match?.[1] ?? null;
}
