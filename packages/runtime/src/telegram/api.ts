/**
 * Minimal Telegram Bot API client.
 *
 * Only the methods Muxel actually calls are modelled. Keeping the surface small
 * avoids shipping a general purpose SDK into the Worker bundle and keeps the
 * request shapes visible at the call site.
 */

import { isMuxelError, MuxelError } from "@muxel/core";

const API_ROOT = "https://api.telegram.org";

/** Telegram rejects any message body longer than this many characters. */
const MESSAGE_LIMIT = 4096;

/** Longest rate limit wait honoured. Anything longer fails instead of stalling. */
const MAX_RETRY_AFTER_SECONDS = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Splits a long message into pieces Telegram will accept.
 *
 * Cuts fall on a line break or space where one exists in the second half of the
 * window, so a sentence is not severed mid word unless the text has no better
 * boundary to offer.
 */
export function splitMessage(text: string, limit: number = MESSAGE_LIMIT): string[] {
  if (text.length <= limit) {
    return [text];
  }
  const parts: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const boundary = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(" "));
    const cut = boundary > limit / 2 ? boundary : limit;
    const piece = rest.slice(0, cut).trimEnd();
    if (piece.length > 0) {
      parts.push(piece);
    }
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0) {
    parts.push(rest);
  }
  return parts;
}

/**
 * Recognises Telegram refusing a message because its HTML did not parse.
 *
 * A model writes for a person, not for a parser, and a bare `<` in an answer is
 * enough to make Telegram reject the whole message. That must downgrade the
 * formatting, never swallow the reply.
 */
function isEntityParseFailure(error: unknown): boolean {
  return (
    isMuxelError(error) &&
    typeof error.details.description === "string" &&
    error.details.description.includes("can't parse entities")
  );
}

export interface InlineKeyboardButton {
  readonly text: string;
  readonly callback_data: string;
}

export interface InlineKeyboardMarkup {
  readonly inline_keyboard: readonly (readonly InlineKeyboardButton[])[];
}

export interface TelegramUser {
  readonly id: number;
  readonly is_bot: boolean;
  readonly username?: string;
  readonly first_name?: string;
}

export interface TelegramChat {
  readonly id: number;
  readonly type: string;
}

export interface TelegramDocument {
  readonly file_id: string;
  readonly file_name?: string;
  readonly mime_type?: string;
  readonly file_size?: number;
}

export interface TelegramMessage {
  readonly message_id: number;
  readonly from?: TelegramUser;
  readonly chat: TelegramChat;
  readonly text?: string;
  readonly caption?: string;
  readonly document?: TelegramDocument;
}

export interface TelegramCallbackQuery {
  readonly id: string;
  readonly from: TelegramUser;
  readonly data?: string;
  readonly message?: TelegramMessage;
}

export interface TelegramUpdate {
  readonly update_id: number;
  readonly message?: TelegramMessage;
  readonly callback_query?: TelegramCallbackQuery;
}

interface TelegramResponse<T> {
  readonly ok: boolean;
  readonly result?: T;
  readonly description?: string;
  readonly error_code?: number;
  readonly parameters?: { readonly retry_after?: number };
}

export class TelegramClient {
  readonly #token: string;

  constructor(token: string) {
    this.#token = token;
  }

