/**
 * Three things the console key needs that neither door could see on its own.
 *
 * **Changing the key has to end the sessions it opened.** A session is a thirty
 * day bearer token; the key is a setting. Without a link between them, "change
 * CONSOLE_KEY" stops the next sign in and nothing else — every browser already
 * holding a token keeps working, which is exactly the case an owner changes a
 * leaked key for. So a session opened with a key remembers which key, and stops
 * the moment that is no longer the key. One paired from Telegram carries no
 * such mark: it was the console bot that vouched for that person.
 *
 * **The owner who came through the console is not a Telegram account.** Two
 * places take findOwner's answer and send a Telegram message to it. WEB_OWNER_ID
 * is a row in the operator table and an account Telegram has never heard of, so
 * a deployment with both doors would quietly stop alerting the moment the
 * console row happened to be the older of the two.
 *
 * **A short key must not take down a deployment Telegram is carrying.** It is
 * not a door — it is refused as one — but somebody who adds a weak key to a
 * working console has not broken anything, and answering that by refusing to
 * set up is this page punishing them for trying.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/queries.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  addOperator: vi.fn(async () => undefined),
  findOperator: vi.fn(async () => null),
  getConsoleBot: vi.fn(async () => null),
  putConsoleBot: vi.fn(async () => undefined),
}));
vi.mock("../src/db/migrate.js", () => ({ ensureSchema: vi.fn(async () => 20) }));
vi.mock("../src/repo.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  repositoryVisibility: vi.fn(async () => "unknown"),
}));
vi.mock("../src/secrets.js", async () => {
  const { generateMasterKey: make } = await import("../src/crypto.js");
  const key = make();
  return { peekMasterKey: vi.fn(async () => key), resolveMasterKey: vi.fn(async () => key) };
});
vi.mock("../src/telegram/api.js", () => ({
  TelegramClient: class {
    async getMe() { return { id: 1, is_bot: true, first_name: "C", username: "console_bot" }; }
    async setWebhook() { return true; }
    async setMyCommands() { return true; }
  },
}));

const { handleConsoleRequest, operatorFor } = await import("../src/web/console.js");
const { runSetup, renderSetupPage } = await import("../src/setup.js");
const { WEB_OWNER_ID } = await import("../src/env.js");

function kv() {
  const held = new Map<string, string>();
  return {
    held,
    get: async (k: string) => held.get(k) ?? null,
    put: async (k: string, v: string) => void held.set(k, v),
    delete: async (k: string) => void held.delete(k),
  };
}

const KEY = "a-key-the-owner-made-up";
const OTHER = "a-different-key-entirely";

const claim = (env: unknown, key: string) =>
  handleConsoleRequest(
    env as never,
    new Request("https://x.workers.dev/admin/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key }),
    }),
    "/claim",
  );

const withToken = (token: string) =>
  new Request("https://x.workers.dev/admin/api/system", {
    headers: { authorization: `Bearer ${token}` },
  });

/** Signs in with the key and hands back the token it minted. */
async function signIn(env: { STATE: ReturnType<typeof kv>; CONSOLE_KEY: string }) {
  const response = await claim(env, env.CONSOLE_KEY);
  return ((await response?.json()) as { token: string }).token;
}

describe("changing the console key", () => {
  it("ends the session that key opened", async () => {
    const env = { STATE: kv(), CONSOLE_KEY: KEY };
    const token = await signIn(env);
    expect(await operatorFor(env as never, withToken(token))).toBe(WEB_OWNER_ID);

    // The owner changes the setting in their Worker, which is the whole of
    // taking a leaked key back.
    const after = { STATE: env.STATE, CONSOLE_KEY: OTHER };
    expect(await operatorFor(after as never, withToken(token))).toBeNull();
  });

  it("ends it for good, rather than leaving it to be discovered again", async () => {
    const env = { STATE: kv(), CONSOLE_KEY: KEY };
    const token = await signIn(env);
    const before = env.STATE.held.size;
    await operatorFor({ STATE: env.STATE, CONSOLE_KEY: OTHER } as never, withToken(token));
    expect(env.STATE.held.size).toBe(before - 1);
  });

  it("ends it when the key is removed altogether", async () => {
    const env = { STATE: kv(), CONSOLE_KEY: KEY };
    const token = await signIn(env);
    expect(await operatorFor({ STATE: env.STATE } as never, withToken(token))).toBeNull();
  });

  it("leaves a session paired from Telegram alone", async () => {
    // That person was vouched for by the console bot, not by a setting.
    const env = { STATE: kv(), CONSOLE_KEY: KEY };
    await env.STATE.put("console:pair:ABCD2345", "42");
    const paired = await handleConsoleRequest(
      env as never,
      new Request("https://x.workers.dev/admin/pair", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "ABCD2345" }),
      }),
      "/pair",
    );
    const token = ((await paired?.json()) as { token: string }).token;
    expect(await operatorFor({ STATE: env.STATE, CONSOLE_KEY: OTHER } as never, withToken(token))).toBe(42);
  });

  it("keeps the key itself out of what is written down", async () => {
    const env = { STATE: kv(), CONSOLE_KEY: KEY };
    await signIn(env);
    for (const value of env.STATE.held.values()) {
      expect(value).not.toContain(KEY);
    }
  });
});

describe("who the deployment messages on Telegram", () => {
  it("is never the owner who arrived through the console", async () => {
    const { findOwner } = await import("../src/db/queries.js");
    const asked: unknown[][] = [];
    const env = {
      DB: {
        prepare: (sql: string) => ({
          bind: (...args: unknown[]) => {
            asked.push([sql, ...args]);
            return { first: async () => null };
          },
        }),
      },
    } as never;
    await findOwner(env);
    const [sql, excluded] = asked[0] ?? [];
    expect(String(sql)).toContain("telegram_user_id != ?");
    expect(excluded).toBe(WEB_OWNER_ID);
  });
});

describe("a console key too short to be one", () => {
  const deployment = (settings: Record<string, string>) =>
    ({
      ...settings,
      DB: {},
      STATE: kv(),
      KNOWLEDGE: { describe: async () => { throw new Error("remote only"); } },
    }) as never;

  it("stops a deployment that has no other door", async () => {
    const outcome = await runSetup(deployment({ CONSOLE_KEY: "hunter2" }), "https://x.workers.dev");
    expect(outcome.ok).toBe(false);
    expect(outcome.missing).toEqual(["CONSOLE_KEY"]);
  });

  it("does not stop one Telegram is already carrying", async () => {
    // Adding a weak key to a working console is trying something, not breaking
    // something, and the deployment must not go down over it.
    const outcome = await runSetup(
      deployment({ CONSOLE_KEY: "hunter2", ADMIN_BOT_TOKEN: "123:abc", OWNER_TELEGRAM_ID: "42" }),
      "https://x.workers.dev",
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.shortKey).toBe(true);
  });

  it("says on the page that it is set and not being used", async () => {
    // A key that is set and ignored is the worst of both: the owner believes
    // they have a second way in, and they have not.
    const page = renderSetupPage(
      await runSetup(
        deployment({ CONSOLE_KEY: "hunter2", ADMIN_BOT_TOKEN: "123:abc", OWNER_TELEGRAM_ID: "42" }),
        "https://x.workers.dev",
      ),
    );
    expect(page).toContain("too short to use");
    expect(page).toContain("will not sign you in");
    expect(page).not.toContain("Not ready yet");
  });
});
