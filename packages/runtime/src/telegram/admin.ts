/**
 * Operator console.
 *
 * The console is button driven and rendered in the operator's own language.
 * Every screen edits the message in place rather than sending a new one, so a
 * long session leaves a single message in the chat instead of a wall of menus.
 *
 * Free text and files are only read when a screen has armed a prompt, or when a
 * business is open and a file arrives. Both the pending prompt and the open
 * business live in KV keyed by operator, which keeps the handler stateless and
 * lets an abandoned prompt expire on its own.
 */

import {
  callbackRefKey,
  decodeCallback,
  generateId,
  generateShortId,
  isCallbackRef,
  isMuxelError,
  type Business,
  type Customer,
  type CustomerFact,
  type CustomerStage,
} from "@muxel/core";

import {
  accountUsage,
  FREE_ALLOWANCE,
  repliesRemaining,
} from "../cloudflare/usage.js";
import { open as openSealed, seal, sha256Hex } from "../crypto.js";
import {
  canAccessBusiness,
  createBot,
  createBusiness,
  deleteBusiness,
  findOperator,
  forgetCustomer,
  forgetFacts,
  getConsoleBot,
  getBusiness,
  getCustomer,
  getOperatorLocale,
  listBots,
  listBusinesses,
  listCustomers,
  listDocuments,
  listEvents,
  listFacts,
  previousPrompt,
  putConsoleBot,
  setBusinessPrompt,
  setCustomerNote,
  setCustomerStage,
  setOperatorLocale,
  appendHumanMessage,
  conversationForCustomer,
  endHandover,
  getBotById,
  getMedia,
  getHandover,
  listHandovers,
  takeOverConversation,
  todayUsage,
  todayUsageAll,
  transcript,
  type TranscriptTurn,
  updateBusinessModel,
} from "../db/queries.js";
import type { Env } from "../env.js";
import {
  ingestDocument,
  MAX_DOCUMENT_BYTES,
  removeDocument,
  syncOwnerUpdates,
} from "../rag/ingest.js";
import { describeCustomer } from "../escalation.js";
import {
  createChannel,
  getChannelForBusiness,
  isWebBot,
  updateChannel,
} from "../web/channel.js";
import { productsView, upsertCorrection, type ProductEntry } from "../products.js";
import {
  hasPendingExtraction,
  markExtractionPending,
  OWNER_UPDATES_FILENAME,
  pendingExtractions,
  runExtraction,
} from "../rag/extract.js";
import { resolveMasterKey } from "../secrets.js";
import { ORIGIN_KEY } from "../setup.js";
import { findSkill, matchSkill, SKILLS } from "./skills.js";
import { versionStatus } from "../updates.js";
import { UPSTREAM_REPO } from "../version.js";
import { isLocale, LOCALE_NAMES, LOCALES, t, type Locale, type MessageKey } from "./i18n.js";
import {
  TelegramClient,
  type MediaKind,
  type TelegramMessage,
  type TelegramUpdate,
} from "./api.js";
import { buildKeyboard, resolveSpilled, row, type ButtonSpec } from "./keyboard.js";

export interface ModelPreset {
  readonly label: string;
  readonly id: string;
  /**
   * Whether the operator must supply a provider key before this model works.
   *
   * A Cloudflare token reaches Workers AI models and nothing else. For any
   * other provider the gateway forwards that token upstream, where it is
   * rejected, so the console marks those rather than letting an operator select
   * a model that will fail on the first customer message.
   */
  readonly requiresProviderKey: boolean;
}

/** Selectable models, cheapest first, addressed by index to keep payloads short. */
export const MODEL_PRESETS: readonly ModelPreset[] = [
  {
    label: "Gemma 4 26B",
    id: "workers-ai/@cf/google/gemma-4-26b-a4b-it",
    requiresProviderKey: false,
  },
  {
    label: "Llama 3.3 70B",
    id: "workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    requiresProviderKey: false,
  },
  { label: "GPT-5.6 Luna", id: "openai/gpt-5.6-luna", requiresProviderKey: true },
  { label: "Claude Sonnet 4.5", id: "anthropic/claude-sonnet-4-5", requiresProviderKey: true },
];

/**
 * Colours offered for the widget.
 *
 * A list rather than a free text hex field, because a shop owner on a phone
 * types a colour code wrong more often than right, and one that fails silently
 * leaves a widget in the default blue with no explanation. Text on the bubble
 * is derived from the choice, so no second question has to be asked.
 */
export const WIDGET_COLOURS: readonly { hex: string; label: string; swatch: string }[] = [
  { hex: "#2563eb", label: "Blue", swatch: "\u{1F535}" },
  { hex: "#16a34a", label: "Green", swatch: "\u{1F7E2}" },
  { hex: "#dc2626", label: "Red", swatch: "\u{1F534}" },
  { hex: "#ea580c", label: "Orange", swatch: "\u{1F7E0}" },
  { hex: "#7c3aed", label: "Purple", swatch: "\u{1F7E3}" },
  { hex: "#111827", label: "Black", swatch: "\u{26AB}" },
];

const STAGES: readonly CustomerStage[] = ["new", "lead", "customer", "blocked"];
const STAGE_KEYS: Record<CustomerStage, MessageKey> = {
  new: "stageNew",
  lead: "stageLead",
  customer: "stageCustomer",
  blocked: "stageBlocked",
};

const PENDING_PREFIX = "pending:";
const CONTEXT_PREFIX = "context:";
const PENDING_TTL_SECONDS = 600;
const CONTEXT_TTL_SECONDS = 86_400;

/** Largest instruction document accepted, so it cannot dominate every prompt. */
const MAX_PROMPT_CHARS = 8000;

/** Screens list at most this many rows, keeping a keyboard usable on a phone. */
const LIST_LIMIT = 12;

type PendingKind =
  | "new_business"
  | "console_bot"
  | "instructions"
  | "customer_note"
  | "manual_product"
  | "product_fix"
  | "web_greeting"
  | "web_domains"
  | "data_file"
  | "human_reply";

interface Pending {
  readonly kind: PendingKind;
  readonly businessId?: string;
  readonly customerId?: string;
  readonly role?: "admin" | "reply";
  readonly replace?: boolean;
  readonly productKey?: string;
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

async function setContext(env: Env, userId: number, businessId: string): Promise<void> {
  await env.STATE.put(`${CONTEXT_PREFIX}${userId}`, businessId, {
    expirationTtl: CONTEXT_TTL_SECONDS,
  });
}

function getContext(env: Env, userId: number): Promise<string | null> {
  return env.STATE.get(`${CONTEXT_PREFIX}${userId}`);
}

async function localeFor(env: Env, userId: number): Promise<Locale> {
  const stored = await getOperatorLocale(env, userId);
  return stored !== null && isLocale(stored) ? stored : "en";
}

// Rendering helpers -------------------------------------------------------------

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

/** Rounds a neuron figure to something readable without losing small values. */
function round(value: number): string {
  return value >= 100 ? String(Math.round(value)) : value.toFixed(1);
}

/** Abbreviates large counts so a usage line fits on one row of a phone. */
function formatCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return String(value);
}

/**
 * Renders a figure against its allowance.
 *
 * The percentage is what an operator actually reads, and the raw pair is kept
 * beside it so the number stays checkable against the Cloudflare dashboard.
 */
function meter(used: number, allowance: number): string {
  const percent = allowance <= 0 ? 0 : (used / allowance) * 100;
  const shown = percent > 0 && percent < 0.1 ? "<0.1" : percent.toFixed(1);
  return `${formatCount(Math.round(used))} / ${formatCount(allowance)}  (${shown}%)`;
}

/** Drops the vendor prefix so a model id fits beside its usage figure. */
function shortModel(model: string): string {
  const parts = model.split("/");
  return parts[parts.length - 1] ?? model;
}

/**
 * Renders a stored timestamp as a date and a time.
 *
 * A time alone reads as "today" and a transcript spans days, so a reply that
 * arrived last week looked like one from an hour ago. Seconds and the year are
 * dropped because neither settles anything an operator is deciding.
 */
function stamp(isoUtc: string): string {
  return `${isoUtc.slice(5, 10)} ${isoUtc.slice(11, 16)}`;
}