  #post(method: string, body: Record<string, unknown>): Promise<Response> {
    return fetch(`${API_ROOT}/bot${this.#token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async #call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    let response: Response;
    try {
      response = await this.#post(method, body);
    } catch {
      // One transient network failure gets a second chance. To the person
      // waiting in the chat, a reply lost to a blip and a broken bot look
      // identical.
      response = await this.#post(method, body);
    }
    let payload = (await response.json()) as TelegramResponse<T>;

    if (!payload.ok && payload.error_code === 429) {
      const seconds = payload.parameters?.retry_after ?? 1;
      if (seconds <= MAX_RETRY_AFTER_SECONDS) {
        await sleep(seconds * 1000);
        response = await this.#post(method, body);
        payload = (await response.json()) as TelegramResponse<T>;
      }
    }

    if (!payload.ok || payload.result === undefined) {
      throw new MuxelError("upstream_failure", `Telegram ${method} failed`, {
        method,
        status: response.status,
        // The description is safe to surface; it never echoes the bot token.
        description: payload.description ?? null,
      });
    }
    return payload.result;
  }

  async sendMessage(input: {
    chatId: number;
    text: string;
    replyMarkup?: InlineKeyboardMarkup;
  }): Promise<TelegramMessage> {
    const parts = splitMessage(input.text);
    let sent: TelegramMessage | undefined;
    for (const [index, part] of parts.entries()) {
      sent = await this.#sendPart({
        chatId: input.chatId,
        text: part,
        // The keyboard belongs under the final piece, where the reader ends up.
        replyMarkup: index === parts.length - 1 ? input.replyMarkup : undefined,
      });
    }
    if (sent === undefined) {
      throw new MuxelError("invalid_input", "cannot send an empty message", {
        chatId: input.chatId,
      });
    }
    return sent;
  }

  async #sendPart(input: {
    chatId: number;
    text: string;
    replyMarkup?: InlineKeyboardMarkup;
  }): Promise<TelegramMessage> {
    const body: Record<string, unknown> = {
      chat_id: input.chatId,
      text: input.text,
      link_preview_options: { is_disabled: true },
      ...(input.replyMarkup ? { reply_markup: input.replyMarkup } : {}),
    };
    try {
      return await this.#call<TelegramMessage>("sendMessage", {
        ...body,
        parse_mode: "HTML",
      });
    } catch (error) {
      if (isEntityParseFailure(error)) {
        return this.#call<TelegramMessage>("sendMessage", body);
      }
      throw error;
    }
  }

  editMessageText(input: {
    chatId: number;
    messageId: number;
    text: string;
    replyMarkup?: InlineKeyboardMarkup;
  }): Promise<unknown> {
    return this.#call<unknown>("editMessageText", {
      chat_id: input.chatId,
      message_id: input.messageId,
      text: input.text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(input.replyMarkup ? { reply_markup: input.replyMarkup } : {}),
    });
  }

  /**
   * Acknowledges a button press.
   *
   * Telegram shows a loading indicator on the button until this call lands, so
   * it runs before any slow work on the callback path.
   */
  answerCallbackQuery(input: { id: string; text?: string }): Promise<unknown> {
    return this.#call<unknown>("answerCallbackQuery", {
      callback_query_id: input.id,
      ...(input.text ? { text: input.text } : {}),
    });
  }

  /**
   * Shows the typing indicator for a few seconds.
   *
   * A grounded answer takes several seconds to produce. Without this the chat
   * sits silent and the customer assumes nothing happened.
   */
  async sendChatAction(chatId: number): Promise<void> {
    await this.#call<boolean>("sendChatAction", { chat_id: chatId, action: "typing" });
  }

  getMe(): Promise<TelegramUser> {
    return this.#call<TelegramUser>("getMe", {});
  }

  /**
   * Removes a message from the chat.
   *
   * Used to clear a bot token out of the transcript as soon as it is read.
   * Failures are swallowed by the caller because Telegram refuses deletion of
   * messages older than 48 hours, which is not an error worth surfacing.
   */
  async deleteMessage(input: { chatId: number; messageId: number }): Promise<void> {
    try {
      await this.#call<boolean>("deleteMessage", {
        chat_id: input.chatId,
        message_id: input.messageId,
      });
    } catch {
      // Deliberately ignored: see the note above.
    }
  }

  setWebhook(input: {
    url: string;
    secretToken: string;
    allowedUpdates?: readonly string[];
  }): Promise<unknown> {
    return this.#call<unknown>("setWebhook", {
      url: input.url,
      secret_token: input.secretToken,
      allowed_updates: input.allowedUpdates ?? ["message", "callback_query"],
      drop_pending_updates: true,
    });
  }

  deleteWebhook(): Promise<unknown> {
    return this.#call<unknown>("deleteWebhook", { drop_pending_updates: true });
  }

  /**
   * Reports where Telegram currently delivers updates.
   *
   * `url` is empty when no webhook is set, and `last_error_message` explains why
   * delivery has been failing, which is the difference between a bot that was
   * never connected and one Telegram gave up on.
   */
  getWebhookInfo(): Promise<{
    url: string;
    pending_update_count?: number;
    last_error_message?: string;
  }> {
    return this.#call<{
      url: string;
      pending_update_count?: number;
      last_error_message?: string;
    }>("getWebhookInfo", {});
  }

  async getFileLink(fileId: string): Promise<string> {
    const file = await this.#call<{ file_path?: string }>("getFile", { file_id: fileId });
    if (!file.file_path) {
      throw new MuxelError("upstream_failure", "Telegram returned no file path", { fileId });
    }
    return `${API_ROOT}/file/bot${this.#token}/${file.file_path}`;
  }
}
