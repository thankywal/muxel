/**
 * Argument parsing.
 *
 * Hand written rather than pulled from a dependency so that the published
 * package has no runtime dependencies beyond the workspace core, which keeps
 * `npx muxel` fast to start and easy to audit.
 */

import { invalidInput } from "@muxel/core";

export interface ParsedArgs {
  readonly command: string;
  readonly positional: readonly string[];
  readonly flags: ReadonlyMap<string, string | boolean>;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;

    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }

    const body = token.slice(2);
    if (body.length === 0) {
      // A bare `--` ends flag parsing; everything after is positional.
      positional.push(...argv.slice(index + 1));
      break;
    }

    const equals = body.indexOf("=");
    if (equals !== -1) {
      flags.set(body.slice(0, equals), body.slice(equals + 1));
      continue;
    }

    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(body, next);
      index += 1;
      continue;
    }

    flags.set(body, true);
  }

  const command = positional.shift() ?? "help";
  return { command, positional, flags };
}

export function flagString(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

export function flagBoolean(args: ParsedArgs, name: string): boolean {
  return args.flags.get(name) === true || args.flags.get(name) === "true";
}

export function requireFlag(args: ParsedArgs, name: string): string {
  const value = flagString(args, name);
  if (value === undefined || value.length === 0) {
    throw invalidInput(`missing required flag --${name}`, { flag: name });
  }
  return value;
}