/** Marks an attachment in a transcript line, where the file itself cannot go. */
function mediaIcon(kind: string): string {
  const icons: Record<string, string> = {
    photo: "🖼",
    video: "🎬",
    animation: "🎞",
    sticker: "🙂",
    voice: "🎤",
    audio: "🎵",
    document: "📎",
  };
  return icons[kind] ?? "📎";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Where this deployment answers, as recorded during setup.
 *
 * The console has no request of its own to read an address from: it is driven
 * by Telegram callbacks. The address is written to KV on the first setup and
 * kept there for exactly this kind of question.
 */
async function deploymentOrigin(env: Env): Promise<string> {
  return (await env.STATE.get(ORIGIN_KEY)) ?? "https://your-worker.workers.dev";
}

function backTo(locale: Locale, action: string, args: string[] = []): readonly ButtonSpec[] {
  return row({ text: t(locale, "back"), action, args });
}

/** Builds a two option confirmation screen. */
function confirmScreen(
  locale: Locale,
  question: string,
  confirm: { action: string; args: string[] },
  cancel: { action: string; args: string[] },
): Screen {
  return {
    text: question,
    rows: [
      row({ text: t(locale, "yes"), action: confirm.action, args: confirm.args }),
      row({ text: t(locale, "no"), action: cancel.action, args: cancel.args }),
    ],
  };
}

// Screens -----------------------------------------------------------------------

function homeScreen(locale: Locale): Screen {
  return {
    text: `<b>${t(locale, "homeTitle")}</b>\n\n${t(locale, "homeBody")}`,
    rows: [
      row({ text: t(locale, "btnBusinesses"), action: "bizls" }),
      row({ text: t(locale, "btnAddBusiness"), action: "bizadd" }),
      row({ text: t(locale, "btnNeedsPerson"), action: "wait" }),
      row(
        { text: t(locale, "btnConsoleBot"), action: "console" },
        { text: t(locale, "btnDiagnostics"), action: "diag" },
        { text: t(locale, "btnUpdates"), action: "upd" },
      ),
      row(
        { text: t(locale, "btnUsage"), action: "usg" },
        { text: t(locale, "btnLanguage"), action: "lang" },
        { text: t(locale, "btnHelp"), action: "help" },
      ),
    ],
  };
}

function languageScreen(locale: Locale): Screen {
  return {
    text: `<b>${t(locale, "langTitle")}</b>\n\n${t(locale, "langBody")}`,
    rows: [
      ...LOCALES.map((code) =>
        row({
          text: code === locale ? `${LOCALE_NAMES[code]} ✓` : LOCALE_NAMES[code],
          action: "setlang",
          args: [code],
        }),
      ),
      backTo(locale, "home"),
    ],
  };
}

function businessListScreen(locale: Locale, businesses: readonly Business[]): Screen {
  if (businesses.length === 0) {
    return {
      text: `<b>${t(locale, "bizListTitle")}</b>\n\n${t(locale, "bizListEmpty")}`,
      rows: [
        row({ text: t(locale, "btnAddBusiness"), action: "bizadd" }),
        backTo(locale, "home"),
      ],
    };
  }
  return {
    text: `<b>${t(locale, "bizListTitle")}</b>\n\n${t(locale, "bizListCount", { count: businesses.length })}`,
    rows: [
      ...businesses
        .slice(0, LIST_LIMIT)
        .map((business) => row({ text: business.name, action: "biz", args: [business.id] })),
      row({ text: t(locale, "btnAddBusiness"), action: "bizadd" }),
      backTo(locale, "home"),
    ],
  };
}

function businessScreen(
  locale: Locale,
  business: Business,
  counts: { bots: number; documents: number; products: number; customers: number },
  usage: { messages: number; inputTokens: number; outputTokens: number },
): Screen {
  const modelLabel =
    MODEL_PRESETS.find((preset) => preset.id === business.model)?.label ?? business.model;
  return {
    text: [
      `<b>${escapeHtml(business.name)}</b>`,
      "",
      `${t(locale, "bizModel")}: ${escapeHtml(modelLabel)}`,
      `${t(locale, "bizLanguage")}: ${escapeHtml(business.locale)}`,
      `${t(locale, "bizDocuments")}: ${counts.documents}   ${t(locale, "bizProducts")}: ${counts.products}`,
      `${t(locale, "bizBots")}: ${counts.bots}   ${t(locale, "bizCustomers")}: ${counts.customers}`,
      `${t(locale, "bizInstructions")}: ${
        business.systemPrompt.length > 0
          ? `${business.systemPrompt.length}`
          : t(locale, "bizDefault")
      }`,
      "",
      t(locale, "bizToday", {
        messages: usage.messages,
        tokens: usage.inputTokens + usage.outputTokens,
      }),
    ].join("\n"),
    rows: [
      row(
        { text: t(locale, "btnData"), action: "data", args: [business.id] },
        { text: t(locale, "btnProducts"), action: "prod", args: [business.id] },
      ),
      row(
        { text: t(locale, "btnCustomers"), action: "cust", args: [business.id] },
        { text: t(locale, "btnInstructions"), action: "inst", args: [business.id] },
      ),
      row(
        { text: t(locale, "btnBots"), action: "bots", args: [business.id] },
        { text: t(locale, "btnModel"), action: "mdl", args: [business.id] },
      ),
      row({ text: t(locale, "btnWebAgent"), action: "web", args: [business.id] }),
      row({ text: t(locale, "btnDeleteBusiness"), action: "bizdel", args: [business.id] }),
      backTo(locale, "bizls"),
    ],
  };
}

function dataScreen(
  locale: Locale,
  business: Business,
  documents: readonly { id: string; filename: string; status: string; chunkCount: number }[],
): Screen {
  return {
    text: [
      `<b>${t(locale, "dataTitle", { name: escapeHtml(business.name) })}</b>`,
      "",
      documents.length === 0 ? t(locale, "dataEmpty") : "",
      t(locale, "dataHint"),
    ]
      .filter((line) => line !== "")
      .join("\n"),
    rows: [
      ...documents
        .slice(0, LIST_LIMIT)
        .map((document) =>
          row({
            text: `${document.filename} (${document.chunkCount})`,
            action: "doc",
            args: [business.id, document.id],
          }),
        ),
      row({ text: t(locale, "btnAddData"), action: "dataadd", args: [business.id] }),
      backTo(locale, "biz", [business.id]),
    ],
  };
}

function documentScreen(
  locale: Locale,
  businessId: string,
  document: { id: string; filename: string; status: string; chunkCount: number; byteSize: number; createdAt: string },
): Screen {
  return {
    text: t(locale, "dataDetail", {
      name: escapeHtml(document.filename),
      status: document.status,
      chunks: document.chunkCount,
      size: formatBytes(document.byteSize),
      added: document.createdAt.slice(0, 10),
    }),
    rows: [
      row({ text: t(locale, "btnDeleteData"), action: "docdel", args: [businessId, document.id] }),
      backTo(locale, "data", [businessId]),
    ],
  };
}

function productsScreen(
  locale: Locale,
  business: Business,
  products: readonly ProductEntry[],
  scanning: boolean,
): Screen {
  return {
    text: [
      `<b>${t(locale, "prodTitle", { name: escapeHtml(business.name) })}</b>`,
      "",
      t(locale, "prodDerived"),
      scanning ? `\n<i>${t(locale, "prodScanning")}</i>` : "",
      products.length === 0 && !scanning ? `\n${t(locale, "prodEmptyDerived")}` : "",
    ]
      .filter((line) => line !== "")
      .join("\n"),
    rows: [
      ...products.slice(0, LIST_LIMIT).map((entry) =>
        row({
          text: `${entry.edited ? "\u270F " : ""}${
            entry.price.length > 0 ? `${entry.name} - ${entry.price}` : entry.name
          }`,
          action: "p",
          args: [business.id, entry.key],
        }),
      ),
      row({ text: t(locale, "btnAddProduct"), action: "prodadd", args: [business.id] }),
      row({ text: t(locale, "btnRescanProducts"), action: "prodscan", args: [business.id] }),
      backTo(locale, "biz", [business.id]),
    ],
  };
}

function instructionsScreen(locale: Locale, business: Business, hasPrevious: boolean): Screen {
  const set = business.systemPrompt.trim().length > 0;
  const style = set ? matchSkill(business.systemPrompt) : undefined;

  return {
    text: [
      `<b>${t(locale, "instTitle", { name: escapeHtml(business.name) })}</b>`,
      "",
      t(locale, "instBody"),
      "",
      !set
        ? `<i>${t(locale, "instUsingDefault")}</i>`
        : [
            // Named when the text still matches a starting point exactly, so an
            // operator can tell at a glance whether they are looking at
            // something they wrote or something they picked.
            `<b>${t(locale, "instActive")}:</b> ${
              style === undefined ? t(locale, "instCustom") : escapeHtml(style.label[locale])
            }   <i>${t(locale, "instLength", { count: business.systemPrompt.length })}</i>`,
            "",
            escapeHtml(truncate(business.systemPrompt, 400)),
          ].join("\n"),
    ].join("\n"),
    rows: [
      ...(set
        ? [row({ text: t(locale, "btnViewInstructions"), action: "instview", args: [business.id] })]
        : []),
      row({ text: t(locale, "btnEditInstructions"), action: "instset", args: [business.id] }),
      row({ text: t(locale, "btnChooseStyle"), action: "skills", args: [business.id] }),
      ...(hasPrevious
        ? [row({ text: t(locale, "btnUndoInstructions"), action: "instundo", args: [business.id] })]
        : []),
      ...(set
        ? [row({ text: t(locale, "btnResetInstructions"), action: "instclr", args: [business.id] })]
        : []),
      backTo(locale, "biz", [business.id]),
    ],
  };
}

/** Longest instruction text a screen can carry, under Telegram's message cap. */
const INSTRUCTION_VIEW_CHARS = 3400;

function customersScreen(
  locale: Locale,
  business: Business,
  customers: readonly Customer[],
): Screen {
  if (customers.length === 0) {
    return {
      text: `<b>${t(locale, "custTitle", { name: escapeHtml(business.name) })}</b>\n\n${t(locale, "custEmpty")}`,
      rows: [backTo(locale, "biz", [business.id])],
    };
  }
  return {
    text: [
      `<b>${t(locale, "custTitle", { name: escapeHtml(business.name) })}</b>`,
      "",
      t(locale, "custRecent", { count: customers.length }),
    ].join("\n"),
    rows: [
      ...customers.slice(0, LIST_LIMIT).map((customer) =>
        row({
          text: `${customer.displayName || customer.username || String(customer.telegramUserId)} · ${t(locale, STAGE_KEYS[customer.stage])}`,
          action: "cst",
          args: [customer.id],
        }),
      ),
      backTo(locale, "biz", [business.id]),
    ],
  };
}

function customerScreen(
  locale: Locale,
  customer: Customer,
  facts: readonly CustomerFact[],
): Screen {
  const name = customer.displayName || customer.username || String(customer.telegramUserId);
  return {
    text: [
      `<b>${escapeHtml(name)}</b>`,
      customer.username.length > 0 ? `@${escapeHtml(customer.username)}` : "",
      "",
      `${t(locale, "custStage")}: ${t(locale, STAGE_KEYS[customer.stage])}`,
      `${t(locale, "custMessages")}: ${customer.messageCount}`,
      `${t(locale, "custFirstSeen")}: ${customer.firstSeen.slice(0, 10)}`,
      customer.note.length > 0
        ? `\n${t(locale, "custNote")}: ${escapeHtml(truncate(customer.note, 300))}`
        : "",
      "",
      facts.length > 0 ? `<b>${t(locale, "custRemembered")}</b>` : `<i>${t(locale, "custNothingKnown")}</i>`,
      ...facts.slice(0, 12).map((fact) => `- ${escapeHtml(fact.fact)}`),
    ]
      .filter((line) => line !== "")
      .join("\n"),
    rows: [
      row({ text: t(locale, "btnConversation"), action: "conv", args: [customer.id] }),
      row({ text: t(locale, "btnAddNote"), action: "cnote", args: [customer.id] }),
      ...STAGES.filter((stage) => stage !== customer.stage).map((stage) =>
        row({
          text: t(locale, "btnMarkAs", { stage: t(locale, STAGE_KEYS[stage]) }),
          action: "cstage",
          args: [customer.id, stage],
        }),
      ),
      row({ text: t(locale, "btnForgetFacts"), action: "cwipe", args: [customer.id] }),
      row({ text: t(locale, "btnDeleteCustomer"), action: "cdel", args: [customer.id] }),
      backTo(locale, "cust", [customer.businessId]),
    ],
  };
}

function botsScreen(
  locale: Locale,
  business: Business,
  bots: readonly { role: string; username: string }[],
): Screen {
  const lines =
    bots.length === 0
      ? [t(locale, "botsEmpty")]
      : bots.map(
          (bot) =>
            `${bot.role === "admin" ? t(locale, "botConsole") : t(locale, "botCustomer")}: @${escapeHtml(bot.username)}`,
        );
  return {
    text: [`<b>${t(locale, "botsTitle", { name: escapeHtml(business.name) })}</b>`, "", ...lines].join(
      "\n",
    ),
    rows: [
      row({ text: t(locale, "btnConnectBot"), action: "botadd", args: [business.id] }),
      backTo(locale, "biz", [business.id]),
    ],
  };
}

function modelScreen(locale: Locale, business: Business): Screen {
  return {
    text: [
      `<b>${t(locale, "modelTitle", { name: escapeHtml(business.name) })}</b>`,
      "",
      t(locale, "modelBody"),
    ].join("\n"),
    rows: [
      ...MODEL_PRESETS.map((preset, index) => {
        const marks = [
          preset.id === business.model ? t(locale, "modelCurrent") : null,
          preset.requiresProviderKey ? t(locale, "modelNeedsKey") : null,
        ].filter((mark) => mark !== null);
        return row({
          text: marks.length > 0 ? `${preset.label} (${marks.join(", ")})` : preset.label,
          action: "setmdl",
          args: [business.id, String(index)],
        });
      }),
      backTo(locale, "biz", [business.id]),
    ],
  };
}

function helpScreen(locale: Locale): Screen {
  return {
    text: `<b>${t(locale, "helpTitle")}</b>\n\n${t(locale, "helpBody")}`,
    rows: [backTo(locale, "home")],
  };
}

// Dispatch ----------------------------------------------------------------------

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

async function customerFor(env: Env, userId: number, customerId: string): Promise<Customer> {
  const customer = await getCustomer(env, customerId);
  await requireAccess(env, userId, customer.businessId);
  return customer;
}


async function businessDetail(env: Env, locale: Locale, userId: number, businessId: string): Promise<Screen> {
  await requireAccess(env, userId, businessId);
  await setContext(env, userId, businessId);
  const business = await getBusiness(env, businessId);
  const [bots, usage, documents, customers, products] = await Promise.all([
    listBots(env, businessId),
    todayUsage(env, businessId),
    listDocuments(env, businessId, 100),
    listCustomers(env, businessId, 100),
    productsView(env, businessId),
  ]);
  return businessScreen(
    locale,
    business,
    {
      bots: bots.length,
      documents: documents.length,
      products: products.length,
      customers: customers.length,
    },
    usage,
  );
}

async function screenFor(
  env: Env,
  locale: Locale,
  userId: number,
  action: string,
  args: readonly string[],
): Promise<Screen> {
  switch (action) {
    case "home":
      return homeScreen(locale);

    case "help":
      return helpScreen(locale);

    case "lang":
      return languageScreen(locale);

    case "setlang": {
      const choice = requireArg(args, 0);
      if (isLocale(choice)) {
        await setOperatorLocale(env, userId, choice);
        return homeScreen(choice);
      }
      return languageScreen(locale);
    }

    case "bizls":
      return businessListScreen(locale, await listBusinesses(env, userId));

    case "bizadd":
      await setPending(env, userId, { kind: "new_business" });
      return {
        text: `<b>${t(locale, "bizAddTitle")}</b>\n\n${t(locale, "bizAddBody")}`,
        rows: [row({ text: t(locale, "cancel"), action: "home" })],
      };

    case "diag": {
      const events = await listEvents(env, 10);
      return {
        text: [
          `<b>${t(locale, "diagTitle")}</b>`,
          "",
          t(locale, "diagBody"),
          "",
          ...(events.length === 0
            ? [t(locale, "diagEmpty")]
            : events.map(
                (event) =>
                  `<b>${event.createdAt.slice(5, 16).replace("T", " ")}</b> ${escapeHtml(
                    event.businessName ?? "",
                  )}\n${escapeHtml(truncate(event.detail, 200))}`,
              )),
        ].join("\n"),
        rows: [backTo(locale, "home")],
      };
    }

    case "wait": {
      const waiting = await listHandovers(env, 15);
      return {
        text: [
          `<b>${t(locale, "waitTitle")}</b>`,
          "",
          waiting.length === 0 ? t(locale, "waitEmpty") : "",
        ]
          .filter((line) => line !== "")
          .join("\n"),
        rows: [
          ...waiting
            .filter((item) => item.customerId !== null)
            .map((item) =>
              row({
                text: `${item.customerName || "?"} · ${escapeHtml(item.businessName)}`,
                action: "conv",
                args: [item.customerId as string],
              }),
            ),
          backTo(locale, "home"),
        ],
      };
    }

    case "conv": {
      const customer = await customerFor(env, userId, requireArg(args, 0));
      const chat = await conversationForCustomer(env, {
        businessId: customer.businessId,
        chatId: customer.chatId,
      });
      const name = customer.displayName || customer.username || String(customer.telegramUserId);

      if (chat === null) {
        return {
          text: `<b>${t(locale, "convTitle", { name: escapeHtml(name) })}</b>\n\n${t(locale, "convNoChat")}`,
          rows: [backTo(locale, "cst", [customer.id])],
        };
      }

      const [turns, handover] = await Promise.all([
        transcript(env, chat.id, 25),
        getHandover(env, chat.id),
      ]);

      const speaker = (turn: TranscriptTurn): string =>
        turn.role === "user"
          ? t(locale, "convCustomer")
          : turn.sentBy === "human"
            ? t(locale, "convHuman")
            : t(locale, "convAssistant");

      // Attachments are listed as buttons under the transcript rather than
      // inline, because a photo cannot live inside the message the console
      // edits. Tapping one sends it into the chat as a separate message.
      const attachments = turns.filter((turn) => turn.media !== null);

      return {
        text: [
          `<b>${t(locale, "convTitle", { name: escapeHtml(name) })}</b>`,
          describeCustomer(name, customer.username) === escapeHtml(name)
            ? `<i>${t(locale, "convNoUsername")}</i>`
            : `@${escapeHtml(customer.username)}`,
          handover === null
            ? ""
            : `\n<i>${t(locale, handover.state === "human" ? "convStateHuman" : "convStateWaiting")}</i>`,
          "",
          ...(turns.length === 0
            ? [t(locale, "convEmpty")]
            : turns.map(
                (turn) =>
                  `<b>${speaker(turn)}</b>  <i>${stamp(turn.createdAt)}</i>\n${
                    turn.media === null ? "" : `${mediaIcon(turn.media.kind)} `
                  }${escapeHtml(truncate(turn.content, 400))}`,
              )),
        ]
          .filter((line) => line !== "")
          .join("\n"),
        rows: [
          ...attachments.map((turn) =>
            row({
              text: `${mediaIcon(turn.media?.kind ?? "")} ${t(locale, "btnShowMedia", {
                time: stamp(turn.createdAt),
              })}`,
              action: "med",
              args: [turn.id, customer.id],
            }),
          ),
          ...(handover?.state === "human"
            ? [
                row({ text: t(locale, "btnSendAsHuman"), action: "csend", args: [customer.id] }),
                row({ text: t(locale, "btnHandBack"), action: "cback", args: [customer.id] }),
              ]
            : [row({ text: t(locale, "btnTakeOver"), action: "ctake", args: [customer.id] })]),
          backTo(locale, "cst", [customer.id]),
        ],
      };
    }

    case "ctake": {
      const customer = await customerFor(env, userId, requireArg(args, 0));
      const chat = await conversationForCustomer(env, {
        businessId: customer.businessId,
        chatId: customer.chatId,
      });
      if (chat !== null) {
        await takeOverConversation(env, {
          conversationId: chat.id,
          businessId: customer.businessId,
          customerId: customer.id,
        });
      }
      return screenFor(env, locale, userId, "conv", [customer.id]);
    }

    case "cback": {
      const customer = await customerFor(env, userId, requireArg(args, 0));
      const chat = await conversationForCustomer(env, {
        businessId: customer.businessId,
        chatId: customer.chatId,
      });
      if (chat !== null) {
        await endHandover(env, chat.id);
      }
      return screenFor(env, locale, userId, "conv", [customer.id]);
    }

    case "csend": {
      const customer = await customerFor(env, userId, requireArg(args, 0));
      await setPending(env, userId, { kind: "human_reply", customerId: customer.id });
      return {
        text: `<b>${t(locale, "btnSendAsHuman")}</b>\n\n${t(locale, "convSendBody")}`,
        rows: [row({ text: t(locale, "cancel"), action: "conv", args: [customer.id] })],
      };
    }

    case "usg": {
      // Muxel's own counters always work. The account totals need a token, so
      // the two are fetched together and the screen degrades to the first when
      // the second is unavailable rather than showing nothing.
      const [mine, account] = await Promise.all([todayUsageAll(env), accountUsage(env)]);

      const lines = [
        `<b>${t(locale, "usgTitle")}</b>`,
        "",
        `<b>${t(locale, "usgMuxel")}</b>`,
        `${mine.messages} ${t(locale, "usgMessages")}`,
        `${formatCount(mine.inputTokens)} / ${formatCount(mine.outputTokens)} ${t(locale, "usgTokens")}`,
      ];

      if (account.ok) {
        const usage = account.usage;
        const left = repliesRemaining(usage.neuronsToday, mine.messages);
        lines.push(
          "",
          `<b>${t(locale, "usgToday")}</b>`,
          `${t(locale, "usgNeurons")}: ${meter(usage.neuronsToday, FREE_ALLOWANCE.neuronsPerDay)}`,
          ...usage.byModel.map(
            (row) => `   ${escapeHtml(shortModel(row.model))}  ${round(row.neurons)}`,
          ),
          `${t(locale, "usgRequests")}: ${meter(usage.requestsToday, FREE_ALLOWANCE.requestsPerDay)}`,
          "",
          `<b>${t(locale, "usgMonth")}</b>`,
          `${t(locale, "usgNeurons")}: ${round(usage.neuronsThisMonth)}`,
          `${t(locale, "usgVectorQueried")}: ${meter(
            usage.queriedDimensionsThisMonth,
            FREE_ALLOWANCE.queriedDimensionsPerMonth,
          )}`,
          `${t(locale, "usgVectorStored")}: ${meter(
            usage.storedDimensions,
            FREE_ALLOWANCE.storedDimensions,
          )}`,
          ...(left === null ? [] : ["", t(locale, "usgRepliesLeft", { count: String(left) })]),
          "",
          t(locale, "usgFreeNote"),
        );
      } else {
        lines.push(
          "",
          t(locale, account.problem === "not_configured" ? "usgNoToken" : "usgUnreachable"),
        );
      }

      return {
        text: lines.join("\n"),
        rows: [row({ text: t(locale, "btnCheckAgain"), action: "usg" }), backTo(locale, "home")],
      };
    }

    case "upd": {
      // Checked when the owner asks rather than read from a cache, so the
      // answer is the truth at the moment they looked. The scheduled check
      // still runs, but nobody has to wait for it to find out where they are.
      const status = await versionStatus();
      const headline =
        status.latest === null
          ? t(locale, "updUnknown", { running: status.running })
          : status.behind
            ? t(locale, "updBehind", { running: status.running, latest: status.latest })
            : t(locale, "updCurrent", { running: status.running });
      return {
        text: [
          `<b>${t(locale, "updTitle")}</b>`,
          "",
          headline,
          ...(status.behind ? ["", t(locale, "updHow", { repo: UPSTREAM_REPO })] : []),
        ].join("\n"),
        rows: [row({ text: t(locale, "btnCheckAgain"), action: "upd" }), backTo(locale, "home")],
      };
    }

    case "console": {
      const bot = await getConsoleBot(env);
      return {
        text: [
          `<b>${t(locale, "consoleBotTitle")}</b>`,
          "",
          t(locale, "consoleBotBody", { username: bot?.username ?? "" }),
        ].join("\n"),
        rows: [
          row({ text: t(locale, "btnReplaceConsole"), action: "conrep" }),
          backTo(locale, "home"),
        ],
      };
    }

    case "conrep":
      await setPending(env, userId, { kind: "console_bot", replace: true });
      return {
        text: [
          `<b>${t(locale, "btnReplaceConsole")}</b>`,
          "",
          t(locale, "botAddBody"),
          "",
          t(locale, "botReplaceWarning"),
        ].join("\n"),
        rows: [row({ text: t(locale, "cancel"), action: "console" })],
      };

    case "biz":
      return businessDetail(env, locale, userId, requireArg(args, 0));

    case "bizdel": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      const business = await getBusiness(env, businessId);
      return confirmScreen(
        locale,
        t(locale, "bizDeleteConfirm", { name: escapeHtml(business.name) }),
        { action: "bizdelyes", args: [businessId] },
        { action: "biz", args: [businessId] },
      );
    }

    case "bizdelyes": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      const orphaned = await deleteBusiness(env, businessId);
      if (orphaned.length > 0) {
        await env.KNOWLEDGE.deleteByIds(orphaned);
      }
      return businessListScreen(locale, await listBusinesses(env, userId));
    }

    // Data --------------------------------------------------------------------

    case "data": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      await setContext(env, userId, businessId);
      const [business, documents] = await Promise.all([
        getBusiness(env, businessId),
        listDocuments(env, businessId),
      ]);
      return dataScreen(locale, business, documents);
    }

    case "dataadd": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      await setContext(env, userId, businessId);
      await setPending(env, userId, { kind: "data_file", businessId });
      return {
        text: [
          `<b>${t(locale, "dataAddTitle")}</b>`,
          "",
          t(locale, "dataAddBody"),
          "",
          t(locale, "dataHint"),
        ].join("\n"),
        rows: [row({ text: t(locale, "cancel"), action: "data", args: [businessId] })],
      };
    }

    case "doc": {
      const businessId = requireArg(args, 0);
      const documentId = requireArg(args, 1);
      await requireAccess(env, userId, businessId);
      const documents = await listDocuments(env, businessId, 100);
      const document = documents.find((item) => item.id === documentId);
      if (document === undefined) {
        return screenFor(env, locale, userId, "data", [businessId]);
      }
      return documentScreen(locale, businessId, document);
    }

    case "docdel": {
      const businessId = requireArg(args, 0);
      const documentId = requireArg(args, 1);
      await requireAccess(env, userId, businessId);
      const documents = await listDocuments(env, businessId, 100);
      const document = documents.find((item) => item.id === documentId);
      return confirmScreen(
        locale,
        t(locale, "dataDeleteConfirm", { name: escapeHtml(document?.filename ?? "") }),
        { action: "docdely", args: [businessId, documentId] },
        { action: "doc", args: [businessId, documentId] },
      );
    }

    case "docdely": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      await removeDocument(env, businessId, requireArg(args, 1));
      return screenFor(env, locale, userId, "data", [businessId]);
    }

    // Products ----------------------------------------------------------------

    case "prod": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      await setContext(env, userId, businessId);
      const [business, view, scanning] = await Promise.all([
        getBusiness(env, businessId),
        productsView(env, businessId),
        hasPendingExtraction(env, businessId),
      ]);
      return productsScreen(locale, business, view, scanning);
    }

    case "p": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      const key = requireArg(args, 1);
      const entry = (await productsView(env, businessId)).find((item) => item.key === key);
      if (entry === undefined) {
        return screenFor(env, locale, userId, "prod", [businessId]);
      }
      return {
        text: [
          `<b>${escapeHtml(entry.name)}</b>`,
          entry.price.length > 0 ? escapeHtml(entry.price) : "",
          entry.description.length > 0 ? escapeHtml(entry.description) : "",
          "",
          entry.source.length > 0
            ? `<i>${t(locale, "prodSource", { name: escapeHtml(entry.source) })}</i>`
            : `<i>${t(locale, "prodTyped")}</i>`,
          entry.edited ? `<i>${t(locale, "prodEditedNote")}</i>` : "",
        ]
          .filter((line) => line !== "")
          .join("\n"),
        rows: [
          row({ text: t(locale, "btnFixProduct"), action: "pfix", args: [businessId, entry.key] }),
          row({ text: t(locale, "btnRemoveProduct"), action: "prem", args: [businessId, entry.key] }),
          backTo(locale, "prod", [businessId]),
        ],
      };
    }

    case "pfix": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      const key = requireArg(args, 1);
      const entry = (await productsView(env, businessId)).find((item) => item.key === key);
      if (entry === undefined) {
        return screenFor(env, locale, userId, "prod", [businessId]);
      }
      await setPending(env, userId, { kind: "product_fix", businessId, productKey: key });
      return {
        text: `<b>${t(locale, "btnFixProduct")}</b>\n\n${t(locale, "prodFixBody", {
          name: escapeHtml(entry.name),
          price: escapeHtml(entry.price.length > 0 ? entry.price : "-"),
        })}`,
        rows: [row({ text: t(locale, "cancel"), action: "p", args: [businessId, key] })],
      };
    }

    case "prem": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      const key = requireArg(args, 1);
      const entry = (await productsView(env, businessId)).find((item) => item.key === key);
      if (entry === undefined) {
        return screenFor(env, locale, userId, "prod", [businessId]);
      }
      return confirmScreen(
        locale,
        t(locale, "prodRemoveConfirm", { name: escapeHtml(entry.name) }),
        { action: "premy", args: [businessId, key] },
        { action: "p", args: [businessId, key] },
      );
    }

    case "premy": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      const key = requireArg(args, 1);
      const entry = (await productsView(env, businessId)).find((item) => item.key === key);
      if (entry !== undefined) {
        // The data learns it first, then the view shows it: a removal the
        // customer could still be quoted is not a removal.
        await upsertCorrection(env, {
          businessId,
          name: entry.name,
          price: "",
          description: "",
          removed: true,
        });
        await syncOwnerUpdates(env, businessId);
      }
      return screenFor(env, locale, userId, "prod", [businessId]);
    }

    case "prodadd": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      await setPending(env, userId, { kind: "manual_product", businessId });
      return {
        text: `<b>${t(locale, "prodAddTitle")}</b>\n\n${t(locale, "prodAddBody")}`,
        rows: [row({ text: t(locale, "cancel"), action: "prod", args: [businessId] })],
      };
    }

    case "prodscan": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      const documents = await listDocuments(env, businessId, 100);
      for (const document of documents) {
        if (document.filename !== OWNER_UPDATES_FILENAME) {
          await markExtractionPending(env, { businessId, documentId: document.id });
        }
      }
      // One document is read now so the button visibly did something; the
      // scheduled run works through whatever remains.
      const [next] = await pendingExtractions(env, 1);
      if (next !== undefined) {
        const business = await getBusiness(env, businessId);
        await runExtraction(env, { ...next, model: business.model }).catch(() => undefined);
      }
      return screenFor(env, locale, userId, "prod", [businessId]);
    }

    // Instructions ------------------------------------------------------------

    case "inst": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      const [business, previous] = await Promise.all([
        getBusiness(env, businessId),
        previousPrompt(env, businessId),
      ]);
      return instructionsScreen(locale, business, previous !== null);
    }

    case "skills": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      return {
        text: [
          `<b>${t(locale, "skillsTitle")}</b>`,
          "",
          t(locale, "skillsBody"),
          "",
          ...SKILLS.map((skill) => `<b>${skill.label[locale]}</b>\n${skill.summary[locale]}`),
        ].join("\n"),
        rows: [
          ...SKILLS.map((skill) =>
            row({ text: skill.label[locale], action: "skillset", args: [businessId, skill.id] }),
          ),
          backTo(locale, "inst", [businessId]),
        ],
      };
    }

    case "skillset": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      const skill = findSkill(requireArg(args, 1));
      if (skill === undefined) {
        return screenFor(env, locale, userId, "skills", [businessId]);
      }
      // Written as ordinary instruction text, so the previous one lands in the
      // undo history and the operator can edit this like anything they typed.
      await setBusinessPrompt(env, businessId, skill.body);
      return screenFor(env, locale, userId, "inst", [businessId]);
    }

    case "instset": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      await setPending(env, userId, { kind: "instructions", businessId });
      return {
        text: `<b>${t(locale, "btnEditInstructions")}</b>\n\n${t(locale, "instEditBody", { limit: MAX_PROMPT_CHARS })}`,
        rows: [row({ text: t(locale, "cancel"), action: "inst", args: [businessId] })],
      };
    }

    case "instview": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      const business = await getBusiness(env, businessId);
      const prompt = business.systemPrompt;
      const style = matchSkill(prompt);
      const overflow = prompt.length > INSTRUCTION_VIEW_CHARS;

      return {
        text: [
          `<b>${t(locale, "instViewTitle", { name: escapeHtml(business.name) })}</b>`,
          `<i>${
            style === undefined ? t(locale, "instCustom") : escapeHtml(style.label[locale])
          } · ${t(locale, "instLength", { count: prompt.length })}</i>`,
          "",
          escapeHtml(overflow ? prompt.slice(0, INSTRUCTION_VIEW_CHARS) : prompt),
          // A message cannot hold everything the field can, so say so rather
          // than showing a cut off paragraph as if it were the whole thing.
          ...(overflow ? ["", `<i>${t(locale, "instTruncated")}</i>`] : []),
        ].join("\n"),
        rows: [
          row({ text: t(locale, "btnEditInstructions"), action: "instset", args: [businessId] }),
          row({ text: t(locale, "btnResetInstructions"), action: "instclr", args: [businessId] }),
          backTo(locale, "inst", [businessId]),
        ],
      };
    }

    case "instundo": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      const previous = await previousPrompt(env, businessId);
      if (previous !== null) {
        await setBusinessPrompt(env, businessId, previous);
      }
      return screenFor(env, locale, userId, "inst", [businessId]);
    }

    case "instclr": {
      // Asked first, like every other delete in the console. Instructions are
      // the slowest thing here to write again from memory.
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      const business = await getBusiness(env, businessId);
      return confirmScreen(
        locale,
        t(locale, "instClearConfirm", { name: escapeHtml(business.name) }),
        { action: "instclry", args: [businessId] },
        { action: "inst", args: [businessId] },
      );
    }

    case "instclry": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      // Recorded as a change rather than a wipe, so Undo can bring it back.
      await setBusinessPrompt(env, businessId, "");
      return screenFor(env, locale, userId, "inst", [businessId]);
    }

    // Customers ---------------------------------------------------------------

    case "cust": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      const [business, customers] = await Promise.all([
        getBusiness(env, businessId),
        listCustomers(env, businessId),
      ]);
      return customersScreen(locale, business, customers);
    }

    case "cst": {
      const customer = await customerFor(env, userId, requireArg(args, 0));
      return customerScreen(locale, customer, await listFacts(env, customer.id));
    }

    case "cnote": {
      const customer = await customerFor(env, userId, requireArg(args, 0));
      await setPending(env, userId, { kind: "customer_note", customerId: customer.id });
      return {
        text: `<b>${t(locale, "btnAddNote")}</b>\n\n${t(locale, "custNoteBody")}`,
        rows: [row({ text: t(locale, "cancel"), action: "cst", args: [customer.id] })],
      };
    }

    case "cstage": {
      const customer = await customerFor(env, userId, requireArg(args, 0));
      const stage = requireArg(args, 1) as CustomerStage;
      if (STAGES.includes(stage)) {
        await setCustomerStage(env, customer.id, stage);
      }
      return screenFor(env, locale, userId, "cst", [customer.id]);
    }

    case "cwipe": {
      const customer = await customerFor(env, userId, requireArg(args, 0));
      await forgetFacts(env, customer.id);
      return screenFor(env, locale, userId, "cst", [customer.id]);
    }

    case "cdel": {
      const customer = await customerFor(env, userId, requireArg(args, 0));
      await forgetCustomer(env, customer.id);
      return screenFor(env, locale, userId, "cust", [customer.businessId]);
    }

    // Bots and model ----------------------------------------------------------

    case "web": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      const [business, channel] = await Promise.all([
        getBusiness(env, businessId),
        getChannelForBusiness(env, businessId),
      ]);

      if (channel === null) {
        return {
          text: [
            `<b>${t(locale, "webTitle", { name: escapeHtml(business.name) })}</b>`,
            "",
            t(locale, "webIntro"),
          ].join("\n"),
          rows: [
            row({ text: t(locale, "btnGenerateWeb"), action: "webnew", args: [businessId] }),
            backTo(locale, "biz", [businessId]),
          ],
        };
      }

      const base = await deploymentOrigin(env);
      const preview = `${base}/w/${channel.key}`;
      return {
        text: [
          `<b>${t(locale, "webTitle", { name: escapeHtml(business.name) })}</b>`,
          "",
          channel.enabled ? t(locale, "webLive") : `<i>${t(locale, "webOff")}</i>`,
          "",
          `<b>${t(locale, "webTry")}</b>`,
          preview,
          "",
          `<b>${t(locale, "webEmbed")}</b>`,
          `<pre>${escapeHtml(`<script src="${preview}/widget.js" async></script>`)}</pre>`,
          "",
          `${t(locale, "webColour")}: ${escapeHtml(channel.accent)}`,
          `${t(locale, "webDomains")}: ${
            channel.allowedOrigins.length > 0
              ? escapeHtml(channel.allowedOrigins)
              : t(locale, "webAnyDomain")
          }`,
        ].join("\n"),
        rows: [
          row({ text: t(locale, "btnWebColour"), action: "webcol", args: [businessId] }),
          row({ text: t(locale, "btnWebGreeting"), action: "webgreet", args: [businessId] }),
          row({ text: t(locale, "btnWebDomains"), action: "webdom", args: [businessId] }),
          row({
            text: t(locale, channel.enabled ? "btnWebDisable" : "btnWebEnable"),
            action: "webtog",
            args: [businessId],
          }),
          backTo(locale, "biz", [businessId]),
        ],
      };
    }

    case "webnew": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      const business = await getBusiness(env, businessId);
      const existing = await getChannelForBusiness(env, businessId);
      if (existing === null) {
        await createChannel(env, { businessId, title: business.name });
      }
      return screenFor(env, locale, userId, "web", [businessId]);
    }

    case "webcol": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      return {
        text: `<b>${t(locale, "btnWebColour")}</b>\n\n${t(locale, "webColourBody")}`,
        rows: [
          ...WIDGET_COLOURS.map((colour) =>
            row({
              text: `${colour.swatch} ${colour.label}`,
              action: "webcolset",
              args: [businessId, colour.hex.slice(1)],
            }),
          ),
          backTo(locale, "web", [businessId]),
        ],
      };
    }

    case "webcolset": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      const channel = await getChannelForBusiness(env, businessId);
      if (channel !== null) {
        await updateChannel(env, channel.id, { accent: `#${requireArg(args, 1)}` });
      }
      return screenFor(env, locale, userId, "web", [businessId]);
    }

    case "webgreet": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      await setPending(env, userId, { kind: "web_greeting", businessId });
      return {
        text: `<b>${t(locale, "btnWebGreeting")}</b>\n\n${t(locale, "webGreetingBody")}`,
        rows: [row({ text: t(locale, "cancel"), action: "web", args: [businessId] })],
      };
    }

    case "webdom": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      await setPending(env, userId, { kind: "web_domains", businessId });
      return {
        text: `<b>${t(locale, "btnWebDomains")}</b>\n\n${t(locale, "webDomainsBody")}`,
        rows: [row({ text: t(locale, "cancel"), action: "web", args: [businessId] })],
      };
    }

    case "webtog": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      const channel = await getChannelForBusiness(env, businessId);
      if (channel !== null) {
        await updateChannel(env, channel.id, { enabled: !channel.enabled });
      }
      return screenFor(env, locale, userId, "web", [businessId]);
    }

    case "bots": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      const [business, bots] = await Promise.all([
        getBusiness(env, businessId),
        listBots(env, businessId),
      ]);
      return botsScreen(locale, business, bots);
    }

    case "botadd": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      await setPending(env, userId, { kind: "new_business", businessId });
      return {
        text: [`<b>${t(locale, "btnConnectBot")}</b>`, "", t(locale, "botAddBody")].join("\n"),
        rows: [row({ text: t(locale, "cancel"), action: "bots", args: [businessId] })],
      };
    }

    case "mdl": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      return modelScreen(locale, await getBusiness(env, businessId));
    }

    case "setmdl": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      const preset = MODEL_PRESETS[Number(requireArg(args, 1))];
      if (preset !== undefined) {
        await updateBusinessModel(env, businessId, preset.id);
      }
      return modelScreen(locale, await getBusiness(env, businessId));
    }

    default:
      return homeScreen(locale);
  }
}

