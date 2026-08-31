/**
 * A person answering a customer, in one place.
 *
 * The Telegram console had this inline: resolve the business bot, send as that
 * bot rather than as the console, then record the turn as an assistant message
 * marked human. The web console, written later, called only the last step. The
 * operator watched their own message appear in the transcript and the customer
 * was never sent anything, which is the worst possible failure for a takeover
 * because it looks exactly like success.
 *
 * Delivery and the record are one act, so they are one function. A caller
 * cannot perform half of it, and a third console later cannot reintroduce the
 * same gap by reimplementing the easy half.
 */

import type { Customer } from "@muxel/core";
import type { Env } from "./env.js";
import { open as openSealed } from "./crypto.js";
import {
  appendHumanMessage,
  conversationForCustomer,
  getBotById,
  recordWire,
} from "./db/queries.js";
import { resolveMasterKey } from "./secrets.js";
import { TelegramClient, type MediaKind } from "./telegram/api.js";
import { escapeHtml } from "./telegram/format.js";
import { isWebBot } from "./web/channel.js";

export type HumanReplyResult =
  | { ok: true; messageId: string }
  | { ok: false; reason: "no_chat" | "no_bot" | "delivery"; detail?: string };

/** Everything a reply needs, resolved once for both the text and file paths. */
async function routeTo(
  env: Env,
  customer: Customer,
): Promise<
  | { ok: true; conversationId: string; botId: string; chatId: number; client: TelegramClient | null }
  | { ok: false; reason: "no_chat" | "no_bot" }
> {
  const chat = await conversationForCustomer(env, {
    businessId: customer.businessId,
    chatId: customer.chatId,
  });
  if (chat === null) return { ok: false, reason: "no_chat" };

  const bot = await getBotById(env, chat.botId);
  if (bot === null) return { ok: false, reason: "no_bot" };

  // A website visitor has no Telegram to send to. Their reply is only stored,
  // and the open widget collects it on its next poll, so the absence of a
  // client here is a route and not a failure.
  if (await isWebBot(env, chat.botId)) {
    return { ok: true, conversationId: chat.id, botId: chat.botId, chatId: chat.chatId, client: null };
  }
  const token = await openSealed(await resolveMasterKey(env), bot.tokenCiphertext);
  return {
    ok: true,
    conversationId: chat.id,
    botId: chat.botId,
    chatId: chat.chatId,
    client: new TelegramClient(token),
  };
}

/**
 * Sends a person's words to the customer and records them.
 *
 * Sent through the business bot, never the console bot: the customer has never
 * seen the console bot and a message from it reads as a stranger joining the
 * conversation. Recorded as an ordinary assistant turn so the model reads it as
 * context if the chat is handed back, and marked human so the transcript can
 * still say who actually spoke.
 */
export async function sendHumanReply(
  env: Env,
  input: { customer: Customer; text: string },
): Promise<HumanReplyResult> {
  const route = await routeTo(env, input.customer);
  if (!route.ok) return route;

  const reply = input.text.slice(0, 3500);
  let wireId: number | null = null;
  if (route.client !== null) {
    try {
      const sent = await route.client.sendMessage({
        chatId: route.chatId,
        text: escapeHtml(reply),
      });
      wireId = sent.message_id;
    } catch (error) {
      console.error("human reply failed", {
        businessId: input.customer.businessId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: false,
        reason: "delivery",
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const messageId = await appendHumanMessage(env, {
    conversationId: route.conversationId,
    businessId: input.customer.businessId,
    content: reply,
  });
  if (wireId !== null) {
    await recordWire(env, {
      messageId,
      botId: route.botId,
      chatId: route.chatId,
      wireMessageId: wireId,
    }).catch(() => undefined);
  }
  return { ok: true, messageId };
}

/**
 * Sends a file the operator picked, then records that it went.
 *
 * The bytes are forwarded to Telegram and kept nowhere. This project promises
 * a deployment that needs no payment method, and storing customer media would
 * mean R2, so the transcript keeps the filename and the chat keeps the file.
 */
export async function sendHumanMedia(
  env: Env,
  input: { customer: Customer; kind: MediaKind; file: Blob; filename: string; caption: string },
): Promise<HumanReplyResult> {
  const route = await routeTo(env, input.customer);
  if (!route.ok) return route;
  if (route.client === null) {
    return { ok: false, reason: "no_bot", detail: "A website chat cannot receive a file yet." };
  }

  let sentId: number;
  try {
    const sent = await route.client.sendMediaUpload({
      chatId: route.chatId,
      kind: input.kind,
      file: input.file,
      filename: input.filename,
      caption: input.caption,
    });
    sentId = sent.message_id;
  } catch (error) {
    console.error("human media failed", {
      businessId: input.customer.businessId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      reason: "delivery",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const label = input.caption.trim().length > 0 ? input.caption.trim() : input.filename;
  const messageId = await appendHumanMessage(env, {
    conversationId: route.conversationId,
    businessId: input.customer.businessId,
    content: `[${input.kind}] ${label}`,
  });
  await recordWire(env, {
    messageId,
    botId: route.botId,
    chatId: route.chatId,
    wireMessageId: sentId,
  }).catch(() => undefined);
  return { ok: true, messageId };
}

/** The client that can reach a stored message on the other side, if any. */
export async function clientForBot(env: Env, botId: string): Promise<TelegramClient | null> {
  const bot = await getBotById(env, botId);
  if (bot === null) return null;
  if (await isWebBot(env, botId)) return null;
  return new TelegramClient(await openSealed(await resolveMasterKey(env), bot.tokenCiphertext));
}
