/**
 * Handing a question to a person.
 *
 * The assistant answers from the documents it was given, so there will always
 * be questions it should not attempt: a discount nobody wrote down, a complaint,
 * a special order. Guessing at those is the failure that costs a shop a
 * customer, and silence is barely better. So the assistant says a person will
 * follow up, and the person is told, in the console they already have open.
 */

import { open } from "./crypto.js";
import { findOwner, getConsoleBot } from "./db/queries.js";
import type { Env } from "./env.js";
import { peekMasterKey } from "./secrets.js";
import { TelegramClient } from "./telegram/api.js";
import { escapeHtml } from "./telegram/format.js";
import { buildKeyboard, row } from "./telegram/keyboard.js";

/**
 * The exact string the assistant is asked to return when it cannot answer.
 *
 * A sentinel rather than a phrase match: the assistant replies in whatever
 * language the customer wrote in, so looking for "I don't know" would work in
 * English and fail everywhere else.
 */
export const HANDOVER_SENTINEL = "[[HANDOVER]]";

/** Reports whether a completion is the assistant asking for help. */
export function wantsHandover(answer: string): boolean {
  return answer.includes(HANDOVER_SENTINEL);
}

/**
 * Removes the sentinel from a reply that also contained real text.
 *
 * Models are asked to return the sentinel alone and mostly do, but a stray
 * sentence around it must not reach the customer with the marker still in it.
 */
export function stripSentinel(answer: string): string {
  return answer.split(HANDOVER_SENTINEL).join("").trim();
}

export interface AlertInput {
  readonly businessName: string;
  readonly customerName: string;
  /**
   * The customer's Telegram username, without the at sign.
   *
   * A display name is whatever the person typed into their profile, so two
   * customers can share one and neither can be contacted from it. The username
   * is unique and tappable, which is what an operator needs when they want to
   * reach someone outside the bot.
   */
  readonly customerUsername?: string;
  readonly question: string;
  /** Identifies the conversation so the alert can open it directly. */
  readonly customerId: string | null;
  /** Set when a customer writes while a person is already answering them. */
  readonly duringTakeover?: boolean;
}

/** Renders a customer as a name and, when they have one, a tappable handle. */
export function describeCustomer(name: string, username: string | undefined): string {
  const handle = (username ?? "").replace(/^@/, "").trim();
  if (handle.length === 0) {
    return escapeHtml(name);
  }
  return `${escapeHtml(name)} (@${escapeHtml(handle)})`;
}

/**
 * Tells the owner that a conversation needs them.
 *
 * Sent through the console bot, which is the only bot the owner has a private
 * chat with. Failure is swallowed by the caller: an alert that cannot be
 * delivered must not also cost the customer their reply.
 */
export async function alertOwner(env: Env, input: AlertInput): Promise<boolean> {
  const [bot, masterKey, owner] = await Promise.all([
    getConsoleBot(env),
    peekMasterKey(env),
    findOwner(env),
  ]);
  if (bot === null || masterKey === null || owner === null) {
    return false;
  }

  const client = new TelegramClient(await open(masterKey, bot.tokenCiphertext));
  const heading = input.duringTakeover ? "New message" : "A customer needs a person";

  const text = [
    `<b>${heading}</b>`,
    `${escapeHtml(input.businessName)} · ${describeCustomer(input.customerName, input.customerUsername)}`,
    "",
    escapeHtml(input.question.slice(0, 500)),
  ].join("\n");

  const keyboard =
    input.customerId === null
      ? undefined
      : await buildKeyboard(env, [row({ text: "Open conversation", action: "conv", args: [input.customerId] })]);

  await client.sendMessage({ chatId: owner, text, replyMarkup: keyboard });
  return true;
}