// Entry point ---------------------------------------------------------------------

/**
 * Commands the console answers, in the order Telegram should list them.
 *
 * The console is button driven, so these are shortcuts rather than a second
 * way to do everything. They exist because the two things an operator returns
 * to most, the instructions and the businesses, were four taps deep.
 */
export const CONSOLE_COMMANDS: readonly { command: string; key: MessageKey }[] = [
  { command: "start", key: "cmdStart" },
  { command: "instruction", key: "cmdInstruction" },
  { command: "business", key: "cmdBusiness" },
  { command: "help", key: "cmdHelp" },
];

/**
 * Extracts a command name from a message.
 *
 * Telegram appends the bot username when a command is sent in a group, and
 * although the console is a private chat, a forwarded command carries it too.
 */
export function parseCommand(text: string): string | null {
  const match = /^\/([a-z_]+)(?:@\S+)?\b/i.exec(text.trim());
  return match === null ? null : (match[1] as string).toLowerCase();
}

/**
 * Maps a command to a screen.
 *
 * `/instruction` goes straight to the open business when there is one, because
 * an operator who has been working on a shop means that shop. With none open it
 * falls back to the picker rather than guessing.
 */
async function routeCommand(
  env: Env,
  userId: number,
  command: string,
): Promise<[string, string[]]> {
  if (command === "instruction" || command === "instructions") {
    const businessId = await getContext(env, userId);
    if (businessId === null) {
      return ["bizls", []];
    }
    // The open business is remembered for a day and can be deleted inside it,
    // so it is confirmed rather than trusted. A stale one falls back to the
    // list instead of failing with nothing on screen.
    const reachable = await canAccessBusiness(env, userId, businessId).catch(() => false);
    return reachable ? ["inst", [businessId]] : ["bizls", []];
  }
  if (command === "business" || command === "businesses") {
    return ["bizls", []];
  }
  if (command === "help") {
    return ["help", []];
  }
  return ["home", []];
}

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

  const operator = await findOperator(env, userId);
  const locale = await localeFor(env, userId);
  if (operator === null) {
    await client.sendMessage({ chatId, text: t(locale, "private") });
    return;
  }

  // A command outranks a prompt the operator armed and then abandoned. Typing
  // /instruction while a half finished upload is waiting should go where it
  // says, not be swallowed as the answer to the earlier question.
  const command = parseCommand(message.text ?? "");
  if (command !== null) {
    await takePending(env, userId);
    await render(
      env,
      client,
      { chatId },
      await screenFor(env, locale, userId, ...(await routeCommand(env, userId, command))),
    );
    return;
  }

  const pending = await takePending(env, userId);
  if (pending !== null) {
    await handlePendingInput(env, client, { chatId, userId, locale, message, pending, origin });
    return;
  }

  // A file sent with no prompt armed belongs to the business that is open. If
  // none is, say so rather than guessing.
  if (message.document !== undefined) {
    const businessId = await getContext(env, userId);
    if (businessId === null) {
      await client.sendMessage({ chatId, text: t(locale, "dataNoBusiness") });
      await render(env, client, { chatId }, await screenFor(env, locale, userId, "bizls", []));
      return;
    }
    await handleDataUpload(env, client, { chatId, userId, locale, message, businessId });
    return;
  }

  await render(env, client, { chatId }, homeScreen(locale));
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

