/**
 * Prerequisite check.
 *
 * Runs before anything is provisioned so that a missing login is reported as a
 * clear instruction rather than as a wrangler stack trace half way through
 * creating resources.
 */

import { emit, table } from "../output.js";
import { identity, version } from "../wrangler.js";

export interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly remedy: string | null;
}

const MIN_NODE_MAJOR = 20;

export async function runDoctor(): Promise<{ ok: boolean; checks: Check[] }> {
  const checks: Check[] = [];

  const nodeMajor = Number(process.versions.node.split(".")[0] ?? "0");
  checks.push({
    name: "node",
    ok: nodeMajor >= MIN_NODE_MAJOR,
    detail: `v${process.versions.node}`,
    remedy: nodeMajor >= MIN_NODE_MAJOR ? null : `install Node ${MIN_NODE_MAJOR} or newer`,
  });

  const wranglerVersion = await version();
  checks.push({
    name: "wrangler",
    ok: wranglerVersion !== null,
    detail: wranglerVersion ?? "not found",
    remedy: wranglerVersion === null ? "install wrangler with npm i -g wrangler" : null,
  });

  if (wranglerVersion !== null) {
    const who = await identity();
    checks.push({
      name: "cloudflare login",
      ok: who.authenticated,
      detail: who.authenticated ? (who.account ?? "authenticated") : "not authenticated",
      remedy: who.authenticated ? null : "run wrangler login",
    });
    checks.push({
      name: "account id",
      ok: who.accountId !== null,
      detail: who.accountId ?? "unknown",
      remedy: who.accountId === null ? "pass --account-id explicitly" : null,
    });
  }

  const ok = checks.every((check) => check.ok);

  emit({ ok, checks }, () => {
    const rows = checks.map(
      (check) => [check.name, `${check.ok ? "ok" : "failed"}  ${check.detail}`] as const,
    );
    const remedies = checks
      .filter((check) => check.remedy !== null)
      .map((check) => `  fix ${check.name}: ${check.remedy}`);
    return [table(rows), ...(remedies.length > 0 ? ["", ...remedies] : [])].join("\n");
  });

  return { ok, checks };
}
