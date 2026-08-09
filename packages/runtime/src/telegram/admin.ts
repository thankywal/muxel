/**
 * Operator console.
 *
 * The console is button driven. Every screen is rendered by editing the message
 * in place rather than sending a new one, so a long session leaves a single
 * message in the chat instead of a wall of menus.
 *
 * Free text is only read when a screen has explicitly armed a prompt. That
 * pending state lives in KV keyed by operator, which keeps the handler
 * stateless and lets a prompt expire on its own.
 */

import {
  callbackRefKey,
  decodeCallback,
  generateId,
  generateShortId,
  isCallbackRef,
  isMuxelError,
  type Bot,
  type Business,
} from "@muxel/core";

import { seal, sha256Hex } from "../crypto.js";
import {
  addOperator,
  canAccessBusiness,
  countOperators,
  createBot,
  createBusiness,
  findOperator,
  getBusiness,
  listBots,
  listBusinesses,
  listDocuments,
  todayUsage,
  updateBusinessModel,
} from "../db/queries.js";
import type { Env } from "../env.js";
import { TelegramClient, type TelegramUpdate } from "./api.js";
import { buildKeyboard, resolveSpilled, row, type ButtonSpec } from "./keyboard.js";

export interface ModelPreset {
  readonly label: string;
  readonly id: string;
  /**
   * Whether the operator must supply a provider key before this model works.
   *
   * A Cloudflare token reaches Workers AI models and nothing else. For any
   * other provider the gateway forwards that token upstream, where it is
   * rejected. Those models need a key stored in the gateway or unified billing
   * credit, so the console marks them rather than letting an operator select a
   * model that will fail on the first customer message.
   */
  readonly requiresProviderKey: boolean;
}

/**
 * Selectable models, addressed by index so callback payloads stay short.
 *
 * Ordered cheapest first. Costs below are measured against a retrieval reply of
 * roughly 2,000 input tokens, using the completion lengths these models
 * actually produced rather than the length of the visible answer.
 */
export const MODEL_PRESETS: readonly ModelPreset[] = [
  // About 0.33 US cents per thousand replies, and roughly 330 replies a day sit
  // inside the free daily allowance.
  {
    label: "Gemma 4 26B",
    id: "workers-ai/@cf/google/gemma-4-26b-a4b-it",
    requiresProviderKey: false,
  },
  // Terser and a little faster, about 2.6 times the cost of Gemma 4.
  {
    label: "Llama 3.3 70B",
    id: "workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    requiresProviderKey: false,
  },
  {
    label: "GPT-5.6 Luna",
    id: "openai/gpt-5.6-luna",
    requiresProviderKey: true,
  },
  {
    label: "Claude Sonnet 4.5",
    id: "anthropic/claude-sonnet-4-5",
    requiresProviderKey: true,
  },
];

const PENDING_PREFIX = "pending:";
const PENDING_TTL_SECONDS = 600;
const CLAIM_KEY = "bootstrap:claim";

interface Pending {
  readonly kind: "business_name" | "bot_token";
  readonly businessId?: string;
  readonly role?: "admin" | "reply";
}

async function setPending(env: Env, userId: number, pending: Pending): Promise<void> {
  await env.STATE.put(`${PENDING_PREFIX}${userId}`, JSON.stringify(pending), {
    expirationTtl: PENDING_TTL_SECONDS,
  });
}

async function takePending(env: Env, userId: number): Promise<Pending | null> {
  const key = `${PENDING_PREFIX}${userId}`;
  const raw = await env.STATE.get(key);
  if (raw === null) {
    return null;
  }
  await env.STATE.delete(key);
  return JSON.parse(raw) as Pending;
}

// Screens ---------------------------------------------------------------------

interface Screen {
  readonly text: string;
  readonly rows: readonly (readonly ButtonSpec[])[];
}

function homeScreen(): Screen {
  return {
    text: [
      "<b>Muxel console</b>",
      "",
      "Manage the businesses and bots running in this deployment.",
    ].join("\n"),
    rows: [
      row({ text: "Businesses", action: "bizls" }),
      row({ text: "Add business", action: "bizadd" }),
      row({ text: "Help", action: "help" }),
    ],
  };
}

