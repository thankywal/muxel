/**
 * First run setup.
 *
 * Creates every resource inside the operator Cloudflare account, writes the
 * identifiers into the Worker configuration, uploads the secrets, deploys and
 * then triggers the Worker's own setup endpoint so the schema is applied and
 * the Telegram webhook is registered. Nothing about the deployment is recorded
 * anywhere else.
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
  /** Directory holding wrangler.jsonc. */
  readonly cwd: string;
  /** Name prefix applied to every created resource. */
  readonly prefix: string;
  /** Telegram bot that will serve the operator console. */
  readonly adminBotToken: string;
  /** Telegram account permitted to administer the deployment. */
  readonly ownerTelegramId: string;
  /** Only needed for models outside the Workers AI catalogue. */
  readonly gatewayToken?: string;
  readonly accountId?: string;
  /** Skip the deploy step, leaving the configuration in place. */
  readonly skipDeploy?: boolean;
}

export interface InitResult {
  readonly ok: true;
  readonly accountId: string;
  readonly resources: ResourceIds;
  readonly workerUrl: string | null;
  readonly setup: string;
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

/**
 * Calls the Worker's setup endpoint.
 *
 * The Worker cannot learn its own public address until a request arrives, so
 * this call is what lets it register the Telegram webhook.
 */
async function triggerSetup(workerUrl: string): Promise<string> {
  const response = await fetch(`${workerUrl}/setup`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (response.ok) {
    return "complete";
  }
  return `the Worker answered ${response.status}; open ${workerUrl}/setup in a browser to see why`;
}

export async function runInit(options: InitOptions): Promise<InitResult> {
  const health = await runDoctor();
  if (!health.ok) {
    throw new MuxelError("not_configured", "prerequisites are not satisfied", {
      failed: health.checks.filter((check) => !check.ok).map((check) => check.name),
    });
  }

  if (!/^\d+$/.test(options.ownerTelegramId)) {
    throw new MuxelError("invalid_input", "owner telegram id must be digits only", {
      value: options.ownerTelegramId,
      remedy: "send /start to @userinfobot in Telegram to find it",
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

  progress("Uploading secrets");
  await putSecret(options.cwd, "MASTER_KEY", generateMasterKey());
  await putSecret(options.cwd, "ADMIN_BOT_TOKEN", options.adminBotToken);
  await putSecret(options.cwd, "OWNER_TELEGRAM_ID", options.ownerTelegramId);
  if (options.gatewayToken !== undefined && options.gatewayToken.length > 0) {
    await putSecret(options.cwd, "AI_GATEWAY_TOKEN", options.gatewayToken);
    await putSecret(options.cwd, "CF_ACCOUNT_ID", accountId);
  }

  let workerUrl: string | null = null;
  let setup = "skipped";
  if (options.skipDeploy !== true) {
    progress("Deploying the Worker");
    const deployed = await requireWrangler(["deploy"], { cwd: options.cwd });
    workerUrl =
      `${deployed.stdout}${deployed.stderr}`.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0] ?? null;

    if (workerUrl !== null) {
      progress("Registering the Telegram webhook");
      setup = await triggerSetup(workerUrl);
    } else {
      setup = "could not determine the Worker address; open /setup in a browser";
    }
  }

  const result: InitResult = { ok: true, accountId, resources, workerUrl, setup };

  emit(result, () =>
    [
      "Deployment ready.",
      "",
      table([
        ["account", accountId],
        ["database", resources.d1DatabaseId],
        ["namespace", resources.kvNamespaceId],
        ["index", resources.vectorizeIndex],
        ["worker", workerUrl ?? "not deployed"],
        ["setup", setup],
      ]),
      "",
      "Open your console bot in Telegram and send /start.",
    ].join("\n"),
  );

  return result;
}