async function handleDataUpload(
  env: Env,
  client: TelegramClient,
  input: {
    chatId: number;
    userId: number;
    locale: Locale;
    message: TelegramMessage;
    businessId: string;
  },
): Promise<void> {
  const { locale, chatId, businessId } = input;
  if (!(await canAccessBusiness(env, input.userId, businessId))) {
    return;
  }

  const notice = await client.sendMessage({ chatId, text: t(locale, "dataReading") });
  try {
    const file = await download(client, input.message);
    const result = await ingestDocument(env, {
      businessId,
      filename: file.filename,
      contentType: file.contentType,
      body: file.body,
    });
    await client.editMessageText({
      chatId,
      messageId: notice.message_id,
      // The index lags the write by around half a minute. Saying "added" while
      // the assistant still cannot find it is what makes a working upload look
      // like a broken one.
      text: t(locale, result.searchable ? "dataAdded" : "dataIndexing", {
        name: escapeHtml(file.filename),
        chunks: result.chunkCount,
      }),
    });

    // The products view reads what this file says. Attempted now for
    // immediate feedback; the scheduled run finishes it if this invocation
    // runs out of road.
    if (file.filename !== OWNER_UPDATES_FILENAME) {
      await markExtractionPending(env, { businessId, documentId: result.documentId });
      const business = await getBusiness(env, businessId);
      await runExtraction(env, {
        businessId,
        documentId: result.documentId,
        model: business.model,
      }).catch(() => undefined);
    }
  } catch (error) {
    console.error("data upload failed", {
      businessId,
      error: error instanceof Error ? error.message : String(error),
    });
    await client.editMessageText({
      chatId,
      messageId: notice.message_id,
      text: t(locale, "dataFailed", {
        reason: escapeHtml(error instanceof Error ? error.message : "unknown error"),
      }),
    });
  }

  await render(env, client, { chatId }, await screenFor(env, locale, input.userId, "data", [businessId]));
}

