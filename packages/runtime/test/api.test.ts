import { afterEach, describe, expect, it, vi } from "vitest";

import { splitMessage, TelegramClient } from "../src/telegram/api.js";

/**
 * A reply that Telegram refuses is a customer who hears nothing. These tests
 * pin the three refusals seen in practice, model output that is not valid
 * HTML, a body over the length limit, and a rate limit, to recoveries that
 * still deliver the message.
 */

function telegramJson(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const SENT_MESSAGE = { message_id: 7, chat: { id: 42, type: "private" } };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("splitMessage", () => {
  it("returns short text as a single part", () => {
    expect(splitMessage("hello")).toEqual(["hello"]);
  });

  it("keeps every part within the limit and loses no words", () => {
    const words = Array.from({ length: 2000 }, (_, index) => `word${index}`);
    const text = words.join(" ");
    const parts = splitMessage(text);

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(4096);
    }
    expect(parts.join(" ").split(" ")).toEqual(words);
  });

  it("prefers a line break over a mid sentence cut", () => {
    const paragraph = "x".repeat(3000);
    const parts = splitMessage(`${paragraph}\n${paragraph}`);
    expect(parts).toEqual([paragraph, paragraph]);
  });

  it("hard cuts text that offers no boundary at all", () => {
    const parts = splitMessage("y".repeat(5000));
    expect(parts).toEqual(["y".repeat(4096), "y".repeat(904)]);
  });
});

describe("TelegramClient.sendMessage", () => {
  it("resends without formatting when Telegram rejects the HTML", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        telegramJson(
          {
            ok: false,
            error_code: 400,
            description: 'Bad Request: can\'t parse entities: Unsupported start tag "3" at byte offset 12',
          },
          400,
        ),
      )
      .mockResolvedValueOnce(telegramJson({ ok: true, result: SENT_MESSAGE }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new TelegramClient("token");
    const sent = await client.sendMessage({ chatId: 42, text: "price < 300 and <3" });

    expect(sent.message_id).toBe(7);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const second = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(first.parse_mode).toBe("HTML");
    expect(second.parse_mode).toBeUndefined();
    expect(second.text).toBe("price < 300 and <3");
  });

  it("splits a long answer and attaches the keyboard to the last piece", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(telegramJson({ ok: true, result: SENT_MESSAGE })));
    vi.stubGlobal("fetch", fetchMock);

    const keyboard = { inline_keyboard: [[{ text: "ok", callback_data: "x" }]] };
    const client = new TelegramClient("token");
    await client.sendMessage({ chatId: 42, text: "z".repeat(5000), replyMarkup: keyboard });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const second = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(first.reply_markup).toBeUndefined();
    expect(second.reply_markup).toEqual(keyboard);
  });

  it("waits out a short rate limit and retries once", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        telegramJson(
          { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 0 } },
          429,
        ),
      )
      .mockResolvedValueOnce(telegramJson({ ok: true, result: SENT_MESSAGE }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new TelegramClient("token");
    const sent = await client.sendMessage({ chatId: 42, text: "hello" });

    expect(sent.message_id).toBe(7);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up on a rate limit too long to wait out", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      telegramJson(
        { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 60 } },
        429,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new TelegramClient("token");
    await expect(client.sendMessage({ chatId: 42, text: "hello" })).rejects.toThrow(
      "Telegram sendMessage failed",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once when the network drops the request", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(telegramJson({ ok: true, result: SENT_MESSAGE }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new TelegramClient("token");
    const sent = await client.sendMessage({ chatId: 42, text: "hello" });

    expect(sent.message_id).toBe(7);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("still surfaces a failure that is not recoverable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      telegramJson({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }, 403),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new TelegramClient("token");
    await expect(client.sendMessage({ chatId: 42, text: "hello" })).rejects.toThrow(
      "Telegram sendMessage failed",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
