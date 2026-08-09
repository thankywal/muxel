/**
 * Operator console.
 *
 * The console is button driven. Every screen is rendered by editing the message
 * in place rather than sending a new one, so a long session leaves a single
 * message in the chat instead of a wall of menus.
 *
 * Free text and file uploads are only read when a screen has explicitly armed a
 * prompt, except for knowledge documents, which can be sent at any time and
 * land in whichever business was last opened. That pending state and the
 * current business both live in KV keyed by operator, which keeps the handler
 * stateless and lets an abandoned prompt expire on its own.
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
  type Customer,
  type CustomerFact,
  type CustomerStage,
} from "@muxel/core";

import { seal, sha256Hex } from "../crypto.js";
import {
  canAccessBusiness,
  createBot,
  createBusiness,
  findOperator,
  forgetCustomer,
  forgetFacts,
  getAdminBot,
  getBusiness,
  getCustomer,
  listBots,
  listBusinesses,
  listCustomers,
  listDocuments,
  listFacts,
  previousPrompt,
  replaceBotIdentity,
  setBusinessPrompt,
  setCustomerNote,
  setCustomerStage,
  todayUsage,
  updateBusinessModel,
} from "../db/queries.js";
import type { Env } from "../env.js";
import { ingestDocument, MAX_DOCUMENT_BYTES } from "../rag/ingest.js";
import { resolveMasterKey } from "../secrets.js";
import { TelegramClient, type TelegramMessage, type TelegramUpdate } from "./api.js";
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
  { label: "GPT-5.6 Luna", id: "openai/gpt-5.6-luna", requiresProviderKey: true },
  { label: "Claude Sonnet 4.5", id: "anthropic/claude-sonnet-4-5", requiresProviderKey: true },
];

const STAGES: readonly CustomerStage[] = ["new", "lead", "customer", "blocked"];

const PENDING_PREFIX = "pending:";
const CONTEXT_PREFIX = "context:";
const PENDING_TTL_SECONDS = 600;
const CONTEXT_TTL_SECONDS = 86_400;

/** Largest instruction document accepted, so it cannot dominate every prompt. */
const MAX_PROMPT_CHARS = 8000;