/**
 * Reads product lines out of free text.
 *
 * Accepts the pipe separated form the console asks for, and falls back to
 * commas so a spreadsheet exported as CSV also works.
 */
/**
 * Reads a product list.
 *
 * One item per line, fields separated by a pipe or a comma. A single line with
 * no separator is accepted as a bare name, because adding one item by typing
 * its name is a reasonable thing to do.
 *
 * A multi line input is held to a stricter rule: most of its lines have to
 * carry a separator. Text lifted out of a PDF arrives as one fragment per
 * line, and the earlier reading of that turned a twelve row inventory table
 * into a hundred and forty two products called things like "Dairy", "12" and
 * "-". A price list nobody can use is worse than an import that refused, so a
 * shape that does not look like a list of items is rejected rather than
 * guessed at.
 */
export function parseProductLines(text: string): { name: string; price: string; description: string }[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return [];
  }

  const delimited = lines.filter((line) => line.includes("|") || line.includes(","));
  if (lines.length > 1 && delimited.length * 2 < lines.length) {
    return [];
  }

  const usable = lines.length === 1 ? lines : delimited;

  return usable
    .map((line) => (line.includes("|") ? line.split("|") : line.split(",")))
    .map((parts) => parts.map((part) => part.trim()))
    .filter((parts) => (parts[0] ?? "").length > 0)
    .map((parts) => ({
      name: (parts[0] as string).slice(0, 120),
      price: (parts[1] ?? "").slice(0, 60),
      description: parts.slice(2).join(", ").slice(0, 400),
    }));
}

