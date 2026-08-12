/**
 * Customer facing reply bot.
 *
 * This path is reachable by anyone who can find the bot, so the message body is
 * hostile input. The handler exposes no tools, performs no writes on behalf of
 * the sender beyond their own record and transcript, and frames both retrieved
 * knowledge and remembered facts as reference material rather than instructions.
 */

import type { Bot, Business, ChatTurn, CustomerFact } from "@muxel/core";

import { answerQuestion, handoverReply, MAX_INPUT_CHARS } from "../answer.js";
import {
  appendMessage,
  appendMessageWithMedia,
  getHandover,
  openHandover,
  recordEvent,
  touchCustomer,
  upsertConversation,
} from "../db/queries.js";
import type { Env } from "../env.js";
import { alertOwner } from "../escalation.js";
import { remember, shouldExtract } from "../memory.js";
import { attachmentIn, type Attachment, type TelegramClient, type TelegramUpdate, type TelegramUser } from "./api.js";
import { toTelegramHtml } from "./format.js";

/**
 * How long the answer may take before the customer is told to try again.
 *
 * The reply is produced after the webhook has been acknowledged, and the
 * runtime cancels that work at thirty seconds. A generation that ran past the
 * limit used to take the apology down with it, so the customer heard nothing at
 * all. Giving up first means they always hear something.
 *
 * The clock starts when the update arrives, not when inference starts, so a
 * slow database read or retrieval cannot quietly spend the margin that the
 * apology needs.
 */
const ANSWER_DEADLINE_MS = 22_000;

class DeadlineExceeded extends Error {
  constructor(seconds: number) {
    super(`no answer within ${seconds} seconds`);
    this.name = "DeadlineExceeded";
  }
}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new DeadlineExceeded(Math.round(ms / 1000))), ms);
  });
  return Promise.race([work, expiry]).finally(() => clearTimeout(timer ?? null));
}

/**
 * Keeps the typing indicator alive while the answer is produced.
 *
 * Telegram shows the indicator for about five seconds per call and an answer
 * may take twenty. A single call at the start leaves the chat looking dead for
 * most of the wait, so the indicator is refreshed until the caller stops it.
 * The loop is capped so a forgotten stop cannot outlive the invocation.
 */
function keepTyping(client: TelegramClient, chatId: number): () => void {
  let stopped = false;
  void (async () => {
    for (let round = 0; round < 5 && !stopped; round += 1) {
      await client.sendChatAction(chatId).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 4500));
    }
  })();
  return () => {
    stopped = true;
  };
}

/** Names an attachment for a transcript, where the bytes are not shown. */
function describeAttachment(attachment: Attachment | null): string {
  if (attachment === null) {
    return "";
  }
  return attachment.label.length > 0
    ? `[${attachment.kind}] ${attachment.label}`
    : `[${attachment.kind}]`;
}

function nameOf(sender: TelegramUser | undefined): string {
  if (sender === undefined) {
    return "unknown";
  }
  return sender.first_name ?? sender.username ?? String(sender.id);
}

const APOLOGY = "Sorry, I could not answer that just now. Please try again shortly.";