function businessListScreen(businesses: readonly Business[]): Screen {
  if (businesses.length === 0) {
    return {
      text: "<b>Businesses</b>\n\nNo businesses yet. Add one to get started.",
      rows: [row({ text: "Add business", action: "bizadd" }), row({ text: "Back", action: "home" })],
    };
  }
  return {
    text: `<b>Businesses</b>\n\n${businesses.length} configured.`,
    rows: [
      ...businesses.map((business) =>
        row({ text: business.name, action: "biz", args: [business.id] }),
      ),
      row({ text: "Add business", action: "bizadd" }),
      row({ text: "Back", action: "home" }),
    ],
  };
}

function businessScreen(
  business: Business,
  bots: readonly Bot[],
  usage: { messages: number; inputTokens: number; outputTokens: number },
  documentCount: number,
): Screen {
  const modelLabel =
    MODEL_PRESETS.find((preset) => preset.id === business.model)?.label ?? business.model;
  return {
    text: [
      `<b>${escapeHtml(business.name)}</b>`,
      "",
      `Model: ${escapeHtml(modelLabel)}`,
      `Language: ${escapeHtml(business.locale)}`,
      `Bots: ${bots.length}`,
      `Documents: ${documentCount}`,
      "",
      `Today: ${usage.messages} messages, ${usage.inputTokens + usage.outputTokens} tokens`,
    ].join("\n"),
    rows: [
      row(
        { text: "Documents", action: "docs", args: [business.id] },
        { text: "Bots", action: "bots", args: [business.id] },
      ),
      row({ text: "Change model", action: "mdl", args: [business.id] }),
      row({ text: "Back", action: "bizls" }),
    ],
  };
}

function modelScreen(business: Business): Screen {
  return {
    text: [
      `<b>Model for ${escapeHtml(business.name)}</b>`,
      "",
      "Pick the model that answers customers.",
      "",
      "Models marked with a key need a provider key stored in your AI Gateway.",
      "Your Cloudflare login on its own covers the unmarked ones.",
    ].join("\n"),
    rows: [
      ...MODEL_PRESETS.map((preset, index) => {
        const marks = [
          preset.id === business.model ? "current" : null,
          preset.requiresProviderKey ? "needs key" : null,
        ].filter((mark) => mark !== null);
        return row({
          text: marks.length > 0 ? `${preset.label} (${marks.join(", ")})` : preset.label,
          action: "setmdl",
          args: [business.id, String(index)],
        });
      }),
      row({ text: "Back", action: "biz", args: [business.id] }),
    ],
  };
}

function botsScreen(business: Business, bots: readonly Bot[]): Screen {
  const lines =
    bots.length === 0
      ? ["No bots connected yet."]
      : bots.map((bot) => `${bot.role === "admin" ? "Console" : "Customer"}: @${escapeHtml(bot.username)}`);
  return {
    text: [`<b>Bots for ${escapeHtml(business.name)}</b>`, "", ...lines].join("\n"),
    rows: [
      row({ text: "Connect customer bot", action: "botadd", args: [business.id, "reply"] }),
      row({ text: "Back", action: "biz", args: [business.id] }),
    ],
  };
}

function documentsScreen(
  business: Business,
  documents: readonly { filename: string; status: string; chunkCount: number }[],
): Screen {
  const lines =
    documents.length === 0
      ? ["No documents yet. Send a PDF, DOCX or XLSX to this chat to add one."]
      : documents.map(
          (document) =>
            `${escapeHtml(document.filename)} (${document.status}, ${document.chunkCount} chunks)`,
        );
  return {
    text: [`<b>Knowledge for ${escapeHtml(business.name)}</b>`, "", ...lines].join("\n"),
    rows: [row({ text: "Back", action: "biz", args: [business.id] })],
  };
}

