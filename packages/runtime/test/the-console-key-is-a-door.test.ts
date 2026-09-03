/**
 * A deployment a person cannot get into is not a deployment.
 *
 * Setup refused to finish without ADMIN_BOT_TOKEN and OWNER_TELEGRAM_ID, and
 * the web console could only be signed into with a code that the Telegram
 * console bot was the only thing able to issue. Between them that meant
 * somebody with no Telegram account could not use their own copy of this at
 * all, which is the first wall on the path a judge or a new owner walks.
 *
 * So there are two doors now and either one on its own is a finished
 * deployment. These hold both open: what setup still asks for, what it does
 * with a key and no bot, what it refuses, and what the console does when
 * somebody presents a key at it.
 */
import { describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({
  operators: [] as number[],
  wrote: [] as string[],
  telegram: [] as string[],
  owner: null as { telegramUserId: number; role: string } | null,
}));

vi.mock("../src/telegram/api.js", () => ({
  TelegramClient: class {
    async getMe() {
      seen.telegram.push("getMe");
      return { id: 1, is_bot: true, first_name: "Console", username: "my_console_bot" };
    }
    async setWebhook() { seen.telegram.push("setWebhook"); return true; }
    async setMyCommands() { seen.telegram.push("setMyCommands"); return true; }
  },
}));
// Spread rather than replaced: the console door reaches the admin screens,
// which import the rest of this module and would find nothing there.
vi.mock("../src/db/queries.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  addOperator: vi.fn(async (_env: unknown, input: { telegramUserId: number }) => {
    seen.operators.push(input.telegramUserId);
  }),
  findOperator: vi.fn(async () => seen.owner),
  getConsoleBot: vi.fn(async () => null),
  putConsoleBot: vi.fn(async () => { seen.wrote.push("console_bot"); }),
}));
vi.mock("../src/db/migrate.js", () => ({
  ensureSchema: vi.fn(async () => { seen.wrote.push("schema"); return 20; }),
}));
vi.mock("../src/repo.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  repositoryVisibility: vi.fn(async () => "unknown"),
}));

// The real seal is used, so the master key has to be a real one.
vi.mock("../src/secrets.js", async () => {
  const { generateMasterKey: make } = await import("../src/crypto.js");
  const key = make();
  return { peekMasterKey: vi.fn(async () => key), resolveMasterKey: vi.fn(async () => key) };
});

const { CONSOLE_KEY_MIN_LENGTH, missingConfiguration, WEB_OWNER_ID } = await import("../src/env.js");
const { finishSetup, ORIGIN_KEY, renderSetupPage, runSetup } = await import("../src/setup.js");
const { handleConsoleRequest, operatorFor } = await import("../src/web/console.js");

/** A KV that remembers, and remembers how long it was told to keep things. */
function kv() {
  const held = new Map<string, { value: string; ttl: number | undefined }>();
  return {
    held,
    get: async (key: string) => held.get(key)?.value ?? null,
    put: async (key: string, value: string, options?: { expirationTtl?: number }) =>
      void held.set(key, { value, ttl: options?.expirationTtl }),
    delete: async (key: string) => void held.delete(key),
  };
}

/** A deployment with nothing but the settings under test. */
const deployment = (settings: Record<string, string>) =>
  ({
    ...settings,
    DB: {},
    STATE: kv(),
    KNOWLEDGE: {
      describe: async () => { throw new Error("Binding KNOWLEDGE needs to be run remotely"); },
    },
  }) as never;

const KEY = "a-key-the-owner-made-up";

const setUp = async (settings: Record<string, string>) => {
  seen.operators = [];
  seen.wrote = [];
  seen.telegram = [];
  return runSetup(deployment(settings), "https://muxel.example.workers.dev");
};

