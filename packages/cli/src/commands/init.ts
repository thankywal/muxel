/**
 * First run setup.
 *
 * Creates every resource inside the operator Cloudflare account, writes the
 * identifiers into the Worker configuration, uploads the secrets, deploys and
 * then triggers the Worker's own setup endpoint so the schema is applied and
 * the Telegram webhook is registered. Nothing about the deployment is recorded
 * anywhere else.
 *
 * There are two doors into a console and either one on its own is a finished
 * deployment: a key the operator makes up, or a Telegram bot and the account
 * allowed to drive it. This command used to demand the bot, so somebody
 * installing from a terminal was still sent to BotFather for a token they may
 * never use — the exact wall the browser flow stopped putting in front of
 * people. Giving neither door is the only thing refused here now, and the
 * refusal names both ways in.
 */

import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { CONSOLE_KEY_MIN_LENGTH, MuxelError } from "@muxel/core";

import { emit, progress, table } from "../output.js";
import { identity, requireWrangler, runWrangler } from "../wrangler.js";
import { runDoctor } from "./doctor.js";
import { provision, type ResourceIds } from "./provision.js";

/** The console doors, exactly as the command line offered them. */
export interface DoorOptions {
  /** A string the owner makes up, which signs them into the web console. */
  readonly consoleKey?: string;
  /** Telegram bot that will serve the operator console. */
  readonly adminBotToken?: string;
  /** Telegram account permitted to administer the deployment. */
  readonly ownerTelegramId?: string;
}

export interface InitOptions extends DoorOptions {
  /** Directory holding wrangler.jsonc. */
  readonly cwd: string;
  /** Name prefix applied to every created resource. */
  readonly prefix: string;
  /** Only needed for models outside the Workers AI catalogue. */
  readonly gatewayToken?: string;
  readonly accountId?: string;
  /** Skip the deploy step, leaving the configuration in place. */
  readonly skipDeploy?: boolean;
}

/** Which way into the console this invocation is opening. */
export type Door = "console-key" | "telegram";

export interface InitResult {
  readonly ok: true;
  readonly accountId: string;
  readonly resources: ResourceIds;
  readonly workerUrl: string | null;
  /** The doors this run configured, so a script can tell how to sign in. */
  readonly doors: readonly Door[];
  readonly setup: string;
}

/** One door, resolved from the flags rather than read out of them one at a time. */
export interface ConsoleDoors {
  readonly consoleKey: string | null;
  readonly telegram: {
    readonly adminBotToken: string;
    readonly ownerTelegramId: string;
  } | null;
}

/**
 * Reads a flag as a value, or as nothing at all.
 *
 * `--console-key "$KEY"` with the variable unset arrives here as an empty
 * string, and a shell doing that has given no key rather than a key that is
 * empty. Told apart at the door, because everything downstream — what is
 * refused, what is uploaded, what the last line says to do next — depends on
 * which of the two happened.
 */
const given = (value: string | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? null : trimmed;
};

/**
 * Works out which door this run opens, and refuses only when there is none.
 *
 * Kept apart from the provisioning below so that it can be read, and tested,
 * as the rule it is.
 */
