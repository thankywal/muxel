/**
 * The command line refuses the key the deployment would refuse.
 *
 * Found by running `muxel init --console-key short`: it was accepted, the
 * command went on to its preflight, and a real run would have provisioned a
 * D1 database, a KV namespace and a Vectorize index before the setup page
 * said the key was too short. The file already made this argument for the
 * Telegram id — "a typo in a number should not cost a provisioning run" — and
 * the key is the same argument with more at stake.
 *
 * The number is one number. It used to live in the runtime, which the command
 * line cannot import, so it now lives in @muxel/core and both read it. Two
 * copies of a number are two numbers, and the one that drifted would be the
 * one the owner met first.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CONSOLE_KEY_MIN_LENGTH } from "@muxel/core";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const env = read("../src/env.ts");
const init = read("../../cli/src/commands/init.ts");
const core = read("../../core/src/console-key.ts");

describe("how short is too short", () => {
  it("is declared once, where both programs can reach it", () => {
    expect(CONSOLE_KEY_MIN_LENGTH).toBe(16);
    expect(core).toContain("export const CONSOLE_KEY_MIN_LENGTH = 16");
    // The runtime hands it on rather than keeping its own.
    expect(env).toContain('export { CONSOLE_KEY_MIN_LENGTH } from "@muxel/core"');
    expect(env).not.toMatch(/const CONSOLE_KEY_MIN_LENGTH = \d/);
  });

  it("is typed nowhere else", () => {
    // A literal 16 beside a key check is the drift this replaces.
    for (const [name, source] of [["env.ts", env], ["init.ts", init]] as const) {
      expect(source, name).not.toMatch(/length\s*[<>]=?\s*16\b/);
    }
  });

  it("is what the command line refuses before it provisions anything", () => {
    const guard = init.slice(init.indexOf("consoleKey !== null && consoleKey.length"));
    expect(guard.slice(0, 400)).toContain("CONSOLE_KEY_MIN_LENGTH");
    expect(guard.slice(0, 600)).toContain("the whole lock");
    // Before the run that creates resources, not after it.
    expect(init.indexOf("consoleKey.length < CONSOLE_KEY_MIN_LENGTH")).toBeLessThan(
      init.indexOf("provision("),
    );
  });

  it("is what the deployment refuses at setup", () => {
    expect(read("../src/setup.ts")).toContain("CONSOLE_KEY_MIN_LENGTH");
  });
});
