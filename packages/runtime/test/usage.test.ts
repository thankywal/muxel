import { afterEach, describe, expect, it, vi } from "vitest";

import { accountUsage, FREE_ALLOWANCE, repliesRemaining } from "../src/cloudflare/usage.js";
import type { Env } from "../src/env.js";

/**
 * The usage screen reports someone's spending, so a wrong number is worse than
 * no number. These tests pin that a failure degrades to saying so, never to a
 * confident zero, and that the free allowance arithmetic follows measurement
 * rather than a hardcoded per model rate.
 */

const CONFIGURED = {
  CF_ACCOUNT_ID: "acc123",
  CF_API_TOKEN: "token123",
} as unknown as Env;

const AT = new Date("2026-08-10T09:00:00Z");

function graphql(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const FULL_REPLY = {
  data: {
    viewer: {
      accounts: [
        {
          aiToday: [
            { sum: { totalNeurons: 89.7 }, dimensions: { modelId: "@cf/google/gemma-4" } },
            { sum: { totalNeurons: 0.85 }, dimensions: { modelId: "@cf/baai/bge-m3" } },
          ],
          aiMonth: [{ sum: { totalNeurons: 118.7 } }],
          req: [{ sum: { requests: 64, errors: 0 } }],
          vecQueried: [{ sum: { queriedVectorDimensions: 4096 } }],
          vecStored: [{ max: { storedVectorDimensions: 3072, vectorCount: 3 } }],
        },
      ],
    },
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("accountUsage", () => {
  it("says so plainly when no token is configured, without calling out", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await accountUsage({} as Env, AT);

    expect(result).toEqual({ ok: false, problem: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads the account figures and totals the models", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(graphql(FULL_REPLY)));

    const result = await accountUsage(CONFIGURED, AT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.usage.neuronsToday).toBeCloseTo(90.55, 2);
    expect(result.usage.requestsToday).toBe(64);
    expect(result.usage.storedDimensions).toBe(3072);
    // Largest consumer first, so the line that matters is the one read first.
    expect(result.usage.byModel[0]?.model).toBe("@cf/google/gemma-4");
  });

  it("queries the day and month the operator is actually in", async () => {
    const fetchMock = vi.fn().mockResolvedValue(graphql(FULL_REPLY));
    vi.stubGlobal("fetch", fetchMock);

    await accountUsage(CONFIGURED, AT);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.variables).toMatchObject({
      today: "2026-08-10",
      month: "2026-08-01",
      t0: "2026-08-10T00:00:00Z",
    });
  });

  it("treats a GraphQL errors array as a failure, not as zero usage", async () => {
    // A revoked token answers 200 with an errors array. Reading that as zero
    // would tell the operator they had spent nothing.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(graphql({ errors: [{ message: "Authentication error" }] })),
    );

    expect(await accountUsage(CONFIGURED, AT)).toEqual({ ok: false, problem: "unreachable" });
  });

  it("reports unreachable when the request fails outright", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    expect(await accountUsage(CONFIGURED, AT)).toEqual({ ok: false, problem: "unreachable" });
  });

  it("reports unreachable on a non success status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(graphql({}, 403)));
    expect(await accountUsage(CONFIGURED, AT)).toEqual({ ok: false, problem: "unreachable" });
  });
});

describe("repliesRemaining", () => {
  it("divides the remaining allowance by the measured cost of a reply", () => {
    // Ten replies for 100 neurons is 10 each, so 9,900 left covers 990 more.
    expect(repliesRemaining(100, 10)).toBe(990);
  });

  it("declines to forecast before anything has been answered", () => {
    expect(repliesRemaining(0, 0)).toBeNull();
    expect(repliesRemaining(50, 0)).toBeNull();
  });

  it("floors at zero once the allowance is spent", () => {
    expect(repliesRemaining(FREE_ALLOWANCE.neuronsPerDay + 500, 10)).toBe(0);
  });
});