export async function handleReplyUpdate(
  env: Env,
  client: TelegramClient,
  bot: Bot,
  business: Business,
  update: TelegramUpdate,
): Promise<void> {
  const startedAt = Date.now();
  const message = update.message;
  if (message === undefined) {
    return;
  }

  const text = (message.text ?? message.caption ?? "").trim();
  const attachment = attachmentIn(message);
  if (text.length === 0 && attachment === null) {
    return;
  }

  const chatId = message.chat.id;
  const sender = message.from;

  if (text.startsWith("/start")) {
    await client.sendMessage({
      chatId,
      text: `Hello. Ask me anything about ${business.name}.`,
    });
    return;
  }

  const question = text.slice(0, MAX_INPUT_CHARS);

  let customer: Awaited<ReturnType<typeof touchCustomer>> | null = null;
  let conversationId = "";
  let history: ChatTurn[] = [];
  let facts: CustomerFact[] = [];
  let answer: string;
  let escalating = false;
  let stopTyping: (() => void) | undefined;

  // Everything between here and the send sits inside one try block: a database
  // hiccup while recording the customer must end in the same apology as a
  // failed generation, never in silence.
  try {
    customer =
      sender === undefined
        ? null
        : await touchCustomer(env, {
            businessId: business.id,
            telegramUserId: sender.id,
            chatId,
            displayName: sender.first_name ?? "",
            username: sender.username ?? "",
          });

    if (customer !== null && (await isBlocked(env, customer.id))) {
      return;
    }

    // Started before the remaining work rather than after it, so the customer
    // sees the bot react to their message rather than sit still.
    stopTyping = keepTyping(client, chatId);

    conversationId = await upsertConversation(env, {
      businessId: business.id,
      botId: bot.id,
      chatId,
    });

    // A person is answering this chat, or the customer sent something the
    // assistant cannot read. Either way the turn is recorded and forwarded
    // without a reply: two voices answering one customer is worse than a
    // slower single one, and guessing at a photo is worse than both.
    const handover = await getHandover(env, conversationId);
    const forHuman = handover?.state === "human" || (attachment !== null && text.length === 0);

    if (forHuman) {
      stopTyping();
      await appendMessageWithMedia(env, {
        conversationId,
        businessId: business.id,
        botId: bot.id,
        content: question.length > 0 ? question : describeAttachment(attachment),
        media: attachment,
      });
      if (handover?.state !== "human") {
        await openHandover(env, {
          conversationId,
          businessId: business.id,
          customerId: customer?.id ?? null,
          reason: describeAttachment(attachment),
        }).catch(() => undefined);
        await client
          .sendMessage({ chatId, text: handoverReply(business.locale) })
          .catch(() => undefined);
      }
      await alertOwner(env, {
        businessName: business.name,
        customerName: nameOf(sender),
        customerUsername: sender?.username ?? "",
        question: question.length > 0 ? question : describeAttachment(attachment),
        customerId: customer?.id ?? null,
        duringTakeover: handover?.state === "human",
      }).catch(() => undefined);
      return;
    }

    const result = await withDeadline(
      answerQuestion(env, {
        business,
        conversationId,
        customerId: customer?.id ?? null,
        question,
      }),
      Math.max(ANSWER_DEADLINE_MS - (Date.now() - startedAt), 1),
    );
    answer = result.text;
    escalating = result.escalated;
    history = [...result.history];
    facts = [...result.facts];
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // The customer sees a neutral message, because an upstream error string
    // must not leak configuration into a public chat. The operator sees the
    // real reason in the console, which is the only place they can reach.
    console.error("reply generation failed", {
      businessId: business.id,
      botId: bot.id,
      error: detail,
    });
    await recordEvent(env, {
      businessId: business.id,
      kind: "reply_failed",
      detail: `${question.slice(0, 80)} -> ${detail}`,
    }).catch(() => undefined);
    await client.sendMessage({ chatId, text: APOLOGY });
    return;
  } finally {
    stopTyping?.();
  }

  // The assistant asked for a person. What the customer hears is already the
  // promise rather than the marker; the owner is told once it is on its way.
  if (escalating) {
    await openHandover(env, {
      conversationId,
      businessId: business.id,
      customerId: customer?.id ?? null,
      reason: question,
    }).catch(() => undefined);
  }

  try {
    // The transcript keeps the model's own words. Only the copy the customer
    // reads is converted, so the next turn is not fed its own markup back.
    await client.sendMessage({ chatId, text: toTelegramHtml(answer) });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("reply delivery failed", {
      businessId: business.id,
      botId: bot.id,
      error: detail,
    });
    await recordEvent(env, {
      businessId: business.id,
      kind: "reply_failed",
      detail: `${question.slice(0, 80)} -> delivery: ${detail}`,
    }).catch(() => undefined);
    // The answer may have been rejected rather than undeliverable, so the
    // short plain apology is still worth one attempt.
    await client.sendMessage({ chatId, text: APOLOGY }).catch(() => undefined);
    return;
  }

  await Promise.all([
    appendMessage(env, {
      conversationId,
      businessId: business.id,
      role: "user",
      content: question,
    }),
    appendMessage(env, {
      conversationId,
      businessId: business.id,
      role: "assistant",
      content: answer,
    }),
  ]).catch((error: unknown) => {
    // The customer already has their answer. Bookkeeping failure is the
    // operator's problem and must not read as a failed update.
    console.error("post reply bookkeeping failed", {
      businessId: business.id,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  if (escalating) {
    // After the customer has been answered, because an alert that fails must
    // not leave them waiting on a message that was never sent.
    await alertOwner(env, {
      businessName: business.name,
      customerName: nameOf(sender),
      customerUsername: sender?.username ?? "",
      question,
      customerId: customer?.id ?? null,
    }).catch((error: unknown) => {
      console.error("handover alert failed", {
        businessId: business.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return;
  }

  // Distillation happens after the reply is on its way, and only every few
  // messages. A failure here is invisible to the customer by design.
  if (customer !== null && shouldExtract(customer.messageCount)) {
    try {
      await remember(env, {
        businessId: business.id,
        customerId: customer.id,
        model: business.model,
        turns: [...history, { role: "user", content: question }, { role: "assistant", content: answer }],
        existing: facts,
      });
    } catch (error) {
      console.error("memory extraction failed", {
        businessId: business.id,
        customerId: customer.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** Reports whether the operator has blocked this customer. */
async function isBlocked(env: Env, customerId: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT stage FROM customer WHERE id = ?")
    .bind(customerId)
    .first<{ stage: string }>();
  return row?.stage === "blocked";
}
