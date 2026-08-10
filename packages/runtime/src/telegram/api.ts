/**
 * Minimal Telegram Bot API client.
 *
 * Only the methods Muxel actually calls are modelled. Keeping the surface small
 * avoids shipping a general purpose SDK into the Worker bundle and keeps the
 * request shapes visible at the call site.
 */

import { MuxelError } from "@muxel/core";

const API_ROOT = "https://api.telegram.org";

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
}

export class TelegramClient {
  readonly #token: string;

  constructor(token: string) {
    this.#token = token;
  }

  async #call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${API_ROOT}/bot${this.#token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as TelegramResponse<T>;
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

  sendMessage(input: {
    chatId: number;
    text: string;
    replyMarkup?: InlineKeyboardMarkup;
  }): Promise<TelegramMessage> {
    return this.#call<TelegramMessage>("sendMessage", {
      chat_id: input.chatId,
      text: input.text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(input.replyMarkup ? { reply_markup: input.replyMarkup } : {}),
    });
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
