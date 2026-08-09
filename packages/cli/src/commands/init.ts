/**
 * First run setup.
 *
 * Creates every resource inside the operator Cloudflare account, writes the
 * identifiers into the Worker configuration, applies the schema, uploads the
 * secrets and deploys. Nothing about the deployment is recorded anywhere else.
 */

import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { MuxelError } from "@muxel/core";

import { emit, progress, table } from "../output.js";
import { identity, requireWrangler, runWrangler } from "../wrangler.js";
import { runDoctor } from "./doctor.js";
import { provision, type ResourceIds } from "./provision.js";

export interface InitOptions {
  /** Directory holding wrangler.jsonc and the migrations. */
  readonly cwd: string;
  /** Name prefix applied to every created resource. */
  readonly prefix: string;
  /** Token presented to the AI Gateway compatibility endpoint. */
  readonly gatewayToken: string;
  /** Cloudflare account id. Read from wrangler when omitted. */
  readonly accountId?: string;
  /** Skip the deploy step, leaving the configuration in place. */
  readonly skipDeploy?: boolean;
}

export interface InitResult {
  readonly ok: true;
  readonly accountId: string;
  readonly resources: ResourceIds;
  readonly workerUrl: string | null;
}

/** Generates the base64 master key that seals bot tokens at rest. */
function generateMasterKey(): string {
  return randomBytes(32).toString("base64");
}

/**
 * Rewrites the resource identifiers in wrangler.jsonc.
 *
 * The file is edited as text rather than parsed and reserialised so that the
 * comments explaining each binding survive the round trip.
 */
async function writeConfiguration(cwd: string, ids: ResourceIds): Promise<void> {
  const path = join(cwd, "wrangler.jsonc");
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch {
    throw new MuxelError("not_found", "wrangler.jsonc was not found", { path });
  }

  const updated = source
    .replace(/("database_id"\s*:\s*")[^"]*(")/, `$1${ids.d1DatabaseId}$2`)
    .replace(/("binding"\s*:\s*"STATE",\s*\n\s*"id"\s*:\s*")[^"]*(")/, `$1${ids.kvNamespaceId}$2`)
    .replace(/("bucket_name"\s*:\s*")[^"]*(")/, `$1${ids.r2Bucket}$2`)
    .replace(/("index_name"\s*:\s*")[^"]*(")/, `$1${ids.vectorizeIndex}$2`);

  if (updated === source) {
    throw new MuxelError("internal", "wrangler.jsonc did not match the expected shape", { path });
  }
  await writeFile(path, updated, "utf8");
}

async function putSecret(cwd: string, name: string, value: string): Promise<void> {
  progress(`  secret ${name}`);
  // The value goes over stdin so it never appears in the process list.
  const result = await runWrangler(["secret", "put", name], { cwd, stdin: value });
  if (result.code !== 0) {
    throw new MuxelError("upstream_failure", `could not set the secret ${name}`, {
      name,
      stderr: result.stderr.trim().slice(0, 400),
    });
  }
}

export async function runInit(options: InitOptions): Promise<InitResult> {
  const health = await runDoctor();
  if (!health.ok) {
    throw new MuxelError("not_configured", "prerequisites are not satisfied", {
      failed: health.checks.filter((check) => !check.ok).map((check) => check.name),
    });
  }

  const accountId = options.accountId ?? (await identity()).accountId;
  if (accountId === null) {
    throw new MuxelError("not_configured", "could not determine the Cloudflare account id", {
      remedy: "pass --account-id",
    });
  }

  const resources = await provision({ cwd: options.cwd, prefix: options.prefix });

  progress("Writing configuration");
  await writeConfiguration(options.cwd, resources);

  progress("Applying database schema");
  await requireWrangler(
    ["d1", "migrations", "apply", options.prefix, "--remote"],
    { cwd: options.cwd },
  );

  progress("Uploading secrets");
  await putSecret(options.cwd, "MASTER_KEY", generateMasterKey());
  await putSecret(options.cwd, "CF_ACCOUNT_ID", accountId);
  await putSecret(options.cwd, "AI_GATEWAY_TOKEN", options.gatewayToken);

  let workerUrl: string | null = null;
  if (options.skipDeploy !== true) {
    progress("Deploying the Worker");
    const deployed = await requireWrangler(["deploy"], { cwd: options.cwd });
    workerUrl = `${deployed.stdout}${deployed.stderr}`.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0] ?? null;
  }

  const result: InitResult = { ok: true, accountId, resources, workerUrl };

  emit(result, () =>
    [
      "Deployment ready.",
      "",
      table([
        ["account", accountId],
        ["database", resources.d1DatabaseId],
        ["namespace", resources.kvNamespaceId],
        ["bucket", resources.r2Bucket],
        ["index", resources.vectorizeIndex],
        ["worker", workerUrl ?? "not deployed"],
      ]),
      "",
      "Next: run muxel claim to take ownership from Telegram.",
    ].join("\n"),
  );

  return result;
}
