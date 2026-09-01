/**
 * Which answers are credentials, in one place.
 *
 * The bot token branch scrubbed the operator's message from the chat before
 * doing anything else. The GitHub token branch, written months later, did not,
 * so a personal access token sat in the owner's Telegram history in plain text
 * for as long as that chat existed. Two branches, one fact, and only one of
 * them knew it.
 *
 * The web console then needed the same fact for a third reason, to decide
 * whether to draw a hidden field, and had no way to ask. So the fact became a
 * record and every consumer reads it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isCredentialInput, pendingFor } from "../src/telegram/admin.js";

/** Enough of an Env for a KV read. */
const envWith = (raw: string | null) => ({ STATE: { get: async () => raw } }) as never;

describe("what counts as a credential", () => {
  it("names every input that carries one", () => {
    for (const kind of ["new_business", "console_bot", "github_token"]) {
      expect(isCredentialInput(kind), kind).toBe(true);
    }
  });

  it("leaves ordinary prose alone", () => {
    // These end up in the transcript on purpose: an instruction, a note and a
    // reply are all things the operator wants to be able to read back.
    for (const kind of [
      "new_business_name",
      "instructions",
      "customer_note",
      "manual_product",
      "product_fix",
      "web_greeting",
      "web_domains",
      "web_name",
      "data_file",
      "human_reply",
    ]) {
      expect(isCredentialInput(kind), kind).toBe(false);
    }
  });

  it("says nothing about a kind that does not exist", () => {
    expect(isCredentialInput("not_a_kind")).toBe(false);
  });
});

describe("what the console is told it is being asked for", () => {
  it("reports the kind and whether it is a credential", async () => {
    expect(await pendingFor(envWith(JSON.stringify({ kind: "github_token" })), 1)).toEqual({
      kind: "github_token",
      secret: true,
    });
    expect(await pendingFor(envWith(JSON.stringify({ kind: "instructions" })), 1)).toEqual({
      kind: "instructions",
      secret: false,
    });
  });

  it("reports nothing when nothing is pending", async () => {
    expect(await pendingFor(envWith(null), 1)).toBeNull();
  });

  it("reports nothing rather than throwing on a damaged record", async () => {
    // A half written KV value must not take the whole console down with it.
    expect(await pendingFor(envWith("{not json"), 1)).toBeNull();
  });
});

describe("the scrub has one home", () => {
  it("takes the credential out of the chat in exactly one place", () => {
    // The bug was a second branch that did this and a third that forgot to.
    // One call site is the property; more than one means the question is being
    // answered per branch again.
    const source = readFileSync(new URL("../src/telegram/admin.ts", import.meta.url), "utf8");
    const calls = source.match(/client\.deleteMessage\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(source).toContain("if (isCredentialInput(pending.kind)) {");
  });
});
