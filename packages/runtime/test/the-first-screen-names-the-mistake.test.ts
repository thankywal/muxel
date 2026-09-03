/**
 * The first screen of a new deployment, when the token is wrong.
 *
 * Found by booting the Worker with an empty database and a token that was not
 * a token, which is the state a judge or an owner is in ten minutes after
 * pressing Deploy. The page said:
 *
 *     Not ready yet.
 *     Setup could not finish: Telegram getMe failed
 *
 * — an API method name, returned as a 500, to somebody who has just pasted one
 * of two tokens into a box and has no way to tell which one was wrong.
 *
 * Telegram says exactly what is wrong with a token. That sentence was carried
 * as far as the error's details and printed nowhere. A rejected token is a
 * setting to correct, not a crash, so it goes back the way the other bad
 * settings already do: named, with what Telegram said, and 503.
 */
import { describe, expect, it, vi } from "vitest";
import { MuxelError } from "@muxel/core";

const seen = vi.hoisted(() => ({ wrote: [] as string[], fail: true }));

vi.mock("../src/telegram/api.js", () => ({
  TelegramClient: class {
    async getMe() {
      if (seen.fail) {
        throw new MuxelError("upstream_failure", "Telegram getMe failed", {
          method: "getMe",
          status: 401,
          description: "Unauthorized: invalid token specified",
        });
      }
      return { id: 1, is_bot: true, first_name: "Console", username: "my_console_bot" };
    }
    async setWebhook() { return true; }
    async setMyCommands() { return true; }
    async sendMessage() { return {}; }
  },
}));
vi.mock("../src/db/queries.js", () => ({
  addOperator: vi.fn(async () => { seen.wrote.push("operator"); }),
  getConsoleBot: vi.fn(async () => null),
  putConsoleBot: vi.fn(async () => { seen.wrote.push("console_bot"); }),
}));
vi.mock("../src/db/migrate.js", () => ({ ensureSchema: vi.fn(async () => 20) }));
vi.mock("../src/crypto.js", () => ({
  seal: vi.fn(async () => "sealed"),
  open: vi.fn(async () => ""),
  sha256Hex: vi.fn(async () => "hash"),
}));
vi.mock("../src/secrets.js", () => ({
  peekMasterKey: vi.fn(async () => null),
  resolveMasterKey: vi.fn(async () => { seen.wrote.push("master_key"); return "k"; }),
}));
vi.mock("../src/repo.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  repositoryVisibility: vi.fn(async () => "unknown"),
}));

const { runSetup } = await import("../src/setup.js");
const { renderSetupPage } = await import("../src/setup.js");

const env = {
  ADMIN_BOT_TOKEN: "0000:not-a-token",
  OWNER_TELEGRAM_ID: "1",
  DB: {},
  STATE: { get: async () => null, put: async () => undefined },
  KNOWLEDGE: { describe: async () => { throw new Error("Binding KNOWLEDGE needs to be run remotely"); } },
} as never;

describe("a console bot token Telegram will not accept", () => {
  it("comes back as a setting to correct, not as a crash", async () => {
    seen.wrote = [];
    seen.fail = true;
    const outcome = await runSetup(env, "https://muxel.example.workers.dev");
    expect(outcome.ok).toBe(false);
    expect(outcome.missing).toContain("ADMIN_BOT_TOKEN");
  });

  it("says what Telegram said about it", async () => {
    seen.fail = true;
    const outcome = await runSetup(env, "https://muxel.example.workers.dev");
    // The one sentence that tells the owner which of the two mistakes it is.
    expect(outcome.note).toContain("Unauthorized: invalid token specified");
    expect(outcome.note).not.toContain("getMe");
    // And what to do, in the words of the thing they were given.
    expect(outcome.note).toContain("@BotFather");
    expect(outcome.note).toContain("not the bot your customers write to");
    expect(outcome.note).toContain("ADMIN_BOT_TOKEN");
  });

  it("writes nothing before the token is accepted", async () => {
    // A half configured deployment is worse than an unconfigured one: it looks
    // set up and answers nobody.
    seen.wrote = [];
    seen.fail = true;
    await runSetup(env, "https://muxel.example.workers.dev");
    expect(seen.wrote).not.toContain("operator");
    expect(seen.wrote).not.toContain("console_bot");
  });

  it("reaches the page the owner is looking at", async () => {
    seen.fail = true;
    const page = renderSetupPage(await runSetup(env, "https://muxel.example.workers.dev"));
    expect(page).toContain("Unauthorized: invalid token specified");
    expect(page).toContain("Not ready yet");
  });
});

describe("a token it does accept", () => {
  it("gets on with setting the deployment up", async () => {
    seen.wrote = [];
    seen.fail = false;
    const outcome = await runSetup(env, "https://muxel.example.workers.dev");
    expect(outcome.botUsername).toBe("my_console_bot");
    expect(seen.wrote).toContain("operator");
    expect(seen.wrote).toContain("console_bot");
  });
});
