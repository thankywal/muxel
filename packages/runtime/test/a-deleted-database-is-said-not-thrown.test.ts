/**
 * A deployment whose database had been deleted.
 *
 * Found on this project's own demo, the one the try page points at. Its D1
 * database was deleted out from under it, and for over a month:
 *
 *   - every widget and console request threw before it reached a handler, so
 *     Cloudflare answered with error 1101, a plain text page with no cross
 *     origin headers. A browser will not hand that to a script, so the chat
 *     bubble simply never appeared and nothing on the page said why;
 *   - /health answered `ready`, because the one thing it asked about was the
 *     master key, and the master key lives in KV, which was fine.
 *
 * Nothing was wrong with the code that served a working deployment. What was
 * wrong was how it failed: silently to visitors, and falsely to anything that
 * checked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({ schemaFails: true, schemaCalls: 0 }));

/** What D1 said, word for word, with a made-up id where the demo's own was. */
const GONE = vi.hoisted(() => "D1_ERROR: D1 database 0000dead-0000-4000-8000-000000000000 has been deleted.");

vi.mock("../src/db/migrate.js", () => ({
  ensureSchema: vi.fn(async () => {
    seen.schemaCalls += 1;
    if (seen.schemaFails) {
      throw new Error(GONE);
    }
    return 20;
  }),
}));
vi.mock("../src/secrets.js", () => ({
  peekMasterKey: vi.fn(async () => "a master key"),
  requireMasterKey: vi.fn(async () => "a master key"),
}));

import worker from "../src/index.js";

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

/** A website channel's key. Made up: nothing here reaches a real deployment. */
const CHANNEL = "a1b2c3d4e5f6g7h8j9k0";

/** A database that either answers or is not there at all. */
function database(answers: boolean) {
  const prepare = vi.fn(() => ({
    first: async () => {
      if (!answers) throw new Error(GONE);
      return { 1: 1 };
    },
  }));
  return { prepare };
}

function environment(db: ReturnType<typeof database>, extra: Record<string, string> = {}) {
  return { DB: db, STATE: { get: async () => null }, ...extra } as unknown as Parameters<
    typeof worker.fetch
  >[1];
}

async function ask(path: string, env: ReturnType<typeof environment>, init: RequestInit = {}) {
  return worker.fetch(new Request(`https://demo.example.workers.dev${path}`, init), env, ctx);
}

let errors: string[] = [];
beforeEach(() => {
  seen.schemaFails = true;
  seen.schemaCalls = 0;
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(JSON.stringify(args));
  });
});
afterEach(() => vi.restoreAllMocks());

describe("/health, asked of a deployment with no database", () => {
  it("says the database is unavailable instead of ready", async () => {
    const response = await ask("/health", environment(database(false)));
    expect(response.status).toBe(503);
    const body = (await response.json()) as { service: string; status: string; missing: string[] };
    expect(body).toEqual({ service: "muxel", status: "database_unavailable", missing: [] });
  });

  it("still says ready when the database answers", async () => {
    const response = await ask("/health", environment(database(true)));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { status: string }).status).toBe("ready");
  });

  it("does not ask a database while a setting is missing", async () => {
    // Half of the Telegram pair: the deployment is waiting on its owner, and
    // that is what it has to say, whatever the database would have answered.
    const db = database(false);
    const response = await ask("/health", environment(db, { ADMIN_BOT_TOKEN: "123:abc" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      service: "muxel",
      status: "not_configured",
      missing: ["OWNER_TELEGRAM_ID"],
    });
    expect(db.prepare).not.toHaveBeenCalled();
  });
});

describe("a chat bubble's request, while the database is gone", () => {
  it("is answered, with headers a browser will hand to the page", async () => {
    const response = await ask(`/w/${CHANNEL}/send`, environment(database(false)), {
      method: "POST",
      headers: { origin: "https://shop.example", "content-type": "application/json" },
      body: JSON.stringify({ session: "abcdefgh", text: "How much is a flat white?" }),
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: "unavailable",
      message: "This deployment cannot answer right now.",
    });
  });

  it("tells the visitor nothing about the deployment, and the log everything", async () => {
    const response = await ask(`/w/${CHANNEL}/widget.js`, environment(database(false)));
    const text = await response.text();
    // Anyone can ask, so the database's name and what happened to it stay out
    // of the answer. The owner reads them in the Worker's log instead.
    expect(text).not.toContain("D1");
    expect(text).not.toContain("0000dead");
    expect(errors.join("\n")).toContain(GONE);
  });
});

describe("the console, while the database is gone", () => {
  it("gets an answer it can read, not a refused request", async () => {
    const response = await ask("/admin/api/overview", environment(database(false)), {
      headers: { authorization: `Bearer ${"t".repeat(64)}` },
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(((await response.json()) as { error: string }).error).toBe("unavailable");
  });

  it("has its preflight answered without the database being asked", async () => {
    // A refused preflight is all a browser reports. Answered first, the real
    // request goes out and comes back with the 503 above, which says something.
    const response = await ask("/admin/api/overview", environment(database(false)), {
      method: "OPTIONS",
      headers: { origin: "https://thankywal.github.io", "access-control-request-method": "GET" },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(seen.schemaCalls).toBe(0);
  });
});
