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
  createBusiness,
  deleteBusiness,
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
import { productsView, saveProductEntry, follow, type After } from "../products.js";
import { addDocument, syncNotes } from "../rag/ingest.js";
import { attachmentByName, attachmentNames } from "./store.js";
import { retrieve } from "../rag/retrieve.js";
import { createChannel } from "../web/channel.js";
import { conversationForCustomer, getCustomer } from "../db/queries.js";
import { MODEL_PRESETS } from "../telegram/admin.js";
import type { ToolSpec } from "../ai/gateway.js";

export interface ToolContext {
  readonly env: Env;
  /** The operator asking. Every business id is checked against them. */
  readonly userId: number;
  /**
   * Work that may finish after the answer has gone out, such as re-indexing
   * what a change altered. Absent on paths with no way to do that, which then
   * wait for it. See products.ts follow().
   */
  readonly after?: After;
  /**
   * The conversation this is running in.
   *
   * Only the file tools need it, and they need it because a file is found by
   * the name the owner gave it, which is unique to a conversation rather than
   * to the whole account.
   */
  readonly chatId?: string;
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

/** How much of a file comes back in one read. */
const FILE_PIECE_CHARS = 6000;

const num = (args: Record<string, unknown>, key: string): number | undefined =>
  typeof args[key] === "number" ? (args[key] as number) : undefined;

/**
 * A file the owner sent in this conversation, or a refusal it can act on.
 *
 * Named, not identified. The model is told the filenames when the turn opens
 * and hands one back; an id would be a string only this deployment understands,
 * shown on a card the owner has to read.
 */
async function sentFile(
  ctx: ToolContext,
  filename: string,
): Promise<{ filename: string; text: string }> {
  if (filename.length === 0) throw new Error("Which file? Name it as the owner sent it.");
  const chatId = ctx.chatId ?? "";
  const file = chatId === "" ? null : await attachmentByName(ctx.env, ctx.userId, chatId, filename);
  if (file === null) {
    const sent = chatId === "" ? [] : await attachmentNames(ctx.env, ctx.userId, chatId);
    throw new Error(
      sent.length === 0
        ? "No file has been sent in this conversation."
        : `No file called ${filename} here. Sent in this conversation: ${sent.join(", ")}.`,
    );
  }
  return file;
}

/** Refuses a business the asker cannot see, before anything reads it. */
async function reachable(ctx: ToolContext, businessId: string): Promise<string> {
  if (businessId.length === 0) throw new Error("Which business? Give its id from list_businesses.");
  // Existence, then access. Access alone answered yes for an owner whatever the
  // id was, so a change to a business that was never there ran, wrote a row
  // nothing would ever read, and reported Done. A card is also bound at
  // proposal time (assistant/target.ts); this is the same check at the second
  // door, because a business can be deleted between the card and the tap.
  const exists = await ctx.env.DB.prepare("SELECT 1 AS ok FROM business WHERE id = ?")
    .bind(businessId)
    .first<{ ok: number }>();
  if (exists === null) throw new Error("There is no business with that id. Use list_businesses.");
  if (!(await canAccessBusiness(ctx.env, ctx.userId, businessId))) {
    throw new Error("That business is not one you can see.");
  }
  return businessId;
}

const BUSINESS_ARG = {
  business_id: { type: "string", description: "From list_businesses." },
} as const;

/**
 * The one tool that neither reads nor writes.
 *
 * A question is not work. The model calls this when it does not have enough to
 * go on, the loop stops there, and the owner's answer is what starts the next
 * turn. Without it the model either guessed the missing half or wrote a
 * question into an answer that the loop then treated as finished, and an owner
 * who replied to that question was starting a new subject as far as it knew.
 *
 * Deliberately not a write. Nothing changes, so nothing waits for approval —
 * the question itself is the approval.
 */
export const ASK_OWNER = "ask_owner";

export const TOOLS: readonly AssistantTool[] = [
  {
    name: ASK_OWNER,
    description:
      "Ask the owner one question and stop, when you need something only they can tell you. "
      + "Give choices when the answer is one of a few things, so they can tap instead of type. "
      + "Ask one thing at a time. Do not use this to confirm a change: a change already asks.",
    writes: false,
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "One question, in their language." },
        choices: {
          type: "array",
          items: { type: "string" },
          description: "Up to five short answers they can tap. Omit for an open question.",
        },
      },
      required: ["question"],
    },
    // Never reached: the loop stops at this tool rather than running it. It is
    // here so the tool table stays the one list of what the model may call.
    run: async () => ({ asked: true }),
  },
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
        // The id goes with them so the model can say which document it means
        // when it reports back, rather than describing one by filename and
        // leaving the owner to work out which upload it read.
        documents: documents.map((d) => ({
          id: d.id,
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
      await follow(ctx.after, syncNotes(ctx.env, id), "the notes index");
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
      await follow(ctx.after, syncNotes(ctx.env, id), "the notes index");
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
    name: "read_file",
    description:
      "Read a file the owner sent in this conversation, by the name it was sent under. Comes back "
      + "as text, in pieces for a long one: `from` is the character to start at, and the reply says "
      + "whether there is more.",
    parameters: {
      type: "object",
      properties: {
        filename: { type: "string" },
        from: { type: "number", description: "Character to start at. 0 for the beginning." },
      },
      required: ["filename"],
    },
    writes: false,
    run: async (ctx, args) => {
      const file = await sentFile(ctx, str(args, "filename"));
      const from = Math.max(0, Math.floor(num(args, "from") ?? 0));
      const piece = file.text.slice(from, from + FILE_PIECE_CHARS);
      return {
        filename: file.filename,
        text: piece,
        // Said rather than left to be worked out from lengths, because a model
        // that stops halfway through a price list quotes half a price list.
        more: from + piece.length < file.text.length
          ? `There are ${file.text.length - from - piece.length} more characters. Call read_file again with from ${from + piece.length}.`
          : "That is the whole file.",
      };
    },
  },
  {
    name: "add_file_to_business",
    description:
      "Put a file the owner sent into one business's knowledge, so its agent can answer from it. "
      + "If it holds a price list, the prices are pulled out of it as well. Name the file exactly "
      + "as it was sent.",
    parameters: {
      type: "object",
      properties: { ...BUSINESS_ARG, filename: { type: "string" } },
      required: ["business_id", "filename"],
    },
    writes: true,
    summarise: (args) => `Add ${str(args, "filename")} to what it knows`,
    run: async (ctx, args) => {
      const id = await reachable(ctx, str(args, "business_id"));
      const file = await sentFile(ctx, str(args, "filename"));
      // As text, because text is what was kept. The bytes were read once on
      // arrival and a second reading of a photograph would cost the owner the
      // same call twice and could disagree with the first. Handed on as text,
      // not as text turned back into bytes: under the file's own name those
      // bytes read as a PDF to be converted, and a plain-text "PDF" is a
      // conversion that fails every time.
      const result = await addDocument(ctx.env, {
        businessId: id,
        filename: file.filename,
        text: file.text,
      });
      return { added: file.filename, pieces: result.chunkCount, searchable: result.searchable };
    },
  },
  {
    name: "save_price",
    description:
      "Add or correct one item on the price list. The agent quotes from this and nowhere else. "
      + "business_id must be a business that exists now: one you are creating in this message has "
      + "no id yet, so propose its prices in your next message, once the owner has said yes to it.",
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
      }, ctx.after);
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
      }, ctx.after);
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
  {
    name: "create_business",
    description:
      "Create a business. A business is one agent: one set of material, one voice, and the channels "
      + "it answers on. Ask the owner for the name first, and for anything else you put here — never "
      + "invent an address, a phone number or a description. Everything except the name is optional "
      + "and can be added later.",
    writes: true,
    summarise: (args) =>
      `Create the business "${str(args, "name")}"${
        str(args, "about").length > 0 ? `, described as: ${str(args, "about").slice(0, 90)}` : ""
      }`,
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "What the owner calls it. 1 to 80 characters." },
        about: { type: "string", description: "What it sells or does, in the owner's own words." },
        address: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        website: { type: "string" },
        facebook: { type: "string" },
        hours: { type: "string", description: "When it is open, as the owner said it." },
      },
      required: ["name"],
    },
    run: async (ctx, args) => {
      const name = str(args, "name").trim();
      if (name.length === 0 || name.length > 80) {
        throw new Error("A business needs a name of 1 to 80 characters.");
      }
      const business = await createBusiness(ctx.env, {
        name,
        locale: ctx.env.BUSINESS_LOCALE?.trim() || "en",
        model: ctx.env.DEFAULT_MODEL,
      });
      // The same two steps the console's own create does, in the same order.
      // A second way to make a business is a second set of defaults to keep in
      // step, so this calls what that calls.
      const profile: Record<string, string> = {};
      for (const key of ["about", "address", "phone", "email", "website", "facebook", "hours"]) {
        const value = str(args, key).trim();
        if (value.length > 0) profile[key] = value;
      }
      if (Object.keys(profile).length > 0) await saveProfile(ctx.env, business.id, profile);
      await createChannel(ctx.env, { businessId: business.id, title: name });
      return {
        created: business.id,
        name,
        answers_on: "the website widget, from now. Telegram is the part that has to be added.",
      };
    },
  },
  {
    name: "delete_business",
    description:
      "Delete a business and everything in it: its material, its conversations and its channels. "
      + "Only when the owner has asked for exactly this.",
    writes: true,
    summarise: () => "Delete the business and everything in it",
    parameters: { type: "object", properties: BUSINESS_ARG, required: ["business_id"] },
    run: async (ctx, args) => {
      const businessId = await reachable(ctx, str(args, "business_id"));
      await deleteBusiness(ctx.env, businessId);
      return { deleted: businessId };
    },
  },
  {
    name: "connect_telegram",
    description:
      "Start connecting a Telegram bot to a business. The owner types the bot token into the console "
      + "themselves — you never see it and must never ask them to type it to you. Use this when they "
      + "want their agent to answer on Telegram.",
    writes: false,
    parameters: { type: "object", properties: BUSINESS_ARG, required: ["business_id"] },
    // Handled by the loop, which turns it into a token field in the console.
    // Running it here would mean this tool had the token, and the whole point
    // is that nothing on the model's side ever does.
    run: async (ctx, args) => {
      await reachable(ctx, str(args, "business_id"));
      return { asked: true };
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