async function handlePendingInput(
  env: Env,
  client: TelegramClient,
  input: {
    chatId: number;
    userId: number;
    locale: Locale;
    message: TelegramMessage;
    pending: Pending;
    origin: string;
  },
): Promise<void> {
  const { pending, userId, chatId, locale } = input;
  const text = (input.message.text ?? "").trim();

  if (pending.kind === "data_file") {
    const businessId = pending.businessId;
    if (businessId === undefined || input.message.document === undefined) {
      await client.sendMessage({ chatId, text: t(locale, "dataAddBody") });
      return;
    }
    await handleDataUpload(env, client, { chatId, userId, locale, message: input.message, businessId });
    return;
  }


  if (pending.kind === "human_reply") {
    const customerId = pending.customerId;
    if (customerId === undefined) {
      return;
    }
    const customer = await customerFor(env, userId, customerId);
    const chat = await conversationForCustomer(env, {
      businessId: customer.businessId,
      chatId: customer.chatId,
    });
    if (chat === null) {
      await client.sendMessage({ chatId, text: t(locale, "convNoChat") });
      return;
    }

    // Sent through the business bot, not the console bot. The customer has
    // never seen the console bot and a message from it would look like a
    // stranger joining the conversation. A website visitor has no Telegram at
    // all: for them the reply is only stored, and their open widget collects
    // it on its next poll.
    const bot = await getBotById(env, chat.botId);
    if (bot === null) {
      await client.sendMessage({ chatId, text: t(locale, "convSendFailed") });
      return;
    }

    const reply = text.slice(0, 3500);
    const overWeb = await isWebBot(env, chat.botId);
    if (!overWeb) {
      try {
        const masterKey = await resolveMasterKey(env);
        const asBusiness = new TelegramClient(await openSealed(masterKey, bot.tokenCiphertext));
        await asBusiness.sendMessage({ chatId: chat.chatId, text: escapeHtml(reply) });
      } catch (error) {
        console.error("human reply failed", {
          businessId: customer.businessId,
          error: error instanceof Error ? error.message : String(error),
        });
        await client.sendMessage({ chatId, text: t(locale, "convSendFailed") });
        return;
      }
    }

    // Recorded as an ordinary assistant turn so the model reads it as context
    // if the chat is handed back, and marked as human so the transcript can
    // show who actually said it.
    await appendHumanMessage(env, {
      conversationId: chat.id,
      businessId: customer.businessId,
      content: reply,
    });
    await render(env, client, { chatId }, await screenFor(env, locale, userId, "conv", [customerId]));
    return;
  }

  if (pending.kind === "customer_note") {
    const customerId = pending.customerId;
    if (customerId === undefined) {
      return;
    }
    await customerFor(env, userId, customerId);
    await setCustomerNote(env, customerId, text.slice(0, 1000));
    await render(env, client, { chatId }, await screenFor(env, locale, userId, "cst", [customerId]));
    return;
  }

  if (pending.kind === "web_greeting" || pending.kind === "web_domains") {
    const businessId = pending.businessId;
    if (businessId === undefined) {
      return;
    }
    await requireAccess(env, userId, businessId);
    const channel = await getChannelForBusiness(env, businessId);
    if (channel !== null) {
      await updateChannel(
        env,
        channel.id,
        pending.kind === "web_greeting" ? { greeting: text } : { allowedOrigins: text },
      );
    }
    await render(env, client, { chatId }, await screenFor(env, locale, userId, "web", [businessId]));
    return;
  }

  if (pending.kind === "manual_product") {
    const businessId = pending.businessId;
    if (businessId === undefined) {
      return;
    }
    await requireAccess(env, userId, businessId);
    const item = parseProductLines(text)[0];
    if (item === undefined) {
      await client.sendMessage({ chatId, text: t(locale, "prodAddInvalid") });
      return;
    }
    // A typed item is a correction with nothing underneath it. It reaches the
    // assistant through the owner-updates document, like every other fact.
    await upsertCorrection(env, { businessId, ...item, removed: false });
    await syncOwnerUpdates(env, businessId);
    await render(env, client, { chatId }, await screenFor(env, locale, userId, "prod", [businessId]));
    return;
  }

  if (pending.kind === "product_fix") {
    const businessId = pending.businessId;
    const key = pending.productKey;
    if (businessId === undefined || key === undefined) {
      return;
    }
    await requireAccess(env, userId, businessId);
    const entry = (await productsView(env, businessId)).find((item) => item.key === key);
    if (entry === undefined) {
      await render(env, client, { chatId }, await screenFor(env, locale, userId, "prod", [businessId]));
      return;
    }
    const [price = "", description = ""] = text.split("|").map((part) => part.trim());
    if (price.length === 0) {
      await client.sendMessage({ chatId, text: t(locale, "prodAddInvalid") });
      return;
    }
    await upsertCorrection(env, {
      businessId,
      name: entry.name,
      price,
      description: description.length > 0 ? description : entry.description,
      removed: false,
    });
    await syncOwnerUpdates(env, businessId);
    await render(env, client, { chatId }, await screenFor(env, locale, userId, "p", [businessId, key]));
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
          text: t(locale, "dataFailed", {
            reason: escapeHtml(error instanceof Error ? error.message : "unknown error"),
          }),
        });
        return;
      }
    }
    if (prompt.length === 0) {
      await client.sendMessage({ chatId, text: t(locale, "instNothing") });
      return;
    }
    await setBusinessPrompt(env, businessId, prompt.slice(0, MAX_PROMPT_CHARS));
    await render(env, client, { chatId }, await screenFor(env, locale, userId, "inst", [businessId]));
    return;
  }

  if (pending.kind === "new_business" || pending.kind === "console_bot") {
    // Remove the credential from the transcript before doing anything slow.
    await client.deleteMessage({ chatId, messageId: input.message.message_id });

    const incoming = new TelegramClient(text);
    let me: { username?: string; first_name?: string };
    try {
      me = await incoming.getMe();
    } catch {
      await client.sendMessage({ chatId, text: t(locale, "botRejected") });
      return;
    }
    const username = me.username ?? "unknown";

    const webhookPath = generateId(24);
    const webhookSecret = generateShortId() + generateShortId();
    const sealed = await seal(await resolveMasterKey(env), text);
    const webhookSecretHash = await sha256Hex(webhookSecret);

    if (pending.kind === "console_bot") {
      // Stop the old console first so the two never answer the same operator.
      await client.deleteWebhook().catch(() => undefined);
      await putConsoleBot(env, { username, webhookPath, tokenCiphertext: sealed, webhookSecretHash });
      await incoming.setWebhook({
        url: `${input.origin}/tg/${webhookPath}`,
        secretToken: webhookSecret,
      });
      // The old bot is already detached, so this goes out through the new one.
      await incoming.sendMessage({ chatId, text: t(locale, "botMoved", { username }) });
      return;
    }

    // Refusing the console's own token is what keeps the two roles apart.
    // Connecting it as a customer bot would hand the control panel to whoever
    // finds it.
    const consoleBot = await getConsoleBot(env);
    if (consoleBot !== null && consoleBot.username === username) {
      await client.sendMessage({ chatId, text: t(locale, "bizAddSameAsConsole") });
      return;
    }

    // A business exists because a bot serves it, so the bot's own name is the
    // business name. Asking for it separately invites two names for one thing.
    let businessId = pending.businessId;
    if (businessId === undefined) {
      const business = await createBusiness(env, {
        name: (me.first_name ?? username).slice(0, 80),
        locale: env.BUSINESS_LOCALE?.trim() || "en",
        model: env.DEFAULT_MODEL,
      });
      businessId = business.id;
    } else {
      await requireAccess(env, userId, businessId);
    }

    await createBot(env, {
      businessId,
      role: "reply",
      username,
      webhookPath,
      tokenCiphertext: sealed,
      webhookSecretHash,
    });
    await incoming.setWebhook({
      url: `${input.origin}/tg/${webhookPath}`,
      secretToken: webhookSecret,
    });

    await client.sendMessage({
      chatId,
      text: t(locale, "bizAddedFromBot", {
        name: escapeHtml(me.first_name ?? username),
        username,
      }),
    });
    await render(env, client, { chatId }, await businessDetail(env, locale, userId, businessId));
    return;
  }
}