function helpScreen(): Screen {
  return {
    text: [
      "<b>Help</b>",
      "",
      "Everything runs inside your own Cloudflare account.",
      "",
      "Send a document to this chat to add it to the knowledge base of the",
      "business you last opened.",
    ].join("\n"),
    rows: [row({ text: "Back", action: "home" })],
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Dispatch --------------------------------------------------------------------

async function render(
  env: Env,
  client: TelegramClient,
  target: { chatId: number; messageId?: number },
  screen: Screen,
): Promise<void> {
  const replyMarkup = await buildKeyboard(env, screen.rows);
  if (target.messageId === undefined) {
    await client.sendMessage({ chatId: target.chatId, text: screen.text, replyMarkup });
    return;
  }
  await client.editMessageText({
    chatId: target.chatId,
    messageId: target.messageId,
    text: screen.text,
    replyMarkup,
  });
}

async function screenFor(
  env: Env,
  userId: number,
  action: string,
  args: readonly string[],
): Promise<Screen> {
  switch (action) {
    case "home":
      return homeScreen();

    case "help":
      return helpScreen();

    case "bizls":
      return businessListScreen(await listBusinesses(env, userId));

    case "bizadd":
      await setPending(env, userId, { kind: "business_name" });
      return {
        text: "<b>Add business</b>\n\nSend the business name as a message.",
        rows: [row({ text: "Cancel", action: "home" })],
      };

    case "biz": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      const business = await getBusiness(env, businessId);
      const [bots, usage, documents] = await Promise.all([
        listBots(env, businessId),
        todayUsage(env, businessId),
        listDocuments(env, businessId, 100),
      ]);
      return businessScreen(business, bots, usage, documents.length);
    }

    case "mdl": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      return modelScreen(await getBusiness(env, businessId));
    }

    case "setmdl": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      const preset = MODEL_PRESETS[Number(requireArg(args, 1))];
      if (preset !== undefined) {
        await updateBusinessModel(env, businessId, preset.id);
      }
      return modelScreen(await getBusiness(env, businessId));
    }

    case "bots": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      const [business, bots] = await Promise.all([
        getBusiness(env, businessId),
        listBots(env, businessId),
      ]);
      return botsScreen(business, bots);
    }

    case "botadd": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      const role = requireArg(args, 1) === "admin" ? "admin" : "reply";
      await setPending(env, userId, { kind: "bot_token", businessId, role });
      return {
        text: [
          "<b>Connect a bot</b>",
          "",
          "Create a bot with @BotFather, then send its token here.",
          "The token is encrypted before storage and the message you send is",
          "deleted straight away.",
        ].join("\n"),
        rows: [row({ text: "Cancel", action: "bots", args: [businessId] })],
      };
    }

    case "docs": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      const [business, documents] = await Promise.all([
        getBusiness(env, businessId),
        listDocuments(env, businessId),
      ]);
      return documentsScreen(business, documents);
    }

    default:
      return homeScreen();
  }
}

function requireArg(args: readonly string[], index: number): string {
  const value = args[index];
  if (value === undefined) {
    throw new Error(`missing callback argument at position ${index}`);
  }
  return value;
}

async function requireAccess(env: Env, userId: number, businessId: string): Promise<void> {
  if (!(await canAccessBusiness(env, userId, businessId))) {
    throw new Error("operator is not permitted to access this business");
  }
}

// Entry point -----------------------------------------------------------------

export async function handleAdminUpdate(
  env: Env,
  client: TelegramClient,
  bot: Bot,
  update: TelegramUpdate,
  origin: string,
): Promise<void> {
  const callback = update.callback_query;
  if (callback !== undefined) {
    await handleCallback(env, client, callback);
    return;
  }

  const message = update.message;
  if (message?.from === undefined) {
    return;
  }
  const userId = message.from.id;
  const chatId = message.chat.id;
  const text = (message.text ?? "").trim();

  // Bootstrap. The first person to present the claim code becomes the owner,
  // which proves control of the Telegram account rather than trusting a number
  // typed into a form.
  if (text.startsWith("/claim")) {
    await handleClaim(env, client, { chatId, userId, text });
    return;
  }

  const operator = await findOperator(env, userId);
  if (operator === null) {
    await client.sendMessage({
      chatId,
      text: "This console is private. Ask the owner to grant you access.",
    });
    return;
  }

  const pending = await takePending(env, userId);
  if (pending !== null) {
    await handlePendingInput(env, client, { chatId, userId, message, pending, origin, bot });
    return;
  }

  await render(env, client, { chatId }, homeScreen());
}

