#!/usr/bin/env node
/**
 * Muxel command line entry point.
 *
 * Every command accepts `--json`, never requires an interactive terminal, and
 * exits with a code that identifies the failure class. That contract lets a
 * script or a coding agent drive the tool without screen scraping.
 */

import { isMuxelError, MuxelError } from "@muxel/core";

import { flagBoolean, flagString, parseArgs, requireFlag, type ParsedArgs } from "./args.js";
import { EXIT, exitCodeFor, type ExitCode } from "./exit.js";
import { emit, emitError, setOutputMode } from "./output.js";
import { runDoctor } from "./commands/doctor.js";
import { runInit } from "./commands/init.js";
import { runStatus } from "./commands/status.js";
import { requireWrangler } from "./wrangler.js";

const VERSION = "0.1.0";

const HELP = `muxel ${VERSION}

Provision and operate a Muxel deployment inside your own Cloudflare account.

Usage
  muxel <command> [options]

Commands
  init      Create resources, deploy and connect your console bot
  deploy    Redeploy the Worker from the current directory
  status    Report the readiness of a running deployment
  doctor    Check local prerequisites
  version   Print the version
  help      Show this message

Global options
  --json            Emit a single JSON object on stdout
  --dir <path>      Directory holding wrangler.jsonc (default: .)

init options
  --admin-bot-token <token>   Console bot token from @BotFather (required)
  --owner-telegram-id <id>    Your Telegram account id, digits only (required)
  --prefix <name>             Resource name prefix (default: muxel)
  --account-id <id>           Cloudflare account id (default: from wrangler)
  --gateway-token <token>     Only for models outside Workers AI
  --skip-deploy               Configure everything but do not deploy

status options
  --url <url>       Base url of the deployment (required)

Exit codes
  0 success   1 failure   2 usage   3 not configured
  4 unauthorized   5 upstream failure   6 not found
`;

/**
 * Builds a single key object when a flag was supplied, or nothing when it was
 * not. Spreading the result keeps optional properties absent rather than
 * present and undefined, which the strict option types reject.
 */
function optional(args: ParsedArgs, flag: string, key: string): Record<string, string> {
  const value = flagString(args, flag);
  return value === undefined ? {} : { [key]: value };
}

async function dispatch(args: ParsedArgs): Promise<ExitCode> {
  const dir = flagString(args, "dir") ?? process.cwd();

  switch (args.command) {
    case "init": {
      await runInit({
        cwd: dir,
        prefix: flagString(args, "prefix") ?? "muxel",
        adminBotToken: requireFlag(args, "admin-bot-token"),
        ownerTelegramId: requireFlag(args, "owner-telegram-id"),
        ...optional(args, "gateway-token", "gatewayToken"),
        ...optional(args, "account-id", "accountId"),
        skipDeploy: flagBoolean(args, "skip-deploy"),
      });
      return EXIT.ok;
    }

    case "deploy": {
      const result = await requireWrangler(["deploy"], { cwd: dir });
      const url = `${result.stdout}${result.stderr}`.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0] ?? null;
      emit({ ok: true, url }, () => `Deployed. ${url ?? ""}`.trim());
      return EXIT.ok;
    }

    case "status": {
      const report = await runStatus(requireFlag(args, "url"));
      return report.ok ? EXIT.ok : EXIT.notConfigured;
    }

    case "doctor": {
      const report = await runDoctor();
      return report.ok ? EXIT.ok : EXIT.notConfigured;
    }

    case "version": {
      emit({ ok: true, version: VERSION }, () => VERSION);
      return EXIT.ok;
    }

    case "help":
      process.stdout.write(HELP);
      return EXIT.ok;

    default:
      throw new MuxelError("invalid_input", `unknown command ${args.command}`, {
        command: args.command,
      });
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  setOutputMode(flagBoolean(args, "json") ? "json" : "human");

  try {
    process.exitCode = await dispatch(args);
  } catch (error) {
    if (isMuxelError(error)) {
      emitError(error.code, error.message, error.details as Record<string, unknown>);
      process.exitCode = exitCodeFor(error.code);
      return;
    }
    emitError("internal", error instanceof Error ? error.message : String(error));
    process.exitCode = EXIT.failure;
  }
}

await main();