/**
 * Sends a customer's attachment into the operator's chat.
 *
 * A Telegram file id belongs to the bot that received it, so the console
 * cannot forward one a business bot was given. What it can do is ask that bot
 * for a temporary link and hand the link to Telegram, which fetches the file
 * itself. No bytes pass through the Worker and nothing is stored.
 *
 * The link carries the business bot's token and expires in about an hour,
 * which is why it is built at the moment of viewing and never written down.
 */
async function showMedia(
  env: Env,
  client: TelegramClient,
  input: { chatId: number; userId: number; locale: Locale; messageId: string },
): Promise<void> {
  const media = await getMedia(env, input.messageId);
  if (media === null) {
    await client.sendMessage({ chatId: input.chatId, text: t(input.locale, "mediaGone") });
    return;
  }

  const bot = await getBotById(env, media.botId);
  if (bot === null) {
    await client.sendMessage({ chatId: input.chatId, text: t(input.locale, "mediaGone") });
    return;
  }
  await requireAccess(env, input.userId, bot.businessId);

  try {
    const masterKey = await resolveMasterKey(env);
    const asBusiness = new TelegramClient(await openSealed(masterKey, bot.tokenCiphertext));
    const link = await asBusiness.getFileLink(media.fileId);
    await client.sendMedia({
      chatId: input.chatId,
      kind: media.kind as MediaKind,
      source: link,
      caption: media.label,
    });
  } catch (error) {
    console.error("could not show an attachment", {
      messageId: input.messageId,
      kind: media.kind,
      error: error instanceof Error ? error.message : String(error),
    });
    await client.sendMessage({ chatId: input.chatId, text: t(input.locale, "mediaFailed") });
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

  const locale = await localeFor(env, callback.from.id);

  try {
    let decoded = decodeCallback(callback.data);
    if (isCallbackRef(decoded)) {
      const resolved = await resolveSpilled(env, callbackRefKey(decoded));
      if (resolved === null) {
        await client.answerCallbackQuery({ id: callback.id, text: t(locale, "expired") });
        await render(env, client, { chatId: callback.message.chat.id }, homeScreen(locale));
        return;
      }
      decoded = resolved;
    }

    // Handled here rather than as a screen, because an attachment cannot live
    // inside the message the console keeps editing. It arrives as its own.
    if (decoded.action === "med") {
      await showMedia(env, client, {
        chatId: callback.message.chat.id,
        userId: callback.from.id,
        locale,
        messageId: decoded.args[0] ?? "",
      });
      return;
    }

    const screen = await screenFor(env, locale, callback.from.id, decoded.action, decoded.args);
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
    await client.answerCallbackQuery({ id: callback.id, text: t(locale, "failed") });
  }
}