async function handleClaim(
  env: Env,
  client: TelegramClient,
  input: { chatId: number; userId: number; text: string },
): Promise<void> {
  if ((await countOperators(env)) > 0) {
    await client.sendMessage({
      chatId: input.chatId,
      text: "This deployment already has an owner.",
    });
    return;
  }
  const supplied = input.text.split(/\s+/)[1] ?? "";
  const expected = await env.STATE.get(CLAIM_KEY);
  if (expected === null) {
    await client.sendMessage({
      chatId: input.chatId,
      text: "No claim code is active. Run muxel claim to issue one.",
    });
    return;
  }
  if (supplied !== expected) {
    await client.sendMessage({ chatId: input.chatId, text: "That claim code is not valid." });
    return;
  }
  await addOperator(env, { telegramUserId: input.userId, role: "owner" });
  await env.STATE.delete(CLAIM_KEY);
  await render(env, client, { chatId: input.chatId }, homeScreen());
}

async function handlePendingInput(
  env: Env,
  client: TelegramClient,
  input: {
    chatId: number;
    userId: number;
    message: NonNullable<TelegramUpdate["message"]>;
    pending: Pending;
    origin: string;
    bot: Bot;
  },
): Promise<void> {
  const text = (input.message.text ?? "").trim();

  if (input.pending.kind === "business_name") {
    if (text.length === 0 || text.length > 80) {
      await client.sendMessage({ chatId: input.chatId, text: "Send a name between 1 and 80 characters." });
      return;
    }
    const business = await createBusiness(env, {
      name: text,
      locale: "my",
      model: env.DEFAULT_MODEL,
    });
    await render(env, client, { chatId: input.chatId }, await screenFor(env, input.userId, "biz", [business.id]));
    return;
  }

  if (input.pending.kind === "bot_token") {
    const businessId = input.pending.businessId;
    if (businessId === undefined) {
      return;
    }
    // Remove the credential from the transcript before doing anything slow.
    await client.deleteMessage({ chatId: input.chatId, messageId: input.message.message_id });

    let username: string;
    const incoming = new TelegramClient(text);
    try {
      const me = await incoming.getMe();
      username = me.username ?? "unknown";
    } catch {
      await client.sendMessage({ chatId: input.chatId, text: "Telegram rejected that token." });
      return;
    }

    const webhookPath = generateId(24);
    const webhookSecret = generateShortId() + generateShortId();
    await createBot(env, {
      businessId,
      role: input.pending.role ?? "reply",
      username,
      webhookPath,
      tokenCiphertext: await seal(env.MASTER_KEY, text),
      webhookSecretHash: await sha256Hex(webhookSecret),
    });
    await incoming.setWebhook({
      url: `${input.origin}/tg/${webhookPath}`,
      secretToken: webhookSecret,
    });

    await render(
      env,
      client,
      { chatId: input.chatId },
      await screenFor(env, input.userId, "bots", [businessId]),
    );
  }
}

async function handleCallback(
  env: Env,
  client: TelegramClient,
  callback: NonNullable<TelegramUpdate["callback_query"]>,
): Promise<void> {
  // Acknowledge first so the button stops spinning even if the work below is
  // slow or fails.
  await client.answerCallbackQuery({ id: callback.id });

  const operator = await findOperator(env, callback.from.id);
  if (operator === null) {
    return;
  }
  if (callback.data === undefined || callback.message === undefined) {
    return;
  }

  try {
    let decoded = decodeCallback(callback.data);
    if (isCallbackRef(decoded)) {
      const resolved = await resolveSpilled(env, callbackRefKey(decoded));
      if (resolved === null) {
        await client.answerCallbackQuery({ id: callback.id, text: "This menu expired." });
        await render(env, client, { chatId: callback.message.chat.id }, homeScreen());
        return;
      }
      decoded = resolved;
    }

    const screen = await screenFor(env, callback.from.id, decoded.action, decoded.args);
    await render(
      env,
      client,
      { chatId: callback.message.chat.id, messageId: callback.message.message_id },
      screen,
    );
  } catch (error) {
    console.error("admin callback failed", {
      operator: callback.from.id,
      code: isMuxelError(error) ? error.code : "unknown",
      error: error instanceof Error ? error.message : String(error),
    });
    await client.answerCallbackQuery({ id: callback.id, text: "That action could not complete." });
  }
}