interface Pending {
  readonly kind: "business_name" | "bot_token" | "instructions" | "customer_note";
  readonly businessId?: string;
  readonly customerId?: string;
  readonly role?: "admin" | "reply";
  /** Set when replacing the console bot rather than adding a new one. */
  readonly replace?: boolean;
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

/** Remembers which business the operator is working on, for bare file uploads. */
async function setContext(env: Env, userId: number, businessId: string): Promise<void> {
  await env.STATE.put(`${CONTEXT_PREFIX}${userId}`, businessId, {
    expirationTtl: CONTEXT_TTL_SECONDS,
  });
}

function getContext(env: Env, userId: number): Promise<string | null> {
  return env.STATE.get(`${CONTEXT_PREFIX}${userId}`);
}

// Screens ---------------------------------------------------------------------

interface Screen {
  readonly text: string;
  readonly rows: readonly (readonly ButtonSpec[])[];
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}...`;
}

function homeScreen(): Screen {
  return {
    text: ["<b>Muxel console</b>", "", "Manage the businesses and bots in this deployment."].join(
      "\n",
    ),
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
  customerCount: number,
): Screen {
  const modelLabel =
    MODEL_PRESETS.find((preset) => preset.id === business.model)?.label ?? business.model;
  return {
    text: [
      `<b>${escapeHtml(business.name)}</b>`,
      "",
      `Model: ${escapeHtml(modelLabel)}`,
      `Language: ${escapeHtml(business.locale)}`,
      `Bots: ${bots.length}   Documents: ${documentCount}   Customers: ${customerCount}`,
      `Instructions: ${business.systemPrompt.length > 0 ? `${business.systemPrompt.length} characters` : "default"}`,
      "",
      `Today: ${usage.messages} messages, ${usage.inputTokens + usage.outputTokens} tokens`,
    ].join("\n"),
    rows: [
      row(
        { text: "Documents", action: "docs", args: [business.id] },
        { text: "Customers", action: "cust", args: [business.id] },
      ),
      row(
        { text: "Instructions", action: "inst", args: [business.id] },
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
      : bots.map(
          (bot) => `${bot.role === "admin" ? "Console" : "Customer"}: @${escapeHtml(bot.username)}`,
        );
  return {
    text: [`<b>Bots for ${escapeHtml(business.name)}</b>`, "", ...lines].join("\n"),
    rows: [
      row({ text: "Connect customer bot", action: "botadd", args: [business.id] }),
      row({ text: "Replace console bot", action: "botrep", args: [business.id] }),
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
      ? ["Nothing yet."]
      : documents.map(
          (document) =>
            `${escapeHtml(document.filename)} (${document.status}, ${document.chunkCount} chunks)`,
        );
  return {
    text: [
      `<b>Knowledge for ${escapeHtml(business.name)}</b>`,
      "",
      ...lines,
      "",
      "Send a PDF, DOCX, XLSX or text file to this chat to add it.",
    ].join("\n"),
    rows: [row({ text: "Back", action: "biz", args: [business.id] })],
  };
}

function instructionsScreen(business: Business, hasPrevious: boolean): Screen {
  const current =
    business.systemPrompt.length > 0
      ? escapeHtml(truncate(business.systemPrompt, 700))
      : "<i>Using the default instructions.</i>";
  return {
    text: [
      `<b>Instructions for ${escapeHtml(business.name)}</b>`,
      "",
      "Tone, rules and anything the assistant should always know. This is your",
      "own text and is trusted, unlike uploaded documents.",
      "",
      current,
    ].join("\n"),
    rows: [
      row({ text: "Replace", action: "instset", args: [business.id] }),
      ...(hasPrevious ? [row({ text: "Undo last change", action: "instundo", args: [business.id] })] : []),
      ...(business.systemPrompt.length > 0
        ? [row({ text: "Reset to default", action: "instclr", args: [business.id] })]
        : []),
      row({ text: "Back", action: "biz", args: [business.id] }),
    ],
  };
}

function customersScreen(business: Business, customers: readonly Customer[]): Screen {
  if (customers.length === 0) {
    return {
      text: `<b>Customers of ${escapeHtml(business.name)}</b>\n\nNobody has written yet.`,
      rows: [row({ text: "Back", action: "biz", args: [business.id] })],
    };
  }
  return {
    text: [
      `<b>Customers of ${escapeHtml(business.name)}</b>`,
      "",
      `${customers.length} most recent.`,
    ].join("\n"),
    rows: [
      ...customers.map((customer) =>
        row({
          text: `${customer.displayName || customer.username || String(customer.telegramUserId)} · ${customer.stage}`,
          action: "cst",
          args: [customer.id],
        }),
      ),
      row({ text: "Back", action: "biz", args: [business.id] }),
    ],
  };
}

function customerScreen(customer: Customer, facts: readonly CustomerFact[]): Screen {
  const name = customer.displayName || customer.username || String(customer.telegramUserId);
  return {
    text: [
      `<b>${escapeHtml(name)}</b>`,
      customer.username.length > 0 ? `@${escapeHtml(customer.username)}` : "",
      "",
      `Stage: ${customer.stage}   Messages: ${customer.messageCount}`,
      `First seen: ${customer.firstSeen.slice(0, 10)}`,
      customer.note.length > 0 ? `\nNote: ${escapeHtml(truncate(customer.note, 300))}` : "",
      "",
      facts.length > 0 ? "<b>Remembered</b>" : "<i>Nothing remembered yet.</i>",
      ...facts.slice(0, 15).map((fact) => `- ${escapeHtml(fact.fact)}`),
    ]
      .filter((line) => line !== "")
      .join("\n"),
    rows: [
      row({ text: "Add note", action: "cnote", args: [customer.id] }),
      ...STAGES.filter((stage) => stage !== customer.stage).map((stage) =>
        row({ text: `Mark as ${stage}`, action: "cstage", args: [customer.id, stage] }),
      ),
      row({ text: "Forget what is remembered", action: "cwipe", args: [customer.id] }),
      row({ text: "Delete customer", action: "cdel", args: [customer.id] }),
      row({ text: "Back", action: "cust", args: [customer.businessId] }),
    ],
  };
}

function helpScreen(): Screen {
  return {
    text: [
      "<b>Help</b>",
      "",
      "Everything runs inside your own Cloudflare account.",
      "",
      "Open a business, then send a document to this chat to add it to that",
      "business's knowledge.",
      "",
      "Instructions are your own rules for the assistant. Documents are facts it",
      "quotes from. The assistant never treats a document as an instruction.",
    ].join("\n"),
    rows: [row({ text: "Back", action: "home" })],
  };
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

/** Loads a customer after checking the operator may see their business. */
async function customerFor(env: Env, userId: number, customerId: string): Promise<Customer> {
  const customer = await getCustomer(env, customerId);
  await requireAccess(env, userId, customer.businessId);
  return customer;
}

async function businessDetail(env: Env, userId: number, businessId: string): Promise<Screen> {
  await requireAccess(env, userId, businessId);
  await setContext(env, userId, businessId);
  const business = await getBusiness(env, businessId);
  const [bots, usage, documents, customers] = await Promise.all([
    listBots(env, businessId),
    todayUsage(env, businessId),
    listDocuments(env, businessId, 100),
    listCustomers(env, businessId, 100),
  ]);
  return businessScreen(business, bots, usage, documents.length, customers.length);
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

    case "biz":
      return businessDetail(env, userId, requireArg(args, 0));

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

    case "botadd":
    case "botrep": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      const replace = action === "botrep";
      await setPending(env, userId, {
        kind: "bot_token",
        businessId,
        role: replace ? "admin" : "reply",
        replace,
      });
      return {
        text: [
          replace ? "<b>Replace console bot</b>" : "<b>Connect a customer bot</b>",
          "",
          "Create a bot with @BotFather, then send its token here.",
          "The token is encrypted before storage and the message you send is",
          "deleted straight away.",
          replace
            ? "\nThe current console bot stops responding as soon as this succeeds,\nso continue in the new bot."
            : "",
        ]
          .filter((line) => line !== "")
          .join("\n"),
        rows: [row({ text: "Cancel", action: "bots", args: [businessId] })],
      };
    }

    case "docs": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      await setContext(env, userId, businessId);
      const [business, documents] = await Promise.all([
        getBusiness(env, businessId),
        listDocuments(env, businessId),
      ]);
      return documentsScreen(business, documents);
    }

    case "inst": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      const [business, previous] = await Promise.all([
        getBusiness(env, businessId),
        previousPrompt(env, businessId),
      ]);
      return instructionsScreen(business, previous !== null);
    }

    case "instset": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      await setPending(env, userId, { kind: "instructions", businessId });
      return {
        text: [
          "<b>Replace instructions</b>",
          "",
          "Send the new instructions as a message, or send a .md or .txt file.",
          `Up to ${MAX_PROMPT_CHARS} characters.`,
        ].join("\n"),
        rows: [row({ text: "Cancel", action: "inst", args: [businessId] })],
      };
    }

    case "instundo": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      const previous = await previousPrompt(env, businessId);
      if (previous !== null) {
        await setBusinessPrompt(env, businessId, previous);
      }
      return screenFor(env, userId, "inst", [businessId]);
    }

    case "instclr": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      await setBusinessPrompt(env, businessId, "");
      return screenFor(env, userId, "inst", [businessId]);
    }

    case "cust": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      const [business, customers] = await Promise.all([
        getBusiness(env, businessId),
        listCustomers(env, businessId),
      ]);
      return customersScreen(business, customers);
    }

    case "cst": {
      const customer = await customerFor(env, userId, requireArg(args, 0));
      return customerScreen(customer, await listFacts(env, customer.id));
    }

    case "cnote": {
      const customer = await customerFor(env, userId, requireArg(args, 0));
      await setPending(env, userId, { kind: "customer_note", customerId: customer.id });
      return {
        text: "<b>Add note</b>\n\nSend the note as a message. It replaces the current one.",
        rows: [row({ text: "Cancel", action: "cst", args: [customer.id] })],
      };
    }

    case "cstage": {
      const customer = await customerFor(env, userId, requireArg(args, 0));
      const stage = requireArg(args, 1) as CustomerStage;
      if (STAGES.includes(stage)) {
        await setCustomerStage(env, customer.id, stage);
      }
      return screenFor(env, userId, "cst", [customer.id]);
    }

    case "cwipe": {
      const customer = await customerFor(env, userId, requireArg(args, 0));
      await forgetFacts(env, customer.id);
      return screenFor(env, userId, "cst", [customer.id]);
    }

    case "cdel": {
      const customer = await customerFor(env, userId, requireArg(args, 0));
      await forgetCustomer(env, customer.id);
      return screenFor(env, userId, "cust", [customer.businessId]);
    }

    default:
      return homeScreen();
  }
}

// Entry point -----------------------------------------------------------------

export async function handleAdminUpdate(
  env: Env,
  client: TelegramClient,
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

  // Ownership is installed during setup from OWNER_TELEGRAM_ID, so by the time
  // a message can reach this handler the operator table is already populated.
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
    await handlePendingInput(env, client, { chatId, userId, message, pending, origin });
    return;
  }

  // A document sent with no prompt armed is knowledge for the business the
  // operator last opened.
  if (message.document !== undefined) {
    await handleKnowledgeUpload(env, client, { chatId, userId, message });
    return;
  }

  await render(env, client, { chatId }, homeScreen());
}

/** Downloads a file the operator sent, refusing anything oversized. */
async function download(
  client: TelegramClient,
  message: TelegramMessage,
): Promise<{ body: ArrayBuffer; filename: string; contentType: string }> {
  const document = message.document;
  if (document === undefined) {
    throw new Error("message carries no document");
  }
  if ((document.file_size ?? 0) > MAX_DOCUMENT_BYTES) {
    throw new Error("that file is too large");
  }
  const link = await client.getFileLink(document.file_id);
  const response = await fetch(link);
  if (!response.ok) {
    throw new Error(`could not download the file (${response.status})`);
  }
  return {
    body: await response.arrayBuffer(),
    filename: document.file_name ?? "upload",
    contentType: document.mime_type ?? "application/octet-stream",
  };
}

async function handleKnowledgeUpload(
  env: Env,
  client: TelegramClient,
  input: { chatId: number; userId: number; message: TelegramMessage },
): Promise<void> {
  const businessId = await getContext(env, input.userId);
  if (businessId === null) {
    await client.sendMessage({
      chatId: input.chatId,
      text: "Open a business first, then send the file again.",
    });
    await render(env, client, { chatId: input.chatId }, homeScreen());
    return;
  }
  if (!(await canAccessBusiness(env, input.userId, businessId))) {
    return;
  }

  const notice = await client.sendMessage({
    chatId: input.chatId,
    text: "Reading the file...",
  });

  try {
    const file = await download(client, input.message);
    const result = await ingestDocument(env, {
      businessId,
      filename: file.filename,
      contentType: file.contentType,
      body: file.body,
    });
    await client.editMessageText({
      chatId: input.chatId,
      messageId: notice.message_id,
      text: `Added <b>${escapeHtml(file.filename)}</b> as ${result.chunkCount} chunks.`,
    });
  } catch (error) {
    console.error("knowledge upload failed", {
      businessId,
      error: error instanceof Error ? error.message : String(error),
    });
    await client.editMessageText({
      chatId: input.chatId,
      messageId: notice.message_id,
      text: `Could not add that file: ${escapeHtml(
        error instanceof Error ? error.message : "unknown error",
      )}`,
    });
  }

  await render(env, client, { chatId: input.chatId }, await screenFor(env, input.userId, "docs", [businessId]));
}

async function handlePendingInput(
  env: Env,
  client: TelegramClient,
  input: {
    chatId: number;
    userId: number;
    message: TelegramMessage;
    pending: Pending;
    origin: string;
  },
): Promise<void> {
  const { pending, userId, chatId } = input;
  const text = (input.message.text ?? "").trim();

  if (pending.kind === "business_name") {
    if (text.length === 0 || text.length > 80) {
      await client.sendMessage({ chatId, text: "Send a name between 1 and 80 characters." });
      return;
    }
    const business = await createBusiness(env, {
      name: text,
      locale: env.BUSINESS_LOCALE?.trim() || "en",
      model: env.DEFAULT_MODEL,
    });
    await render(env, client, { chatId }, await businessDetail(env, userId, business.id));
    return;
  }

  if (pending.kind === "customer_note") {
    const customerId = pending.customerId;
    if (customerId === undefined) {
      return;
    }
    await customerFor(env, userId, customerId);
    await setCustomerNote(env, customerId, text.slice(0, 1000));
    await render(env, client, { chatId }, await screenFor(env, userId, "cst", [customerId]));
    return;
  }

  if (pending.kind === "instructions") {
    const businessId = pending.businessId;
    if (businessId === undefined) {
      return;
    }
    await requireAccess(env, userId, businessId);

    let prompt = text;
    if (input.message.document !== undefined) {
      try {
        const file = await download(client, input.message);
        prompt = new TextDecoder().decode(file.body).trim();
      } catch (error) {
        await client.sendMessage({
          chatId,
          text: `Could not read that file: ${error instanceof Error ? error.message : "unknown error"}`,
        });
        return;
      }
    }
    if (prompt.length === 0) {
      await client.sendMessage({ chatId, text: "Nothing to save." });
      return;
    }
    await setBusinessPrompt(env, businessId, prompt.slice(0, MAX_PROMPT_CHARS));
    await render(env, client, { chatId }, await screenFor(env, userId, "inst", [businessId]));
    return;
  }

  if (pending.kind === "bot_token") {
    const businessId = pending.businessId;
    if (businessId === undefined) {
      return;
    }
    await requireAccess(env, userId, businessId);

    // Remove the credential from the transcript before doing anything slow.
    await client.deleteMessage({ chatId, messageId: input.message.message_id });

    const incoming = new TelegramClient(text);
    let username: string;
    try {
      username = (await incoming.getMe()).username ?? "unknown";
    } catch {
      await client.sendMessage({ chatId, text: "Telegram rejected that token." });
      return;
    }

    const webhookPath = generateId(24);
    const webhookSecret = generateShortId() + generateShortId();
    const sealed = await seal(await resolveMasterKey(env), text);
    const webhookSecretHash = await sha256Hex(webhookSecret);

    if (pending.replace === true) {
      const existing = await getAdminBot(env);
      if (existing === null) {
        await client.sendMessage({ chatId, text: "There is no console bot to replace." });
        return;
      }
      // Stop the old bot first so the two never answer the same operator.
      await client.deleteWebhook().catch(() => undefined);
      await replaceBotIdentity(env, {
        botId: existing.id,
        username,
        tokenCiphertext: sealed,
        webhookPath,
        webhookSecretHash,
      });
    } else {
      await createBot(env, {
        businessId,
        role: pending.role ?? "reply",
        username,
        webhookPath,
        tokenCiphertext: sealed,
        webhookSecretHash,
      });
    }

    await incoming.setWebhook({
      url: `${input.origin}/tg/${webhookPath}`,
      secretToken: webhookSecret,
    });

    if (pending.replace === true) {
      // The old bot is already detached, so this goes out through the new one.
      await incoming.sendMessage({
        chatId,
        text: `Console moved to @${username}. Send /start here to continue.`,
      });
      return;
    }

    await render(env, client, { chatId }, await screenFor(env, userId, "bots", [businessId]));
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
