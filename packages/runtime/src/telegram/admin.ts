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
  type Product,
} from "@muxel/core";

import { seal, sha256Hex } from "../crypto.js";
import {
  canAccessBusiness,
  createBot,
  createBusiness,
  createProduct,
  deleteBusiness,
  deleteProduct,
  findOperator,
  forgetCustomer,
  forgetFacts,
  getConsoleBot,
  getBusiness,
  getCustomer,
  getOperatorLocale,
  getProduct,
  listBots,
  listBusinesses,
  listCustomers,
  listDocuments,
  listFacts,
  listProducts,
  previousPrompt,
  putConsoleBot,
  setBusinessPrompt,
  setCustomerNote,
  setCustomerStage,
  setOperatorLocale,
  todayUsage,
  updateBusinessModel,
} from "../db/queries.js";
import type { Env } from "../env.js";
import {
  ingestDocument,
  MAX_DOCUMENT_BYTES,
  readUpload,
  removeDocument,
  syncProductCatalogue,
} from "../rag/ingest.js";
import { resolveMasterKey } from "../secrets.js";
import { isLocale, LOCALE_NAMES, LOCALES, t, type Locale, type MessageKey } from "./i18n.js";
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
  | "product_line"
  | "product_file"
  | "data_file";

interface Pending {
  readonly kind: PendingKind;
  readonly businessId?: string;
  readonly customerId?: string;
  readonly role?: "admin" | "reply";
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
      row({ text: t(locale, "btnConsoleBot"), action: "console" }),
      row(
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

function productsScreen(locale: Locale, business: Business, products: readonly Product[]): Screen {
  return {
    text: [
      `<b>${t(locale, "prodTitle", { name: escapeHtml(business.name) })}</b>`,
      "",
      products.length === 0 ? t(locale, "prodEmpty") : `${products.length}`,
    ].join("\n"),
    rows: [
      ...products
        .slice(0, LIST_LIMIT)
        .map((product) =>
          row({
            text: product.price.length > 0 ? `${product.name} - ${product.price}` : product.name,
            action: "p",
            args: [product.id],
          }),
        ),
      row({ text: t(locale, "btnAddProduct"), action: "prodadd", args: [business.id] }),
      row({ text: t(locale, "btnBulkProducts"), action: "prodbulk", args: [business.id] }),
      backTo(locale, "biz", [business.id]),
    ],
  };
}

function productScreen(locale: Locale, product: Product): Screen {
  return {
    text: [
      `<b>${escapeHtml(product.name)}</b>`,
      product.price.length > 0 ? escapeHtml(product.price) : "",
      product.description.length > 0 ? escapeHtml(product.description) : "",
    ]
      .filter((line) => line !== "")
      .join("\n"),
    rows: [
      row({ text: t(locale, "btnDeleteProduct"), action: "pdel", args: [product.id] }),
      backTo(locale, "prod", [product.businessId]),
    ],
  };
}

function instructionsScreen(locale: Locale, business: Business, hasPrevious: boolean): Screen {
  return {
    text: [
      `<b>${t(locale, "instTitle", { name: escapeHtml(business.name) })}</b>`,
      "",
      t(locale, "instBody"),
      "",
      business.systemPrompt.length > 0
        ? escapeHtml(truncate(business.systemPrompt, 600))
        : `<i>${t(locale, "instUsingDefault")}</i>`,
    ].join("\n"),
    rows: [
      row({ text: t(locale, "btnEditInstructions"), action: "instset", args: [business.id] }),
      ...(hasPrevious
        ? [row({ text: t(locale, "btnUndoInstructions"), action: "instundo", args: [business.id] })]
        : []),
      ...(business.systemPrompt.length > 0
        ? [row({ text: t(locale, "btnResetInstructions"), action: "instclr", args: [business.id] })]
        : []),
      backTo(locale, "biz", [business.id]),
    ],
  };
}

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

async function productFor(env: Env, userId: number, productId: string): Promise<Product> {
  const product = await getProduct(env, productId);
  await requireAccess(env, userId, product.businessId);
  return product;
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
    listProducts(env, businessId),
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
      const [business, products] = await Promise.all([
        getBusiness(env, businessId),
        listProducts(env, businessId),
      ]);
      return productsScreen(locale, business, products);
    }

    case "prodadd": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      await setPending(env, userId, { kind: "product_line", businessId });
      return {
        text: `<b>${t(locale, "prodAddTitle")}</b>\n\n${t(locale, "prodAddBody")}`,
        rows: [row({ text: t(locale, "cancel"), action: "prod", args: [businessId] })],
      };
    }

    case "prodbulk": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      await setPending(env, userId, { kind: "product_file", businessId });
      return {
        text: [
          `<b>${t(locale, "btnBulkProducts")}</b>`,
          "",
          t(locale, "dataAddBody"),
          "",
          t(locale, "prodAddBody"),
        ].join("\n"),
        rows: [row({ text: t(locale, "cancel"), action: "prod", args: [businessId] })],
      };
    }

    case "p":
      return productScreen(locale, await productFor(env, userId, requireArg(args, 0)));

    case "pdel": {
      const product = await productFor(env, userId, requireArg(args, 0));
      return confirmScreen(
        locale,
        t(locale, "prodDeleteConfirm", { name: escapeHtml(product.name) }),
        { action: "pdely", args: [product.id] },
        { action: "p", args: [product.id] },
      );
    }

    case "pdely": {
      const product = await productFor(env, userId, requireArg(args, 0));
      await deleteProduct(env, product.id);
      await syncProductCatalogue(env, product.businessId);
      return screenFor(env, locale, userId, "prod", [product.businessId]);
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

    case "instset": {
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
      await setPending(env, userId, { kind: "instructions", businessId });
      return {
        text: `<b>${t(locale, "btnEditInstructions")}</b>\n\n${t(locale, "instEditBody", { limit: MAX_PROMPT_CHARS })}`,
        rows: [row({ text: t(locale, "cancel"), action: "inst", args: [businessId] })],
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
      const businessId = requireArg(args, 0);
      await requireAccess(env, userId, businessId);
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
      text: t(locale, "dataAdded", {
        name: escapeHtml(file.filename),
        chunks: result.chunkCount,
      }),
    });
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
export function parseProductLines(text: string): { name: string; price: string; description: string }[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
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

  if (pending.kind === "product_line" || pending.kind === "product_file") {
    const businessId = pending.businessId;
    if (businessId === undefined) {
      return;
    }
    await requireAccess(env, userId, businessId);

    let source = text;
    if (input.message.document !== undefined) {
      try {
        const file = await download(client, input.message);
        source = await readUpload(env, {
          businessId,
          filename: file.filename,
          contentType: file.contentType,
          body: file.body,
        });
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

    const parsed = parseProductLines(source);
    if (parsed.length === 0) {
      await client.sendMessage({ chatId, text: t(locale, "prodAddInvalid") });
      return;
    }
    for (const item of parsed) {
      await createProduct(env, { businessId, ...item });
    }
    const total = await syncProductCatalogue(env, businessId);
    await client.sendMessage({ chatId, text: t(locale, "prodSynced", { count: total }) });
    await render(env, client, { chatId }, await screenFor(env, locale, userId, "prod", [businessId]));
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