export function consoleDoors(options: DoorOptions): ConsoleDoors {
  const consoleKey = given(options.consoleKey);
  const adminBotToken = given(options.adminBotToken);
  const ownerTelegramId = given(options.ownerTelegramId);

  // Half the pair configures nothing: a bot with no owner allowed to answer it,
  // or an owner with no bot to answer through. Whoever holds one half has
  // already been to BotFather, so they are told which half is still missing.
  // Answering them with the name of the other door would read as though the
  // work they had already done was the wrong work.
  if ((adminBotToken === null) !== (ownerTelegramId === null)) {
    const missing = adminBotToken === null ? "admin-bot-token" : "owner-telegram-id";
    throw new MuxelError(
      "invalid_input",
      `--${missing} is needed as well; a Telegram console is both halves or neither`,
      {
        flag: missing,
        remedy:
          missing === "admin-bot-token"
            ? "send /newbot to @BotFather in Telegram to make the console bot"
            : "send /start to @userinfobot in Telegram to find your account id",
      },
    );
  }

  if (consoleKey === null && adminBotToken === null) {
    throw new MuxelError(
      "invalid_input",
      "this deployment would have no way in. Pass --console-key with a phrase you make up, or "
      + "--admin-bot-token and --owner-telegram-id together for a console in Telegram. Either "
      + "one on its own is a finished deployment and the other can be added afterwards",
      { doors: ["--console-key", "--admin-bot-token with --owner-telegram-id"] },
    );
  }

  // Same reason as the id below: the Worker cannot answer until it exists, and
  // a key too short to be a lock costs a whole provisioning run before the
  // setup page says so. The number is the deployment's own, imported rather
  // than typed here, so the two programs cannot come to disagree about it.
  if (consoleKey !== null && consoleKey.length < CONSOLE_KEY_MIN_LENGTH) {
    throw new MuxelError(
      "invalid_input",
      `--console-key has to be at least ${CONSOLE_KEY_MIN_LENGTH} characters, and this one is `
      + "shorter. Your deployment answers on a public address, so that key is the whole lock "
      + "on its console",
      { flag: "console-key", minimum: CONSOLE_KEY_MIN_LENGTH },
    );
  }

  // Checked here rather than by the Worker because the Worker cannot answer
  // until it exists, and a typo in a number should not cost a provisioning run.
  if (ownerTelegramId !== null && !/^\d+$/.test(ownerTelegramId)) {
    throw new MuxelError("invalid_input", "owner telegram id must be digits only", {
      value: ownerTelegramId,
      remedy: "send /start to @userinfobot in Telegram to find it",
    });
  }

  return {
    consoleKey,
    telegram:
      adminBotToken === null || ownerTelegramId === null
        ? null
        : { adminBotToken, ownerTelegramId },
  };
}

/** Generates the base64 master key that seals bot tokens at rest. */
function generateMasterKey(): string {
  return randomBytes(32).toString("base64");
}

/** What the run has to upload besides the doors themselves. */
export interface SecretExtras {
  readonly masterKey: string;
  readonly accountId: string;
  readonly gatewayToken?: string;
}

/**
 * The secrets this run will upload, in the order they go up.
 *
 * A door is written whole or not at all. Uploading the empty half of one is not
 * a smaller version of setting it: `wrangler secret put` reads the value from
 * stdin and the run would stop on it, after the database, the namespace and the
 * index already exist and the configuration has already been rewritten, which
 * is the half written deployment this list exists to prevent. Passing a door
 * over means the deployment simply does not have that door, which is a state it
 * is built for and says so on its own setup page.
 */
