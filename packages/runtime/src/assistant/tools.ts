/**
 * What the owner's assistant can do, and which of those needs asking first.
 *
 * Every tool declares whether it writes. A read runs the moment the model asks
 * for it; a write is never executed by the model at all. It is described back
 * to the owner, who says yes or no, and only their yes runs it. That is the
 * whole of the human in the loop here, and it is a property of the tool rather
 * than a decision made at the call site, so a tool added later cannot arrive
 * without one.
 *
 * The handlers are the same functions the console's own pages call. There is no
 * second way to change anything: whatever the assistant does, an owner could
 * have done by hand, and it shows up in the same places.
 */

import type { Env } from "../env.js";
import {
  canAccessBusiness,
  deleteNote,
  deleteRule,
  getAgentSetting,
  getBusiness,
  getProfile,
  listBusinesses,
  listCustomers,
  listDocuments,
  listNotes,
  listRules,
  saveAgentSetting,
  saveNote,
  saveProfile,
  saveRule,
  setBotEnabled,
  setBusinessPrompt,
  todayUsage,
  transcript,
  updateBusinessModel,
  RULE_KINDS,
  type RuleKind,
} from "../db/queries.js";
import { listHandovers } from "../db/queries.js";
import { productsView, saveProductEntry } from "../products.js";
import { syncNotes } from "../rag/ingest.js";
import { retrieve } from "../rag/retrieve.js";
import { conversationForCustomer, getCustomer } from "../db/queries.js";
import { MODEL_PRESETS } from "../telegram/admin.js";
import type { ToolSpec } from "../ai/gateway.js";

export interface ToolContext {
  readonly env: Env;
  /** The operator asking. Every business id is checked against them. */
  readonly userId: number;
}

export interface AssistantTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  /**
   * Whether running this changes something.
   *
   * A write is never run by the model. It is turned into a question for the
   * owner, and their answer runs it.
   */
  readonly writes: boolean;
  /** One line describing the pending change, shown on the approval card. */
  readonly summarise?: (args: Record<string, unknown>) => string;
  readonly run: (ctx: ToolContext, args: Record<string, unknown>) => Promise<unknown>;
}

const str = (args: Record<string, unknown>, key: string): string =>
  typeof args[key] === "string" ? (args[key] as string) : "";

const bool = (args: Record<string, unknown>, key: string): boolean | undefined =>
  typeof args[key] === "boolean" ? (args[key] as boolean) : undefined;

/** Refuses a business the asker cannot see, before anything reads it. */
async function reachable(ctx: ToolContext, businessId: string): Promise<string> {
  if (businessId.length === 0) throw new Error("Which business? Give its id from list_businesses.");
  if (!(await canAccessBusiness(ctx.env, ctx.userId, businessId))) {
    throw new Error("That business is not one you can see.");
  }
  return businessId;
}

const BUSINESS_ARG = {
  business_id: { type: "string", description: "From list_businesses." },
} as const;

