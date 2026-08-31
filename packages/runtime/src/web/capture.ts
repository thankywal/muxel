/**
 * A Telegram client that answers into memory instead of over the wire.
 *
 * The console's typed replies, the ones that name a business or send a message
 * to a customer, are handled by code that was written to talk to Telegram and
 * returns nothing. Rewriting all of it to return a screen would fork the
 * console in two, and the fork would drift.
 *
 * So the web console runs exactly the same code and swaps the destination.
 * Anything the handler would have sent is collected here and handed back as the
 * screen the browser renders. One code path, two destinations, no second
 * implementation to keep in step.
 */

import { TelegramClient, type InlineKeyboardMarkup, type TelegramMessage } from "../telegram/api.js";

export interface CapturedScreen {
  readonly text: string;
  readonly rows: readonly (readonly { text: string; action: string; args?: readonly string[] }[])[];
}

/** A message id has to be returned, and nothing here ever reads it back. */
const STUB_MESSAGE_ID = 0;

export class CapturingClient extends TelegramClient {
  readonly captured: CapturedScreen[] = [];

  constructor() {
    super("capture");
  }

  /** Called by render() when it recognises this client, before any keyboard is built. */
  captureScreen(screen: CapturedScreen): void {
    this.captured.push(screen);
  }

  /** What the browser should show: the last screen, with earlier notes above it. */
  result(): CapturedScreen {
    const last = this.captured.at(-1);
    if (last === undefined) return { text: "", rows: [] };
    const notes = this.captured.slice(0, -1).map((c) => c.text).filter((t) => t.length > 0);
    return notes.length === 0
      ? last
      : { text: [...notes, last.text].filter((t) => t.length > 0).join("\n\n"), rows: last.rows };
  }

  override async sendMessage(input: {
    chatId: number;
    text: string;
    replyMarkup?: InlineKeyboardMarkup;
  }): Promise<TelegramMessage> {
    // Plain text with no screen behind it, such as a confirmation line.
    this.captured.push({ text: input.text, rows: [] });
    return {
      message_id: STUB_MESSAGE_ID,
      chat: { id: input.chatId, type: "private" },
    } as unknown as TelegramMessage;
  }

  override async editMessageText(input: {
    chatId: number;
    messageId: number;
    text: string;
    replyMarkup?: InlineKeyboardMarkup;
  }): Promise<void> {
    this.captured.push({ text: input.text, rows: [] });
  }

  /** The rest are gestures that only mean something in a chat window. */
  override async sendChatAction(): Promise<void> {}
  override async deleteMessage(): Promise<void> {}

  override async getFileLink(): Promise<string> {
    // Uploads still belong to Telegram: the file lives on their servers and the
    // web console never receives one. Saying so is better than a broken link.
    throw new Error("Files are uploaded through the Telegram console.");
  }
}