const post = (path: string, body: unknown): Request =>
  new Request(`https://muxel.example.workers.dev/admin${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("what a deployment is still asked for", () => {
  it("names the console key when nothing at all is set", () => {
    // The one box door, recommended to the person who has done nothing yet.
    expect(missingConfiguration({} as never)).toEqual(["CONSOLE_KEY"]);
  });

  it("asks for nothing once there is a console key", () => {
    expect(missingConfiguration({ CONSOLE_KEY: KEY } as never)).toEqual([]);
  });

  it("asks for nothing once there is a Telegram pair", () => {
    expect(
      missingConfiguration({ ADMIN_BOT_TOKEN: "123:abc", OWNER_TELEGRAM_ID: "42" } as never),
    ).toEqual([]);
  });

  it("names the other half to somebody who started with the bot token", () => {
    // They have been to BotFather. Answering that with the name of a different
    // door reads as though the work they did was wrong.
    expect(missingConfiguration({ ADMIN_BOT_TOKEN: "123:abc" } as never)).toEqual([
      "OWNER_TELEGRAM_ID",
    ]);
  });

  it("names the other half to somebody who started with their account id", () => {
    expect(missingConfiguration({ OWNER_TELEGRAM_ID: "42" } as never)).toEqual([
      "ADMIN_BOT_TOKEN",
    ]);
  });

  it("does not count a key too short to be a lock", () => {
    expect(missingConfiguration({ CONSOLE_KEY: "short" } as never)).toEqual(["CONSOLE_KEY"]);
  });
});

describe("a deployment with a key and no Telegram", () => {
  it("finishes setting up", async () => {
    const outcome = await setUp({ CONSOLE_KEY: KEY });
    expect(outcome.ok).toBe(true);
    expect(outcome.consoleKey).toBe(true);
    expect(outcome.missing).toEqual([]);
  });

  it("installs the owner who arrives through the console", async () => {
    // Without this row the access check downstream answers a session the
    // deployment itself just issued with "this console is private".
    await setUp({ CONSOLE_KEY: KEY });
    expect(seen.operators).toEqual([WEB_OWNER_ID]);
  });

  it("says nothing to Telegram and connects no bot", async () => {
    await setUp({ CONSOLE_KEY: KEY });
    expect(seen.telegram).toEqual([]);
    expect(seen.wrote).not.toContain("console_bot");
  });

  it("reads as ready rather than as half built", async () => {
    // The failure this replaces: a page that named a bot the owner was never
    // asked for and sent them looking for one.
    const page = renderSetupPage(await setUp({ CONSOLE_KEY: KEY }));
    expect(page).toContain("Your console is connected");
    expect(page).not.toContain("Not ready yet");
    expect(page).toContain("app.muxel.site");
    expect(page).toContain("Telegram is optional");
  });
});

describe("a key too short to be a lock", () => {
  it("is refused, and named", async () => {
    const outcome = await setUp({ CONSOLE_KEY: "hunter2" });
    expect(outcome.ok).toBe(false);
    expect(outcome.missing).toEqual(["CONSOLE_KEY"]);
    expect(outcome.note).toContain(String(CONSOLE_KEY_MIN_LENGTH));
  });

  it("says why the length is the whole of it", async () => {
    const outcome = await setUp({ CONSOLE_KEY: "hunter2" });
    expect(outcome.note).toContain("public");
    expect(outcome.note).toContain("lock");
  });

  it("writes nothing while it is refused", async () => {
    await setUp({ CONSOLE_KEY: "hunter2" });
    expect(seen.operators).toEqual([]);
    expect(seen.wrote).toEqual([]);
  });
});

describe("a deployment nobody can get into yet", () => {
  it("offers a key long enough to be one", async () => {
    const outcome = await setUp({});
    expect(outcome.suggestedKey?.length ?? 0).toBeGreaterThanOrEqual(CONSOLE_KEY_MIN_LENGTH);
  });

  it("makes a different one every time, because it is made and not held", async () => {
    const first = await setUp({});
    const second = await setUp({});
    expect(first.suggestedKey).not.toBe(second.suggestedKey);
  });

  it("puts it on the page as a suggestion, with the setting to paste it into", async () => {
    const outcome = await setUp({});
    const page = renderSetupPage(outcome);
    expect(page).toContain(outcome.suggestedKey as string);
    expect(page).toContain("CONSOLE_KEY");
    expect(page).toContain("suggestion");
  });

  it("names the Telegram door as the alternative", async () => {
    const page = renderSetupPage(await setUp({}));
    expect(page).toContain("ADMIN_BOT_TOKEN");
    expect(page).toContain("OWNER_TELEGRAM_ID");
  });

  it("offers nothing to somebody halfway through the Telegram door", async () => {
    // They are missing one value they already know about, not a way in.
    const outcome = await setUp({ ADMIN_BOT_TOKEN: "123:abc" });
    expect(outcome.suggestedKey).toBeUndefined();
    expect(renderSetupPage(outcome)).toContain("OWNER_TELEGRAM_ID");
  });
});

describe("a deployment with both doors", () => {
  it("sets up the bot as well and says so on the page", async () => {
    const outcome = await setUp({
      CONSOLE_KEY: KEY,
      ADMIN_BOT_TOKEN: "123:abc",
      OWNER_TELEGRAM_ID: "42",
    });
    expect(outcome.ok).toBe(true);
    expect(seen.telegram).toContain("setWebhook");
    expect(seen.operators).toEqual([42, WEB_OWNER_ID]);
    const page = renderSetupPage(outcome);
    expect(page).toContain("@my_console_bot");
    expect(page).toContain("app.muxel.site");
  });
});

describe("presenting the key at the console", () => {
  const claim = (env: unknown, key: string) =>
    handleConsoleRequest(env as never, post("/claim", { key }), "/claim");

  it("refuses when the deployment has no console key", async () => {
    const response = await claim({ STATE: kv() }, KEY);
    expect(response?.status).toBe(401);
    expect(await response?.json()).toMatchObject({ error: "no_console_key" });
  });

  it("treats a key too short to be a lock as no key at all", async () => {
    const response = await claim({ STATE: kv(), CONSOLE_KEY: "short" }, "short");
    expect(await response?.json()).toMatchObject({ error: "no_console_key" });
  });

  it("refuses a key that is not this deployment's", async () => {
    const env = { STATE: kv(), CONSOLE_KEY: KEY };
    const response = await claim(env, "a-key-the-owner-made-uq");
    expect(response?.status).toBe(401);
    expect(await response?.json()).toMatchObject({ error: "bad_key" });
    expect(env.STATE.held.size).toBe(0);
  });

  it("hands back a session for the right key", async () => {
    const response = await claim({ STATE: kv(), CONSOLE_KEY: KEY }, KEY);
    expect(response?.status).toBe(200);
    const body = (await response?.json()) as { ok: boolean; token: string };
    expect(body.ok).toBe(true);
    expect(body.token.length).toBeGreaterThanOrEqual(32);
  });

  it("survives the whitespace a paste brings with it", async () => {
    const response = await claim({ STATE: kv(), CONSOLE_KEY: `${KEY}\n` }, ` ${KEY} `);
    expect(await response?.json()).toMatchObject({ ok: true });
  });

  it("keeps only the hash, so a copy of KV is not a working token", async () => {
    const env = { STATE: kv(), CONSOLE_KEY: KEY };
    const body = (await (await claim(env, KEY))?.json()) as { token: string };
    const keys = [...env.STATE.held.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^console:session:[0-9a-f]{64}$/);
    expect(keys[0]).not.toContain(body.token);
  });

  it("lasts the thirty days a paired session lasts", async () => {
    const env = { STATE: kv(), CONSOLE_KEY: KEY };
    await claim(env, KEY);
    expect([...env.STATE.held.values()][0]?.ttl).toBe(60 * 60 * 24 * 30);
  });

  it("comes back as the owner who arrived through the console", async () => {
    const env = { STATE: kv(), CONSOLE_KEY: KEY };
    const body = (await (await claim(env, KEY))?.json()) as { token: string };
    const who = await operatorFor(
      env as never,
      new Request("https://muxel.example.workers.dev/admin/screen", {
        headers: { authorization: `Bearer ${body.token}` },
      }),
    );
    expect(who).toBe(WEB_OWNER_ID);
  });

  it("ends in the same session the pairing code ends in", async () => {
    // One place mints a token. Two would drift, and the drift would be in how
    // long somebody stays signed in or in what is written down about them.
    const env = { STATE: kv(), CONSOLE_KEY: KEY };
    await env.STATE.put("console:pair:ABCD2345", "42");
    await handleConsoleRequest(env as never, post("/pair", { code: "ABCD2345" }), "/pair");
    await claim(env, KEY);
    const sessions = [...env.STATE.held.entries()].filter(([key]) =>
      key.startsWith("console:session:"),
    );
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.[1].ttl).toBe(sessions[1]?.[1].ttl);
    // The operator each one names, which is the part that must not drift.
    expect(sessions.map(([, held]) => String(held.value).split(":")[0]).sort()).toEqual(["0", "42"]);
    // What the key-opened one carries on top of that is not drift: it is which
    // key opened it, so that changing the key ends it. A paired session has no
    // such mark, because it was the console bot that vouched for that person.
    const values = sessions.map(([, held]) => String(held.value));
    expect(values.filter((value) => value.includes(":"))).toHaveLength(1);
    expect(values).toContain("42");
  });
});

describe("the schedule, on a deployment with a key and no bot", () => {
  const scheduled = async (settings: Record<string, string>) => {
    seen.operators = [];
    seen.wrote = [];
    seen.telegram = [];
    const env = deployment(settings) as unknown as { STATE: ReturnType<typeof kv> };
    await env.STATE.put(ORIGIN_KEY, "https://muxel.example.workers.dev");
    return finishSetup(env as never);
  };

  it("finishes the run that the first request never made", async () => {
    // A brand new workers.dev address answers 404 for a minute or two, so the
    // deploy script's own request can miss it entirely and this is what is
    // left. The owner row is the record of whether that ever happened.
    seen.owner = null;
    expect(await scheduled({ CONSOLE_KEY: KEY })).toBe("completed");
    expect(seen.operators).toEqual([WEB_OWNER_ID]);
  });

  it("leaves a deployment that already has its owner alone", async () => {
    // Nothing was registered with anybody, so there is no webhook to keep
    // alive and a run on every tick would be work for nothing.
    seen.owner = { telegramUserId: WEB_OWNER_ID, role: "owner" };
    expect(await scheduled({ CONSOLE_KEY: KEY })).toBe("healthy");
    expect(seen.operators).toEqual([]);
    expect(seen.wrote).toEqual([]);
  });

  it("skips a deployment with no door at all", async () => {
    seen.owner = null;
    expect(await scheduled({})).toBe("skipped");
    expect(seen.wrote).toEqual([]);
  });
});