export const TOOLS: readonly AssistantTool[] = [
  {
    name: "list_businesses",
    description: "Every business this owner has, with its name, model and channels.",
    parameters: { type: "object", properties: {}, required: [] },
    writes: false,
    run: async (ctx) => {
      const businesses = await listBusinesses(ctx.env, ctx.userId);
      return Promise.all(
        businesses.map(async (business) => ({
          id: business.id,
          name: business.name,
          model: business.model,
          usageToday: await todayUsage(ctx.env, business.id),
        })),
      );
    },
  },
  {
    name: "get_business",
    description:
      "One business in full: its profile, standing rules, notes, price list, documents and settings.",
    parameters: { type: "object", properties: { ...BUSINESS_ARG }, required: ["business_id"] },
    writes: false,
    run: async (ctx, args) => {
      const id = await reachable(ctx, str(args, "business_id"));
      const [business, profile, rules, notes, products, documents, setting] = await Promise.all([
        getBusiness(ctx.env, id),
        getProfile(ctx.env, id),
        listRules(ctx.env, id),
        listNotes(ctx.env, id),
        productsView(ctx.env, id),
        listDocuments(ctx.env, id, 50),
        getAgentSetting(ctx.env, id),
      ]);
      return {
        name: business.name,
        model: business.model,
        persona: business.systemPrompt,
        profile,
        rules,
        notes,
        products,
        documents: documents.map((d) => ({
          filename: d.filename,
          status: d.status,
          pieces: d.chunkCount,
        })),
        rememberCustomers: setting.rememberCustomers,
      };
    },
  },
  {
    name: "search_knowledge",
    description:
      "Ask this business's own knowledge a question, exactly as a customer's message would. "
      + "Use it to check what the agent would find before answering, or to see why it said something.",
    parameters: {
      type: "object",
      properties: {
        ...BUSINESS_ARG,
        question: { type: "string", description: "The question to search with." },
      },
      required: ["business_id", "question"],
    },
    writes: false,
    run: async (ctx, args) => {
      const id = await reachable(ctx, str(args, "business_id"));
      const chunks = await retrieve(ctx.env, id, str(args, "question"));
      return chunks.length === 0
        ? { found: 0, note: "Nothing matched. The agent would say it does not know." }
        : { found: chunks.length, passages: chunks.map((chunk) => chunk.text.slice(0, 500)) };
    },
  },
  {
    name: "list_waiting",
    description:
      "Conversations where a customer is waiting for a person, across every business. "
      + "This is what the owner should look at first.",
    parameters: { type: "object", properties: {}, required: [] },
    writes: false,
    run: async (ctx) => {
      const visible = new Set((await listBusinesses(ctx.env, ctx.userId)).map((b) => b.id));
      return (await listHandovers(ctx.env, 40))
        .filter((handover) => visible.has(handover.businessId))
        .map((handover) => ({
          customerId: handover.customerId,
          customer: handover.customerName,
          business: handover.businessName,
          state: handover.state,
          reason: handover.reason,
          since: handover.updatedAt,
        }));
    },
  },
  {
    name: "list_customers",
    description:
      "Who has written to a business, most recent first, with how many messages each has sent.",
    parameters: { type: "object", properties: { ...BUSINESS_ARG }, required: ["business_id"] },
    writes: false,
    run: async (ctx, args) => {
      const id = await reachable(ctx, str(args, "business_id"));
      return (await listCustomers(ctx.env, id, 40)).map((customer) => ({
        id: customer.id,
        name: customer.displayName || customer.username,
        messages: customer.messageCount,
        stage: customer.stage,
        lastSeen: customer.lastSeen,
      }));
    },
  },
  {
    name: "read_conversation",
    description:
      "What was actually said to and by the agent in one conversation, oldest first. "
      + "Use it to check a complaint rather than guessing at what happened.",
    parameters: {
      type: "object",
      properties: { customer_id: { type: "string", description: "From list_customers or list_waiting." } },
      required: ["customer_id"],
    },
    writes: false,
    run: async (ctx, args) => {
      const customer = await getCustomer(ctx.env, str(args, "customer_id"));
      await reachable(ctx, customer.businessId);
      const chat = await conversationForCustomer(ctx.env, {
        businessId: customer.businessId,
        chatId: customer.chatId,
      });
      if (chat === null) return { messages: [] };
      const messages = await transcript(ctx.env, chat.id, 60);
      return {
        customer: customer.displayName || customer.username,
        messages: messages.map((message) => ({
          who: message.role === "user" ? "customer" : message.sentBy === "human" ? "you" : "agent",
          said: message.content,
          at: message.createdAt,
        })),
      };
    },
  },

  // ---- writes, every one of which is asked about first --------------------

  {
    name: "set_model",
    description:
      "Change which model a business answers its customers with. A bigger one reads more before "
      + "it answers and uses more of the daily allowance.",
    parameters: {
      type: "object",
      properties: {
        ...BUSINESS_ARG,
        model: { type: "string", enum: MODEL_PRESETS.map((preset) => preset.id) },
      },
      required: ["business_id", "model"],
    },
    writes: true,
    summarise: (args) =>
      `Answer with ${MODEL_PRESETS.find((p) => p.id === str(args, "model"))?.label ?? str(args, "model")}`,
    run: async (ctx, args) => {
      const id = await reachable(ctx, str(args, "business_id"));
      const model = str(args, "model");
      if (!MODEL_PRESETS.some((preset) => preset.id === model)) throw new Error("Not a model on the list.");
      await updateBusinessModel(ctx.env, id, model);
      return { ok: true };
    },
  },
  {
    name: "set_persona",
    description:
      "Replace how the agent speaks: its tone, and what it will and will not promise. "
      + "Replaces the whole persona, so read it first with get_business.",
    parameters: {
      type: "object",
      properties: { ...BUSINESS_ARG, persona: { type: "string" } },
      required: ["business_id", "persona"],
    },
    writes: true,
    summarise: (args) => `Rewrite the persona (${str(args, "persona").length} characters)`,
    run: async (ctx, args) => {
      const id = await reachable(ctx, str(args, "business_id"));
      await setBusinessPrompt(ctx.env, id, str(args, "persona").slice(0, 8000));
      return { ok: true };
    },
  },
  {
    name: "save_rule",
    description:
      "Add or edit one standing instruction. Leave rule_id out to add. "
      + "Kinds: faq, escalation, delivery, payment, refund, other.",
    parameters: {
      type: "object",
      properties: {
        ...BUSINESS_ARG,
        rule_id: { type: "string" },
        kind: { type: "string", enum: [...RULE_KINDS] },
        content: { type: "string" },
        active: { type: "boolean" },
      },
      required: ["business_id", "kind", "content"],
    },
    writes: true,
    summarise: (args) =>
      `${str(args, "rule_id") === "" ? "Add" : "Change"} a ${str(args, "kind")} rule: ${str(args, "content").slice(0, 90)}`,
    run: async (ctx, args) => {
      const id = await reachable(ctx, str(args, "business_id"));
      const kind = str(args, "kind") as RuleKind;
      if (!RULE_KINDS.includes(kind)) throw new Error("Not a rule kind.");
      const ruleId = str(args, "rule_id");
      return saveRule(ctx.env, id, {
        ...(ruleId === "" ? {} : { id: ruleId }),
        kind,
        content: str(args, "content"),
        ...(bool(args, "active") === undefined ? {} : { active: bool(args, "active") as boolean }),
      });
    },
  },
  {
    name: "delete_rule",
    description:
      "Remove one standing instruction, by its id from get_business. To stop it without losing it, "
      + "save_rule with active false instead.",
    parameters: {
      type: "object",
      properties: { ...BUSINESS_ARG, rule_id: { type: "string" } },
      required: ["business_id", "rule_id"],
    },
    writes: true,
    summarise: () => "Remove a standing instruction",
    run: async (ctx, args) => {
      const id = await reachable(ctx, str(args, "business_id"));
      return deleteRule(ctx.env, id, str(args, "rule_id"));
    },
  },
  {
    name: "save_note",
    description:
      "Write down something the business knows that is not a price and not in a file. "
      + "Indexed straight away, so the agent can find it immediately.",
    parameters: {
      type: "object",
      properties: {
        ...BUSINESS_ARG,
        note_id: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
      },
      required: ["business_id", "body"],
    },
    writes: true,
    summarise: (args) =>
      `${str(args, "note_id") === "" ? "Add" : "Change"} the note "${str(args, "title") || "untitled"}"`,
    run: async (ctx, args) => {
      const id = await reachable(ctx, str(args, "business_id"));
      const noteId = str(args, "note_id");
      const notes = await saveNote(ctx.env, id, {
        ...(noteId === "" ? {} : { id: noteId }),
        title: str(args, "title"),
        body: str(args, "body"),
      });
      await syncNotes(ctx.env, id);
      return notes;
    },
  },
  {
    name: "delete_note",
    description:
      "Remove one note, by its id from get_business. The agent stops finding it immediately.",
    parameters: {
      type: "object",
      properties: { ...BUSINESS_ARG, note_id: { type: "string" } },
      required: ["business_id", "note_id"],
    },
    writes: true,
    summarise: () => "Remove a note",
    run: async (ctx, args) => {
      const id = await reachable(ctx, str(args, "business_id"));
      const notes = await deleteNote(ctx.env, id, str(args, "note_id"));
      await syncNotes(ctx.env, id);
      return notes;
    },
  },
  {
    name: "save_profile",
    description:
      "Set any of the business's own facts: kind, about, address, mapUrl, hours, phone, email, "
      + "website, facebook. Only the fields given are changed.",
    parameters: {
      type: "object",
      properties: {
        ...BUSINESS_ARG,
        kind: { type: "string" },
        about: { type: "string" },
        address: { type: "string" },
        mapUrl: { type: "string" },
        hours: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        website: { type: "string" },
        facebook: { type: "string" },
      },
      required: ["business_id"],
    },
    writes: true,
    summarise: (args) =>
      `Set ${Object.keys(args).filter((key) => key !== "business_id").join(", ") || "nothing"}`,
    run: async (ctx, args) => {
      const id = await reachable(ctx, str(args, "business_id"));
      const { business_id: _ignored, ...rest } = args;
      const patch: Record<string, string> = {};
      for (const [key, value] of Object.entries(rest)) {
        if (typeof value === "string") patch[key] = value;
      }
      return saveProfile(ctx.env, id, patch);
    },
  },
  {
    name: "save_price",
    description:
      "Add or correct one item on the price list. The agent quotes from this and nowhere else.",
    parameters: {
      type: "object",
      properties: {
        ...BUSINESS_ARG,
        name: { type: "string" },
        price: { type: "string" },
        description: { type: "string" },
      },
      required: ["business_id", "name"],
    },
    writes: true,
    summarise: (args) => `Price: ${str(args, "name")} at ${str(args, "price") || "no price"}`,
    run: async (ctx, args) => {
      const id = await reachable(ctx, str(args, "business_id"));
      await saveProductEntry(ctx.env, {
        businessId: id,
        name: str(args, "name"),
        price: str(args, "price"),
        description: str(args, "description"),
        removed: false,
      });
      return productsView(ctx.env, id);
    },
  },
  {
    name: "remove_price",
    description: "Stop the agent quoting one item, even if a document still lists it.",
    parameters: {
      type: "object",
      properties: { ...BUSINESS_ARG, name: { type: "string" } },
      required: ["business_id", "name"],
    },
    writes: true,
    summarise: (args) => `Stop quoting ${str(args, "name")}`,
    run: async (ctx, args) => {
      const id = await reachable(ctx, str(args, "business_id"));
      await saveProductEntry(ctx.env, {
        businessId: id,
        name: str(args, "name"),
        price: "",
        description: "",
        removed: true,
      });
      return productsView(ctx.env, id);
    },
  },
  {
    name: "set_features",
    description:
      "Switch a business's channels or its memory on or off. "
      + "telegram and web stop it answering there; remember stops it noting things about customers.",
    parameters: {
      type: "object",
      properties: {
        ...BUSINESS_ARG,
        telegram: { type: "boolean" },
        web: { type: "boolean" },
        remember: { type: "boolean" },
      },
      required: ["business_id"],
    },
    writes: true,
    summarise: (args) =>
      Object.entries(args)
        .filter(([key]) => key !== "business_id")
        .map(([key, value]) => `${key} ${value === true ? "on" : "off"}`)
        .join(", ") || "nothing",
    run: async (ctx, args) => {
      const id = await reachable(ctx, str(args, "business_id"));
      const telegram = bool(args, "telegram");
      if (telegram !== undefined) await setBotEnabled(ctx.env, id, telegram);
      const remember = bool(args, "remember");
      if (remember !== undefined) {
        await saveAgentSetting(ctx.env, id, { rememberCustomers: remember });
      }
      return { ok: true, note: bool(args, "web") === undefined ? undefined : "web handled by the caller" };
    },
  },
];

export const TOOL_SPECS: readonly ToolSpec[] = TOOLS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  parameters: tool.parameters,
}));

export function findTool(name: string): AssistantTool | undefined {
  return TOOLS.find((tool) => tool.name === name);
}