export function secretsFor(
  doors: ConsoleDoors,
  extras: SecretExtras,
): readonly (readonly [string, string])[] {
  const secrets: (readonly [string, string])[] = [["MASTER_KEY", extras.masterKey]];

  if (doors.consoleKey !== null) {
    secrets.push(["CONSOLE_KEY", doors.consoleKey]);
  }
  if (doors.telegram !== null) {
    secrets.push(
      ["ADMIN_BOT_TOKEN", doors.telegram.adminBotToken],
      ["OWNER_TELEGRAM_ID", doors.telegram.ownerTelegramId],
    );
  }

  const gatewayToken = given(extras.gatewayToken);
  if (gatewayToken !== null) {
    secrets.push(["AI_GATEWAY_TOKEN", gatewayToken], ["CF_ACCOUNT_ID", extras.accountId]);
  }
  return secrets;
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
 * Asks the deployment what it is still waiting for.
 *
 * /health publishes the list as JSON, names only and never values. Repeating
 * the deployment's own answer keeps the rules in one place: how long a console
 * key has to be, which half of a pair counts as a pair, what a door even is.
 * A second copy of any of that in this file is a copy that goes stale.
 */
async function missingSettings(workerUrl: string): Promise<string[]> {
  try {
    const response = await fetch(`${workerUrl}/health`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json()) as { missing?: unknown };
    return Array.isArray(body.missing)
      ? body.missing.filter((name): name is string => typeof name === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * Calls the Worker's setup endpoint.
 *
 * The Worker cannot learn its own public address until a request arrives, so
 * this call is what applies the schema, records the address, installs the owner
 * and — on a deployment that has a bot — registers the Telegram webhook.
 */
async function triggerSetup(workerUrl: string): Promise<string> {
  const response = await fetch(`${workerUrl}/setup`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (response.ok) {
    return "complete";
  }
  const missing = await missingSettings(workerUrl);
  if (missing.length > 0) {
    return `the deployment is still waiting for ${missing.join(", ")}; open ${workerUrl}/setup to see why`;
  }
  return `the Worker answered ${response.status}; open ${workerUrl}/setup in a browser to see why`;
}

/**
 * What to do next, named for the door that was actually opened.
 *
 * This used to end on "open your console bot in Telegram" however the
 * deployment had been configured, which on a key only install sends its owner
 * looking for a bot nobody asked them to make. The closed door is mentioned too,
 * as an offer rather than an omission: adding it later loses nothing.
 */
function nextSteps(doors: ConsoleDoors, workerUrl: string | null): string[] {
  const steps: string[] = [];

  if (doors.consoleKey !== null) {
    steps.push(
      workerUrl === null
        ? "Deploy, then open app.muxel.site, paste the deployment's address and enter your console key."
        : `Open app.muxel.site, paste ${workerUrl}, and enter your console key.`,
    );
  } else {
    // The length a key has to be is the Worker's rule and the Worker's setup
    // page states it. Repeating the number here would be a second copy of it,
    // and the copy that goes stale is always the one further from the check.
    steps.push(
      "There is no console key here. Add CONSOLE_KEY in the Worker's settings to sign in from a "
      + "browser as well; its setup page says how long it has to be.",
    );
  }

  if (doors.telegram !== null) {
    steps.push("Open your console bot in Telegram and send /start.");
  } else {
    steps.push(
      "A console in Telegram is optional and this deployment has none. Add ADMIN_BOT_TOKEN and "
      + "OWNER_TELEGRAM_ID in the Worker's settings whenever you like; nothing set up now is lost.",
    );
  }
  return steps;
}

export async function runInit(options: InitOptions): Promise<InitResult> {
  // Read first, before wrangler is probed or anything is created. An invocation
  // that could only ever produce a console nobody can sign into should say so
  // in its first second, not once there is a database to clean up.
  const doors = consoleDoors(options);

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

  progress("Uploading secrets");
  const secrets = secretsFor(doors, {
    masterKey: generateMasterKey(),
    accountId,
    gatewayToken: options.gatewayToken,
  });
  for (const [name, value] of secrets) {
    await putSecret(options.cwd, name, value);
  }

  let workerUrl: string | null = null;
  let setup = "skipped";
  if (options.skipDeploy !== true) {
    progress("Deploying the Worker");
    const deployed = await requireWrangler(["deploy"], { cwd: options.cwd });
    workerUrl =
      `${deployed.stdout}${deployed.stderr}`.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0] ?? null;

    if (workerUrl !== null) {
      // Made whichever door was opened. The request is how the Worker learns
      // its own address, and the schema and the owner row hang on it, so a key
      // only deployment needs it exactly as much as one with a bot does.
      progress("Finishing setup");
      setup = await triggerSetup(workerUrl);
    } else {
      setup = "could not determine the Worker address; open /setup in a browser";
    }
  }

  const opened: Door[] = [
    ...(doors.consoleKey !== null ? (["console-key"] as const) : []),
    ...(doors.telegram !== null ? (["telegram"] as const) : []),
  ];
  const result: InitResult = { ok: true, accountId, resources, workerUrl, doors: opened, setup };

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
        ["console", opened.join(", ")],
        ["setup", setup],
      ]),
      "",
      ...nextSteps(doors, workerUrl),
    ].join("\n"),
  );

  return result;
}
