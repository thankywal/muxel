import { describe, expect, it, vi } from "vitest";

import { generate } from "../src/ai/gateway.js";
import type { Env } from "../src/env.js";

/**
 * The thinking pass was the cause of the empty replies, the long waits and
 * most of the cost, and it earned none of that back on a lookup over a price
 * list. Turning it off is a one line flag that is equally easy to lose, so the
 * request is asserted rather than trusted.
 */

function envWith(run: ReturnType<typeof vi.fn>): Env {
  return { AI: { run } } as unknown as Env;
}

const INPUT = {
  model: "workers-ai/@cf/google/gemma-4-26b-a4b-it",
  system: "You answer from a price list.",
  history: [],
  userMessage: "how much is the cheddar cheese?",
  businessId: "abc123",
};

describe("generate on a Workers AI model", () => {
  it("asks the chat template not to run a thinking pass", async () => {
    const run = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "$3.25." }, finish_reason: "stop" }],
      usage: { prompt_tokens: 900, completion_tokens: 6 },
    });

    const result = await generate(envWith(run), INPUT);

    expect(result.text).toBe("$3.25.");
    const [model, body] = run.mock.calls[0] as [string, Record<string, unknown>];
    expect(model).toBe("@cf/google/gemma-4-26b-a4b-it");
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it("keeps the flag on the retry, so a second attempt is not slower than the first", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: "" }, finish_reason: "length" }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: "$3.25." }, finish_reason: "stop" }] });

    await generate(envWith(run), INPUT);

    expect(run).toHaveBeenCalledTimes(2);
    for (const call of run.mock.calls) {
      expect((call[1] as Record<string, unknown>).chat_template_kwargs).toEqual({
        enable_thinking: false,
      });
    }
  });

  it("retries at the same budget rather than a larger one", async () => {
    // Doubling it once pushed a reply past the runtime's limit and lost it.
    const run = vi
      .fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: "" } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: "ok" } }] });

    await generate(envWith(run), INPUT);

    const budgets = run.mock.calls.map((call) => (call[1] as { max_tokens: number }).max_tokens);
    expect(budgets[0]).toBe(budgets[1]);
  });

  it("surfaces a failure when both attempts come back empty", async () => {
    const run = vi.fn().mockResolvedValue({ choices: [{ message: { content: "" } }] });
    await expect(generate(envWith(run), INPUT)).rejects.toThrow("inference returned no content");
  });
});
