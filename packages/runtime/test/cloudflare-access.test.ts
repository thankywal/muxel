/**
 * The owner pastes a token. They are not asked for an account id.
 *
 * A token belongs to an account and Cloudflare will say which, so asking for a
 * second value the owner would have to go and look up is a question we already
 * have the answer to. What cannot be automated is the token itself: Cloudflare
 * does not let a Worker mint an API token for the account it runs in, which is
 * the right boundary and the reason this asks at all.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const vault = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("../src/web/secrets-vault.js", () => ({
  getSecret: vi.fn(async () => vault.token),
}));

const { cloudflareAccess } = await import("../src/cloudflare/access.js");
const { workersSubdomain } = await import("../src/cloudflare/account.js");

/** A KV that actually remembers, so the caching is real and not asserted. */
function kv() {
  const held = new Map<string, string>();
  return {
    get: async (key: string, kind?: string) => {
      const raw = held.get(key) ?? null;
      return raw !== null && kind === "json" ? JSON.parse(raw) : raw;
    },
    put: async (key: string, value: string) => void held.set(key, value),
    delete: async (key: string) => void held.delete(key),
  };
}

const accounts = (list: { id: string; name: string }[]) =>
  new Response(JSON.stringify({ result: list }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vault.token = null;
  vi.unstubAllGlobals();
});

describe("finding the account", () => {
  it("takes the one the token can see", async () => {
    vault.token = "cf-token";
    vi.stubGlobal("fetch", vi.fn(async () => accounts([{ id: "acc123", name: "Nandar's Account" }])));
    const access = await cloudflareAccess({ STATE: kv() } as never);
    expect(access).toEqual({ token: "cf-token", accountId: "acc123", name: "Nandar's Account" });
  });

  it("asks Cloudflare once, then remembers", async () => {
    vault.token = "cf-token";
    const fetchMock = vi.fn(async () => accounts([{ id: "acc123", name: "A" }]));
    vi.stubGlobal("fetch", fetchMock);
    const env = { STATE: kv() } as never;
    await cloudflareAccess(env);
    await cloudflareAccess(env);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not answer a new token from the old token's account", async () => {
    // Pasting a different token is how an owner moves this to another account.
    // A cache keyed only by "the account" would keep pointing at the old one.
    const env = { STATE: kv() } as never;
    vault.token = "first";
    vi.stubGlobal("fetch", vi.fn(async () => accounts([{ id: "acc1", name: "One" }])));
    expect((await cloudflareAccess(env))?.accountId).toBe("acc1");

    vault.token = "second";
    vi.stubGlobal("fetch", vi.fn(async () => accounts([{ id: "acc2", name: "Two" }])));
    expect((await cloudflareAccess(env))?.accountId).toBe("acc2");
  });

  it("will not guess when the token can see several accounts", async () => {
    // Reporting somebody else's neuron spend is worse than reporting none.
    vault.token = "cf-token";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => accounts([{ id: "acc1", name: "One" }, { id: "acc2", name: "Two" }])),
    );
    expect(await cloudflareAccess({ STATE: kv() } as never)).toBeNull();
  });

  it("uses the deploy form's account id to settle that, when there is one", async () => {
    vault.token = "cf-token";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => accounts([{ id: "acc1", name: "One" }, { id: "acc2", name: "Two" }])),
    );
    const access = await cloudflareAccess({ STATE: kv(), CF_ACCOUNT_ID: "acc2" } as never);
    expect(access?.accountId).toBe("acc2");
    expect(access?.name).toBe("Two");
  });
});

describe("when there is no token", () => {
  it("does not call out at all", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await cloudflareAccess({ STATE: kv() } as never)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the deploy form's token when the vault is empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => accounts([{ id: "acc9", name: "Deployed" }])));
    const access = await cloudflareAccess({ STATE: kv(), CF_API_TOKEN: "from-deploy" } as never);
    expect(access?.token).toBe("from-deploy");
  });

  it("prefers the pasted token over the deploy form's", async () => {
    // The console is the only place an owner can change this without a
    // redeploy, so what they typed there is what they most recently decided.
    vault.token = "pasted";
    vi.stubGlobal("fetch", vi.fn(async () => accounts([{ id: "acc1", name: "One" }])));
    const access = await cloudflareAccess({ STATE: kv(), CF_API_TOKEN: "stale" } as never);
    expect(access?.token).toBe("pasted");
  });
});

describe("naming the owner without a token", () => {
  it("takes the account's handle out of the address it was asked at", () => {
    // Every account has a workers.dev subdomain and it is in the hostname, so
    // this needs no token and no permission. It beats calling someone "Owner".
    expect(workersSubdomain("https://muxel.nandar.workers.dev/admin/api/me")).toBe("nandar");
    expect(workersSubdomain("https://sunrise-bakery.thankywal.workers.dev/")).toBe("thankywal");
  });

  it("says nothing on a custom domain, where the hostname names nobody", () => {
    expect(workersSubdomain("https://bot.sunrisebakery.com/admin/api/me")).toBeNull();
    // The account's own bare subdomain has no worker in front of it, so there
    // is no account half to read.
    expect(workersSubdomain("https://nandar.workers.dev/")).toBeNull();
    expect(workersSubdomain("not a url")).toBeNull();
  });
});
