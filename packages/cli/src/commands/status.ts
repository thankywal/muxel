/**
 * Deployment readiness check.
 *
 * Reads the health endpoint of a running deployment. The endpoint reports which
 * settings are missing but never their values, so the output is safe to paste
 * into an issue.
 */

import { MuxelError } from "@muxel/core";

import { emit, table } from "../output.js";

export interface StatusReport {
  readonly ok: boolean;
  readonly url: string;
  readonly status: string;
  readonly missing: readonly string[];
  readonly latencyMs: number;
}

interface HealthBody {
  readonly service?: string;
  readonly status?: string;
  readonly missing?: string[];
}

export async function runStatus(baseUrl: string): Promise<StatusReport> {
  let url: URL;
  try {
    url = new URL("/health", baseUrl);
  } catch {
    throw new MuxelError("invalid_input", "url is not valid", { url: baseUrl });
  }

  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new MuxelError("upstream_failure", "deployment did not respond", {
      url: url.toString(),
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  const latencyMs = Date.now() - started;

  let body: HealthBody = {};
  try {
    body = (await response.json()) as HealthBody;
  } catch {
    throw new MuxelError("upstream_failure", "health endpoint did not return json", {
      url: url.toString(),
      status: response.status,
    });
  }

  const report: StatusReport = {
    ok: response.status === 200 && body.status === "ready",
    url: url.toString(),
    status: body.status ?? `http ${response.status}`,
    missing: body.missing ?? [],
    latencyMs,
  };

  emit(report, () =>
    table([
      ["url", report.url],
      ["status", report.status],
      ["latency", `${report.latencyMs} ms`],
      ["missing", report.missing.length === 0 ? "none" : report.missing.join(", ")],
    ]),
  );

  return report;
}
