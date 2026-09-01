/**
 * A neuron figure is measured or it is not shown.
 *
 * Cloudflare reports neurons per model per day for the whole account and never
 * per request; Muxel counts tokens per model per day. Together they give a rate
 * this account actually paid, and one answer's tokens at that rate is its
 * share. Nothing here comes from a published price list, because a hardcoded
 * rate is wrong the day Cloudflare changes one and wrong for every model this
 * file has not heard of, and neither failure would be visible.
 *
 * The thing these hold hardest is the null. A first reply of the day, a model
 * this account has not used, a deployment with no API token — all of them have
 * no rate, and a zero there would read as "this answer was free".
 */
import { describe, expect, it, vi } from "vitest";

const usage = vi.hoisted(() => ({ result: null as unknown }));
const tokens = vi.hoisted(() => ({ byModel: {} as Record<string, { calls: number; tokens: number }> }));

vi.mock("../src/cloudflare/usage.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  accountUsage: vi.fn(async () => usage.result),
}));
vi.mock("../src/db/queries.js", () => ({
  modelTokensToday: vi.fn(async () => tokens.byModel),
}));

const { allowanceNow, neuronsFor } = await import("../src/cloudflare/allowance.js");

/** A KV that forgets, so each case asks Cloudflare rather than the last case. */
const env = {
  STATE: { get: async () => null, put: async () => undefined },
} as never;

const QWEN = "workers-ai/@cf/qwen/qwen3.8-27b";

describe("the rate", () => {
  it("is neurons over tokens, for the same model on the same day", () => {
    usage.result = {
      ok: true,
      usage: { neuronsToday: 300, byModel: [{ model: "@cf/qwen/qwen3.8-27b", neurons: 300 }] },
    };
    tokens.byModel = { [QWEN]: { calls: 4, tokens: 6000 } };
    return allowanceNow(env).then((allowance) => {
      expect(allowance.rate[QWEN]).toBeCloseTo(300 / 6000);
      // 2,400 tokens at that rate is 120 neurons, and that is the whole sum.
      expect(neuronsFor(allowance, { model: QWEN, inputTokens: 2140, outputTokens: 260 })).toBe(120);
    });
  });

  it("matches Cloudflare's name for a model against Muxel's", async () => {
    // Cloudflare says `@cf/vendor/name`; Muxel prefixes platform models with
    // `workers-ai/`. Compared raw they match nothing, and every rate goes
    // missing — which looks like an empty day rather than like a bug.
    usage.result = {
      ok: true,
      usage: { neuronsToday: 90, byModel: [{ model: "@cf/qwen/qwen3.8-27b", neurons: 90 }] },
    };
    tokens.byModel = { [QWEN]: { calls: 1, tokens: 900 } };
    const allowance = await allowanceNow(env);
    expect(Object.keys(allowance.rate)).toEqual([QWEN]);
  });
});

describe("when there is no rate", () => {
  it("gives null rather than nothing-was-spent", async () => {
    usage.result = { ok: true, usage: { neuronsToday: 0, byModel: [] } };
    tokens.byModel = { [QWEN]: { calls: 1, tokens: 900 } };
    const allowance = await allowanceNow(env);
    expect(neuronsFor(allowance, { model: QWEN, inputTokens: 800, outputTokens: 100 })).toBeNull();
  });

  it("says the token is missing rather than reporting a zero day", async () => {
    usage.result = { ok: false, problem: "not_configured" };
    tokens.byModel = { [QWEN]: { calls: 3, tokens: 4000 } };
    const allowance = await allowanceNow(env);
    expect(allowance.neuronsToday).toBeNull();
    expect(allowance.problem).toBe("not_configured");
    expect(neuronsFor(allowance, { model: QWEN, inputTokens: 10, outputTokens: 5 })).toBeNull();
  });

  it("still reports the day's inclusion, which does not depend on a token", async () => {
    usage.result = { ok: false, problem: "unreachable" };
    tokens.byModel = {};
    expect((await allowanceNow(env)).perDay).toBe(10_000);
  });

  it("does not divide by a model that answered nothing", async () => {
    // Analytics lag a few minutes, so a model can have neurons before Muxel has
    // counted a token for it, and the other way round. Neither is a rate.
    usage.result = {
      ok: true,
      usage: { neuronsToday: 40, byModel: [{ model: "@cf/qwen/qwen3.8-27b", neurons: 40 }] },
    };
    tokens.byModel = { [QWEN]: { calls: 0, tokens: 0 } };
    const allowance = await allowanceNow(env);
    expect(allowance.rate[QWEN]).toBeUndefined();
  });
});
