/**
 * The console's data API.
 *
 * The first web console rendered the Telegram screens as they were, which put
 * a phone keyboard on a desktop: one question at a time, a Back button instead
 * of navigation, and no way to see two things at once. Fine on a phone, wrong
 * at a desk with a price list to upload and a hundred conversations to read.
 *
 * So the browser gets data and lays it out itself. The Telegram console keeps
 * its screens, this returns the same facts as JSON, and both read the same
 * database through the same query layer. Nothing about the business logic is
 * written twice; only the presentation differs, which is the part that should.
 */

import {
  canAccessBusiness,
  createBusiness,
  deleteBusiness,
  endHandover,
  getBusiness,
  getCustomer,
  getHandover,
  listBots,
  listBusinesses,
  listCustomers,
  listDocuments,
  listEvents,
  takeOverConversation,
  todayUsage,
  todayUsageAll,
  transcript,
  conversationForCustomer,
  createBot,
  forgetCustomer,
  forgetFacts,
  getOperatorLocale,
  getAgentSetting,
  getProfile,
  listFacts,
  listHandovers,
  previousPrompt,
  deleteRule,
  listNotes,
  listRules,
  renameBusiness,
  RULE_KINDS,
  saveAgentSetting,
  saveNote,
  saveRule,
  deleteNote,
  setBotEnabled,
  saveProfile,
  setBusinessPrompt,
  setCustomerNote,
  setCustomerStage,
  setOperatorLocale,
  deleteConversationById,
  deleteMessageRow,
  findOperator,
  getMedia,
  getMessageRow,
  getConsoleBot,
  putConsoleBot,
  updateBusinessModel,
  updateMessageContent,
  wireFor,
} from "../db/queries.js";
import { createChannel, getChannelForBusiness, updateChannel } from "./channel.js";
import {
  channelSplit,
  customersPage,
  lastActivity,
  recentConversations,
  search as searchRecords,
  unaidedShare,
  usageSeries,
} from "../db/insights.js";
import { clientForBot, sendHumanMedia, sendHumanReply } from "../human-reply.js";
import { seal, sha256Hex } from "../crypto.js";
import { generateId, generateShortId } from "@muxel/core";
import { resolveMasterKey } from "../secrets.js";
import { ORIGIN_KEY } from "../setup.js";
import { TelegramClient, type MediaKind } from "../telegram/api.js";
import { escapeHtml } from "../telegram/format.js";
import { clearSecret, getSecret, hasSecret, putSecret } from "./secrets-vault.js";
import { runSelfUpdate, sourceRepoFor, SOURCE_REPO_KEY } from "./self-update.js";
import { isRepoSlug } from "../repo.js";
import { versionStatus } from "../updates.js";
import { ask } from "../assistant/loop.js";
import { decide } from "../assistant/decide.js";
import { allowanceNow, neuronsFor, type Allowance } from "../cloudflare/allowance.js";
import { accountName, workersSubdomain } from "../cloudflare/account.js";
import { cloudflareAccess, forgetAccess } from "../cloudflare/access.js";
import {
  chatTranscript,
  promptsFor,
  stepsFor,
  usageFor,
  createChat,
  deleteChat,
  getChat,
  chatOfApproval,
  listChatApprovals,
  listChats,
  setChatModel,
  titleFrom,
} from "../assistant/store.js";
import {
  addDocument,
  GENERATED_DOCUMENTS,
  NOTES_FILENAME,
  removeDocument,
  syncNotes,
} from "../rag/ingest.js";
import { SKILLS } from "../telegram/skills.js";
import { LOCALE_NAMES, LOCALES, isLocale } from "../telegram/i18n.js";
import { missingConfiguration } from "../env.js";
import { TARGET_VERSION, currentVersion } from "../db/migrate.js";
import { UPSTREAM_REPO_URL } from "../version.js";
import type { Env } from "../env.js";
import { MAX_PROMPT_CHARS, MODEL_PRESETS } from "../telegram/admin.js";
import { productsView, saveProductEntry } from "../products.js";
import { OWNER_UPDATES_FILENAME, markExtractionPending, pendingExtractions, runExtraction } from "../rag/extract.js";
import { CORS, json, operatorFor } from "./console.js";

/** A business as the console draws it: what it is, where it answers, what it cost. */
async function businessCard(env: Env, businessId: string) {
  const [business, bots, channel, usage, customers] = await Promise.all([
    getBusiness(env, businessId),
    listBots(env, businessId),
    getChannelForBusiness(env, businessId),
    todayUsage(env, businessId),
    listCustomers(env, businessId, 100),
  ]);
  const telegram = bots.find((bot) => bot.role === "reply") ?? null;
  return {
    id: business.id,
    name: business.name,
    model: business.model,
    modelLabel: MODEL_PRESETS.find((preset) => preset.id === business.model)?.label ?? business.model,
    locale: business.locale,
    createdAt: business.createdAt,
    telegram: telegram === null ? null : { username: telegram.username, enabled: telegram.enabled },
    web: channel === null ? null : { enabled: channel.enabled, title: channel.title },
    usage,
    customers: customers.length,
  };
}

/**
 * What this build's data API can do, as one number.
 *
 * The console is served from somewhere else and updates on its own, so it is
 * routinely newer than the deployment it is pointed at. Without this it finds
 * out by asking for a path that is not there, and the operator gets a 404 and a
 * blank page for a feature that simply has not arrived yet.
 *
 * Bumped whenever routes are added. A deployment that predates this field
 * reports nothing, which the console reads as revision 1, and every page that
 * needs more than that says so instead of failing.
 *
 *   1  the first data API: overview, businesses, conversations, messages,
 *      system, secrets, update
 *   2  inbox, diagnostics, locale, skills, console bot, prompt, documents,
 *      the web channel, one customer, rescan
 *   3  the business profile
 *   4  agent configuration: rules and features
 *   5  telling the deployment its own source repository
 *   6  notes, and the knowledge view over every source
 *   7  the owner's assistant, and the changes it asks permission for
 *   8  more than one conversation with it, each with its own model
 *   9  the working behind each answer, and the model changed on its own
 *  10  what each answer cost, where the day's neurons stand, and the name on
 *      the Cloudflare account this runs in
 *  11  the answer streamed as it is worked out, and the Cloudflare token
 *      collected in the console instead of at deploy time
 *  12  the assistant asks the owner questions and creates a business itself
 *  13  changes read per conversation, and whether the owner's repository is
 *      public
 *  14  the two outside capabilities and the owner's own keys for them: live
 *      web data through SerpApi, and a document read as data through Nutrient
 *      DWS
 */
export const API_REVISION = 14;

/** Telegram's own ceiling for a bot upload. */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;


/**
 * Which send method a browser file wants.
 *
 * Read from the type the browser reports and nothing else. Guessing from the
 * extension would put a renamed .jpg through sendDocument and a renamed .pdf
 * through sendPhoto, and Telegram would reject the second one at the moment
 * the operator is trying to answer someone.
 */
/** A caption is base64 in a header because a header cannot hold a newline. */
function decodeCaption(raw: string | null): string {
  if (raw === null || raw.length === 0) return "";
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(raw), (c) => c.charCodeAt(0))).slice(0, 1024);
  } catch {
    return "";
  }
}

function kindForType(mime: string): MediaKind {
  if (mime.startsWith("image/") && mime !== "image/webp") return "photo";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

/**
 * Connects a Telegram bot token to a business.
 *
 * The Telegram console does the same thing in its own flow, with its own
 * messages around it; the part that must not diverge is this one, because a
 * bot row written without its webhook is a business that silently answers
 * nobody. Refusing the console's own token is what keeps the two roles apart:
 * connecting it as a customer bot would hand the control panel to whoever
 * finds it.
 */
async function attachTelegramBot(
  env: Env,
  input: { businessId: string; token: string },
): Promise<{ ok: true; username: string; displayName: string } | { ok: false; reason: string }> {
  const incoming = new TelegramClient(input.token);
  let me: { username?: string; first_name?: string };
  try {
    me = await incoming.getMe();
  } catch {
    return { ok: false, reason: "bot_rejected" };
  }
  const username = me.username ?? "unknown";

  const consoleBot = await getConsoleBot(env);
  if (consoleBot !== null && consoleBot.username === username) {
    return { ok: false, reason: "same_as_console" };
  }

  const webhookPath = generateId(24);
  const webhookSecret = generateShortId() + generateShortId();
  await createBot(env, {
    businessId: input.businessId,
    role: "reply",
    username,
    webhookPath,
    tokenCiphertext: await seal(await resolveMasterKey(env), input.token),
    webhookSecretHash: await sha256Hex(webhookSecret),
  });
  const origin = (await env.STATE.get(ORIGIN_KEY)) ?? "";
  if (origin.length === 0) return { ok: false, reason: "no_origin" };
  await incoming.setWebhook({ url: `${origin}/tg/${webhookPath}`, secretToken: webhookSecret });
  return { ok: true, username, displayName: (me.first_name ?? username).trim() };
}

/**
 * The businesses this operator may see, resolved once.
 *
 * Every aggregate takes this list. Passing the operator id down instead would
 * let a panel added later forget to scope itself, and the failure would be one
 * tenant's numbers appearing in another's dashboard.
 */
async function visibleIds(env: Env, userId: number): Promise<string[]> {
  return (await listBusinesses(env, userId)).map((business) => business.id);
}

/**
 * Points the control panel at a different Telegram bot.
 *
 * The old one is detached first, so the two never answer the same operator, and
 * the new one is told where to listen. Same shape as attaching a business bot,
 * and deliberately a separate function: putting the console's own credential
 * through the path that adds a customer facing bot is how the control panel
 * ends up answering customers.
 */
async function moveConsoleBot(
  env: Env,
  token: string,
): Promise<{ ok: true; username: string } | { ok: false; reason: string }> {
  const incoming = new TelegramClient(token);
  let me: { username?: string };
  try {
    me = await incoming.getMe();
  } catch {
    return { ok: false, reason: "bot_rejected" };
  }
  const origin = (await env.STATE.get(ORIGIN_KEY)) ?? "";
  if (origin.length === 0) return { ok: false, reason: "no_origin" };

  const webhookPath = generateId(24);
  const webhookSecret = generateShortId() + generateShortId();
  await putConsoleBot(env, {
    username: me.username ?? "unknown",
    webhookPath,
    tokenCiphertext: await seal(await resolveMasterKey(env), token),
    webhookSecretHash: await sha256Hex(webhookSecret),
  });
  await incoming.setWebhook({ url: `${origin}/tg/${webhookPath}`, secretToken: webhookSecret });
  return { ok: true, username: me.username ?? "unknown" };
}

/** Only the fields a profile has, whatever else the body carried. */
function profilePatch(body: Record<string, unknown>): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const field of [
    "kind",
    "about",
    "address",
    "mapUrl",
    "phone",
    "email",
    "website",
    "facebook",
    "hours",
  ]) {
    if (typeof body[field] === "string") patch[field] = body[field] as string;
  }
  return patch;
}

function notFound(): Response {
  return json({ error: "not_found" }, 404);
}

/**
 * Routes /admin/api/*. Every path is checked against the operator's own access
 * list, so a business id guessed from somewhere else still reaches nothing.
 */
export async function handleConsoleApi(
  env: Env,
  request: Request,
  path: string,
): Promise<Response | null> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const userId = await operatorFor(env, request);
  if (userId === null) return json({ error: "unauthorised" }, 401);

  const segments = path.split("/").filter((part) => part.length > 0);
  const method = request.method;

  // GET /overview — everything the dashboard draws, counted now.
  if (method === "GET" && segments[0] === "overview") {
    const businesses = await listBusinesses(env, userId);
    const ids = businesses.map((business) => business.id);
    const [cards, series, split, conversations, unaided, events] = await Promise.all([
      Promise.all(businesses.map((business) => businessCard(env, business.id))),
      usageSeries(env, ids, 7),
      channelSplit(env, ids),
      recentConversations(env, ids, 6),
      unaidedShare(env, ids),
      listEvents(env, 6),
    ]);

    // Yesterday against today, from the same series the chart draws, so the
    // arrow on a card and the last step of the line can never disagree.
    const today = series[series.length - 1];
    const yesterday = series[series.length - 2];
    const liveChannels =
      cards.filter((card) => card.telegram?.enabled === true).length +
      cards.filter((card) => card.web?.enabled === true).length;

    return json({
      businesses: cards,
      totals: {
        businesses: cards.length,
        agents: cards.length,
        liveChannels,
        messagesToday: today?.messages ?? 0,
        messagesYesterday: yesterday?.messages ?? 0,
        customers: cards.reduce((n, card) => n + card.customers, 0),
        tokensToday: (today?.inputTokens ?? 0) + (today?.outputTokens ?? 0),
      },
      series,
      channels: split,
      conversations,
      topAgents: cards
        .map((card) => {
          const share = unaided.get(card.id) ?? { conversations: 0, handed: 0 };
          return {
            id: card.id,
            name: card.name,
            messages: card.usage.messages,
            conversations: share.conversations,
            // Undefined rather than 0 when nothing has happened yet. A brand new
            // agent showing "0% answered alone" reads as a broken one.
            unaided:
              share.conversations === 0
                ? null
                : Math.round(((share.conversations - share.handed) / share.conversations) * 100),
          };
        })
        .sort((a, b) => b.messages - a.messages)
        .slice(0, 5),
      events,
    });
  }

  // GET /inbox — the conversations a person has been asked to look at.
  //
  // The queue is deployment wide in the database, so it is filtered to what
  // this operator can see rather than shown whole. An admin added to one
  // business seeing another's customers in their inbox would be a leak with a
  // friendly face.
  if (method === "GET" && segments[0] === "inbox") {
    const visible = new Set(await visibleIds(env, userId));
    const waiting = (await listHandovers(env, 60)).filter((h) => visible.has(h.businessId));
    return json({ waiting });
  }

  // GET /diagnostics — what this deployment can and cannot do right now.
  if (method === "GET" && segments[0] === "diagnostics") {
    const businesses = await listBusinesses(env, userId);
    const [schema, events, bots] = await Promise.all([
      currentVersion(env),
      listEvents(env, 12),
      Promise.all(
        businesses.map(async (business) => ({
          business: business.name,
          bots: (await listBots(env, business.id)).map((bot) => ({
            username: bot.username,
            role: bot.role,
            enabled: bot.enabled,
          })),
        })),
      ),
    ]);
    return json({
      missing: missingConfiguration(env),
      schema: { at: schema, target: TARGET_VERSION, current: schema >= TARGET_VERSION },
      origin: (await env.STATE.get(ORIGIN_KEY)) ?? "",
      consoleBot: (await getConsoleBot(env))?.username ?? null,
      bots,
      // Only the failures, because a diagnostics page listing successes is a
      // log with a different name.
      failures: events.filter((event: { kind: string }) => event.kind.includes("fail") || event.kind.includes("error")),
    });
  }

  // GET/PUT /locale — the language this operator reads the console in.
  if (segments[0] === "locale") {
    if (method === "GET") {
      return json({
        locale: await getOperatorLocale(env, userId),
        available: LOCALES.map((code) => ({ code, label: LOCALE_NAMES[code] })),
      });
    }
    if (method === "PUT") {
      const body = (await request.json().catch(() => ({}))) as { locale?: string };
      if (!isLocale(String(body.locale))) return json({ error: "unknown_locale" }, 400);
      await setOperatorLocale(env, userId, String(body.locale) as never);
      return json({ ok: true, locale: body.locale });
    }
  }

  // GET /skills — the ready made instruction sets, in every language they have.
  if (method === "GET" && segments[0] === "skills") {
    return json({
      skills: SKILLS.map((skill) => ({
        id: skill.id,
        label: skill.label,
        summary: skill.summary,
        body: skill.body,
      })),
    });
  }

  // POST /console-bot — hand the control panel to a different bot.
  if (method === "POST" && segments[0] === "console-bot") {
    const body = (await request.json().catch(() => ({}))) as { token?: string };
    const token = String(body.token ?? "").trim();
    if (token.length === 0) return json({ error: "bad_token" }, 400);
    const moved = await moveConsoleBot(env, token);
    return moved.ok ? json(moved) : json({ error: moved.reason }, 400);
  }

  // The owner's own assistant, and the conversations they keep with it.
  if (segments[0] === "assistant") {
    /**
     * Each answer's tokens, plus its share of the day's neurons and the name
     * of the model that actually produced it.
     *
     * The model is read off the answer's own row, not off the chat: an owner
     * who switches the picker mid conversation would otherwise see yesterday's
     * replies relabelled with today's model.
     */
    /**
     * The same turn, reported as it happens.
     *
     * The body is opened before the loop starts and written to as the loop
     * works, so the owner sees the tool it is running rather than a still
     * screen for the several seconds it takes. The last event carries exactly
     * the payload the non streaming path returns, so the console has one shape
     * to draw from either way.
     */
    const streamed = (
      env: Env,
      userId: number,
      chat: { id: string; model: string },
      question: string,
    ): Response => {
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();
      const send = (event: unknown): void => {
        writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)).catch(() => undefined);
      };

      // Deliberately not awaited: the response has to be returned now for the
      // browser to start reading it.
      void (async () => {
        try {
          const reply = await ask(env, {
            userId,
            chatId: chat.id,
            question,
            model: chat.model,
            onEvent: send,
          });
          const allowance = await allowanceNow(env);
          send({
            type: "done",
            ...reply,
            chats: await listChats(env, userId, 40),
            chat,
            messages: await chatTranscript(env, chat.id, 60),
            steps: await stepsFor(env, chat.id),
            prompts: await promptsFor(env, chat.id),
            usage: priced(await usageFor(env, chat.id), allowance),
            allowance: {
              neuronsToday: allowance.neuronsToday,
              perDay: allowance.perDay,
              problem: allowance.problem,
            },
            approvals: await listChatApprovals(env, userId, chat.id),
          });
        } catch (error) {
          // Sent down the same channel. A stream that just stops leaves the
          // console waiting for an answer that is never coming.
          send({
            type: "failed",
            message: error instanceof Error ? error.message : "that did not finish",
          });
        } finally {
          await writer.close().catch(() => undefined);
        }
      })();

      return new Response(readable, {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          "access-control-allow-origin": "*",
        },
      });
    };

    const priced = (
      spent: Record<string, { model: string; inputTokens: number; outputTokens: number }>,
      allowance: Allowance,
    ): Record<string, unknown> =>
      Object.fromEntries(
        Object.entries(spent).map(([messageId, usage]) => [
          messageId,
          {
            model: usage.model,
            label: MODEL_PRESETS.find((preset) => preset.id === usage.model)?.label ?? usage.model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            neurons: neuronsFor(allowance, usage),
          },
        ]),
      );

    /** The model a new chat starts on: the one this owner's customers get. */
    const defaultModel = async (): Promise<string> =>
      (await listBusinesses(env, userId))[0]?.model ?? env.DEFAULT_MODEL;

    if (method === "GET" && segments.length === 1) {
      const url = new URL(request.url);
      const chats = await listChats(env, userId, 40);
      const wanted = url.searchParams.get("chat");
      const chat =
        wanted === null ? (chats[0] ?? null) : await getChat(env, userId, wanted);
      const [messages, approvals, steps, spent, allowance] = await Promise.all([
        chat === null ? Promise.resolve([]) : chatTranscript(env, chat.id, 60),
        chat === null ? Promise.resolve([]) : listChatApprovals(env, userId, chat.id),
        chat === null ? Promise.resolve({}) : stepsFor(env, chat.id),
        chat === null ? Promise.resolve({}) : usageFor(env, chat.id),
        allowanceNow(env),
      ]);
      const prompts = chat === null ? {} : await promptsFor(env, chat.id);
      return json({
        chats,
        chat,
        messages,
        // What it looked at, against the answer it produced. Read back from the
        // record, so a reopened chat shows the same working the live one did.
        steps,
        // What any turn is still waiting on the owner for.
        prompts,
        // What each answer cost, and where the day's allowance stands.
        usage: priced(spent, allowance),
        allowance: { neuronsToday: allowance.neuronsToday, perDay: allowance.perDay, problem: allowance.problem },
        approvals,
        models: MODEL_PRESETS,
        defaultModel: await defaultModel(),
      });
    }

    if (method === "POST" && segments.length === 1) {
      const body = (await request.json().catch(() => ({}))) as {
        text?: string;
        chatId?: string;
        model?: string;
      };
      const text = String(body.text ?? "").trim();
      if (text.length === 0) return json({ error: "empty" }, 400);

      // A message with no chat starts one, titled with what was just typed.
      // Asking for a title first would be a question nobody wants to answer.
      let chat =
        typeof body.chatId === "string" && body.chatId.length > 0
          ? await getChat(env, userId, body.chatId)
          : null;
      if (chat === null) {
        chat = await createChat(
          env,
          userId,
          titleFrom(text),
          typeof body.model === "string" && MODEL_PRESETS.some((p) => p.id === body.model)
            ? body.model
            : await defaultModel(),
        );
      } else if (typeof body.model === "string" && MODEL_PRESETS.some((p) => p.id === body.model)) {
        await setChatModel(env, userId, chat.id, body.model);
        chat = { ...chat, model: body.model };
      }

      // A watching browser asks for the events; anything else gets the whole
      // answer in one piece, which is what the API did before and what a script
      // calling it still wants.
      if ((request.headers.get("accept") ?? "").includes("text/event-stream")) {
        return streamed(env, userId, chat, text.slice(0, 4000));
      }

      const reply = await ask(env, {
        userId,
        chatId: chat.id,
        question: text.slice(0, 4000),
        model: chat.model,
      });
      const allowance = await allowanceNow(env);
      return json({
        ...reply,
        chats: await listChats(env, userId, 40),
        chat,
        messages: await chatTranscript(env, chat.id, 60),
        steps: await stepsFor(env, chat.id),
        prompts: await promptsFor(env, chat.id),
        usage: priced(await usageFor(env, chat.id), allowance),
        allowance: { neuronsToday: allowance.neuronsToday, perDay: allowance.perDay, problem: allowance.problem },
        approvals: await listChatApprovals(env, userId, chat.id),
      });
    }

    // PATCH /assistant/chats/:id  { model }
    if (method === "PATCH" && segments[1] === "chats" && segments[2] !== undefined) {
      const body = (await request.json().catch(() => ({}))) as { model?: string };
      if (typeof body.model !== "string" || !MODEL_PRESETS.some((p) => p.id === body.model)) {
        return json({ error: "unknown_model" }, 400);
      }
      const chat = await getChat(env, userId, segments[2]);
      if (chat === null) return json({ error: "not_found" }, 404);
      await setChatModel(env, userId, chat.id, body.model);
      return json({ ok: true, chat: { ...chat, model: body.model } });
    }

    if (method === "DELETE" && segments[1] === "chats" && segments[2] !== undefined) {
      await deleteChat(env, userId, segments[2]);
      const chats = await listChats(env, userId, 40);
      const chat = chats[0] ?? null;
      const allowance = await allowanceNow(env);
      return json({
        ok: true,
        chats,
        chat,
        messages: chat === null ? [] : await chatTranscript(env, chat.id, 60),
        steps: chat === null ? {} : await stepsFor(env, chat.id),
        prompts: chat === null ? {} : await promptsFor(env, chat.id),
        usage: chat === null ? {} : priced(await usageFor(env, chat.id), allowance),
        allowance: { neuronsToday: allowance.neuronsToday, perDay: allowance.perDay, problem: allowance.problem },
        approvals: chat === null ? [] : await listChatApprovals(env, userId, chat.id),
      });
    }

    // POST /assistant/approvals/:id  { yes: boolean }
    if (method === "POST" && segments[1] === "approvals" && segments[2] !== undefined) {
      const body = (await request.json().catch(() => ({}))) as { yes?: boolean };
      // Which conversation it belongs to is looked up rather than taken from
      // the caller: the answer carries that chat's changes back, and a chat id
      // supplied by the browser would be a way to read another one's.
      const chatId = await chatOfApproval(env, userId, segments[2]);
      const outcome = await decide(env, userId, segments[2], body.yes === true);
      return json({
        ...outcome,
        approvals: chatId === null ? [] : await listChatApprovals(env, userId, chatId),
      });
    }
  }

  // GET /agents — the same businesses, with what the table column needs.
  if (method === "GET" && segments[0] === "agents") {
    const businesses = await listBusinesses(env, userId);
    const ids = businesses.map((business) => business.id);
    const [cards, unaided, activity] = await Promise.all([
      Promise.all(businesses.map((business) => businessCard(env, business.id))),
      unaidedShare(env, ids),
      lastActivity(env, ids),
    ]);
    return json({
      agents: cards.map((card) => {
        const share = unaided.get(card.id) ?? { conversations: 0, handed: 0 };
        return {
          ...card,
          live: card.telegram?.enabled === true || card.web?.enabled === true,
          conversations: share.conversations,
          unaided:
            share.conversations === 0
              ? null
              : Math.round(((share.conversations - share.handed) / share.conversations) * 100),
          lastActivity: activity.get(card.id) ?? null,
        };
      }),
    });
  }

  // GET /channels — every way a customer can reach this deployment.
  if (method === "GET" && segments[0] === "channels") {
    const businesses = await listBusinesses(env, userId);
    const rows = await Promise.all(
      businesses.map(async (business) => {
        const [bots, channel, activity] = await Promise.all([
          listBots(env, business.id),
          getChannelForBusiness(env, business.id),
          lastActivity(env, [business.id]),
        ]);
        const at = activity.get(business.id) ?? null;
        const telegram = bots.find((bot) => bot.role === "reply") ?? null;
        return [
          ...(telegram === null
            ? []
            : [
                {
                  kind: "telegram" as const,
                  label: `@${telegram.username}`,
                  businessId: business.id,
                  businessName: business.name,
                  connected: telegram.enabled,
                  lastActivity: at,
                },
              ]),
          ...(channel === null
            ? []
            : [
                {
                  kind: "web" as const,
                  label: channel.title || business.name,
                  businessId: business.id,
                  businessName: business.name,
                  connected: channel.enabled,
                  lastActivity: at,
                },
              ]),
        ];
      }),
    );
    return json({ channels: rows.flat() });
  }

  // GET /customers?page=&size= — the list. The length guard matters: without it
  // this swallows /customers/:id and hands back a page of everybody.
  if (method === "GET" && segments[0] === "customers" && segments.length === 1) {
    const url = new URL(request.url);
    const size = Math.min(50, Math.max(5, Number(url.searchParams.get("size") ?? 20) || 20));
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
    const ids = await visibleIds(env, userId);
    const { customers, total } = await customersPage(env, ids, size, (page - 1) * size);
    return json({ customers, total, page, size, pages: Math.max(1, Math.ceil(total / size)) });
  }

  // GET /conversations — the Messages screen's own list.
  if (method === "GET" && segments[0] === "conversations" && segments.length === 1) {
    const url = new URL(request.url);
    const limit = Math.min(60, Math.max(5, Number(url.searchParams.get("limit") ?? 40) || 40));
    const ids = await visibleIds(env, userId);
    return json({ conversations: await recentConversations(env, ids, limit) });
  }

  // GET /events — the log, which is the event table and nothing invented.
  if (method === "GET" && segments[0] === "events") {
    const url = new URL(request.url);
    const limit = Math.min(200, Math.max(10, Number(url.searchParams.get("limit") ?? 60) || 60));
    return json({ events: await listEvents(env, limit) });
  }

  // GET /search?q=
  if (method === "GET" && segments[0] === "search") {
    const term = new URL(request.url).searchParams.get("q") ?? "";
    const ids = await visibleIds(env, userId);
    return json(await searchRecords(env, ids, term));
  }

  // GET /me — who this token belongs to, by label and role only.
  //
  // Never the Telegram id. The console has no use for it and printing an
  // internal identifier at a customer facing surface is how they end up in
  // screenshots and support threads.
  if (method === "GET" && segments[0] === "me") {
    const [operator, row, account] = await Promise.all([
      findOperator(env, userId),
      env.DB.prepare("SELECT label FROM operator WHERE telegram_user_id = ?")
        .bind(userId)
        .first<{ label: string | null }>(),
      accountName(env),
    ]);
    // Whoever this deployment belongs to, named by the account it runs in.
    //
    // The account's real name first, when a read token has been added. Failing
    // that, the workers.dev subdomain, which is in the address this request
    // arrived at and so costs nothing and needs no permission. The label from
    // the operator row is below both because nothing sets it today. "Owner" is
    // a role, not a person, and it is the last resort rather than the first
    // answer it used to be.
    const subdomain = workersSubdomain(request.url);
    return json({
      label:
        account ||
        subdomain ||
        row?.label?.trim() ||
        (operator?.role === "owner" ? "Owner" : "Operator"),
      account,
      subdomain,
      role: operator?.role ?? "operator",
    });
  }

  // GET /models
  if (method === "GET" && segments[0] === "models") {
    return json({ models: MODEL_PRESETS });
  }

  // /businesses
  if (segments[0] === "businesses") {
    if (method === "GET" && segments.length === 1) {
      const businesses = await listBusinesses(env, userId);
      return json({ businesses: await Promise.all(businesses.map((b) => businessCard(env, b.id))) });
    }
    if (method === "POST" && segments.length === 1) {
      const body = (await request.json().catch(() => ({}))) as {
        name?: string;
        profile?: Record<string, string>;
      };
      const name = String(body.name ?? "").trim();
      if (name.length === 0 || name.length > 80) {
        return json({ error: "bad_name", message: "Give the business a name of 1 to 80 characters." }, 400);
      }
      const business = await createBusiness(env, {
        name,
        locale: env.BUSINESS_LOCALE?.trim() || "en",
        model: env.DEFAULT_MODEL,
      });
      // The address and the phone number arrive with the name, because that is
      // when the owner has them in mind. Saved through the same door that edits
      // them later, so there is one place that validates and trims them.
      if (body.profile !== undefined) {
        await saveProfile(env, business.id, profilePatch(body.profile));
      }
      // Same as the Telegram path: a business always gets a web channel, and it
      // is on from the start, so a business that has just been made can already
      // answer on a page. Telegram is the part that has to be added.
      await createChannel(env, { businessId: business.id, title: name });
      return json(await businessCard(env, business.id), 201);
    }

    const businessId = segments[1];
    if (businessId === undefined) return notFound();
    if (!(await canAccessBusiness(env, userId, businessId))) return json({ error: "no_access" }, 403);

    if (method === "GET" && segments.length === 2) {
      const [card, products, documents, recentCustomers, profile] = await Promise.all([
        businessCard(env, businessId),
        productsView(env, businessId),
        listDocuments(env, businessId),
        listCustomers(env, businessId, 50),
        getProfile(env, businessId),
      ]);
      // Deliberately not `customers`. The card already carries that name for
      // the count, and spreading a list over it left the console drawing
      // "[object Object]" where a number belonged. One name, one meaning.
      return json({ ...card, products, documents, recentCustomers, profile });
    }
    if (method === "DELETE" && segments.length === 2) {
      await deleteBusiness(env, businessId);
      return json({ ok: true });
    }
    if (method === "PATCH" && segments.length === 2) {
      const body = (await request.json().catch(() => ({}))) as {
        model?: string;
        webEnabled?: boolean;
        webTitle?: string;
      };
      if (typeof body.model === "string" && MODEL_PRESETS.some((p) => p.id === body.model)) {
        await updateBusinessModel(env, businessId, body.model);
      }
      if (body.webEnabled !== undefined || body.webTitle !== undefined) {
        const channel = await getChannelForBusiness(env, businessId);
        if (channel !== null) {
          await updateChannel(env, channel.id, {
            ...(body.webEnabled === undefined ? {} : { enabled: body.webEnabled }),
            ...(body.webTitle === undefined ? {} : { title: body.webTitle }),
          });
        }
      }
      return json(await businessCard(env, businessId));
    }
    if (method === "GET" && segments[2] === "customers") {
      return json({ customers: await listCustomers(env, businessId, 100) });
    }

    // The price list the assistant actually quotes from.
    //
    // Not the `product` table: that is read by nothing. The list is what has
    // been extracted from the uploaded documents, with the owner's corrections
    // laid over the top, and a correction reaches the assistant by being
    // written into the owner-updates document and re-indexed. So every write
    // here goes through the same one function the Telegram console uses, and
    // an item typed in either place is an item the assistant can quote.
    if (segments[2] === "products") {
      if (method === "GET" && segments.length === 3) {
        return json({ products: await productsView(env, businessId) });
      }
      if (method === "POST" && segments.length === 3) {
        const body = (await request.json().catch(() => ({}))) as {
          name?: string;
          price?: string;
          description?: string;
        };
        const name = String(body.name ?? "").trim();
        if (name.length === 0) return json({ error: "bad_name" }, 400);
        // An item typed here is a correction with nothing underneath it, which
        // is also how the same item typed into the bot is stored.
        await saveProductEntry(env, {
          businessId,
          name,
          price: String(body.price ?? ""),
          description: String(body.description ?? ""),
          removed: false,
        });
        return json({ products: await productsView(env, businessId) }, 201);
      }
      // Addressed by name, because that is the key a correction has. An item
      // pulled out of a document has no id of its own to be addressed by.
      const key = segments[3];
      if (key !== undefined && (method === "PATCH" || method === "DELETE")) {
        const entry = (await productsView(env, businessId)).find((item) => item.key === key);
        if (entry === undefined) return notFound();
        if (method === "DELETE") {
          // A removal is a correction too, because the item may come from a
          // document this cannot edit. Deleting the row would let the next
          // extraction bring it straight back.
          await saveProductEntry(env, {
            businessId,
            name: entry.name,
            price: "",
            description: "",
            removed: true,
          });
        } else {
          const body = (await request.json().catch(() => ({}))) as {
            name?: string;
            price?: string;
            description?: string;
          };
          await saveProductEntry(env, {
            businessId,
            name: String(body.name ?? entry.name),
            price: String(body.price ?? entry.price),
            description: String(body.description ?? entry.description),
            removed: false,
          });
        }
        return json({ products: await productsView(env, businessId) });
      }
    }

    // Read the uploaded documents again and pull the price list out of them.
    if (method === "POST" && segments[2] === "rescan" && segments.length === 3) {
      const documents = await listDocuments(env, businessId, 100);
      let queued = 0;
      for (const document of documents) {
        if (document.filename === OWNER_UPDATES_FILENAME) continue;
        await markExtractionPending(env, { businessId, documentId: document.id });
        queued += 1;
      }
      // One is read now so the button visibly did something; the scheduled run
      // works through whatever is left.
      const [next] = await pendingExtractions(env, 1);
      if (next !== undefined) {
        const business = await getBusiness(env, businessId);
        await runExtraction(env, { businessId, documentId: next.documentId, model: business.model }).catch(
          () => undefined,
        );
      }
      return json({ ok: true, queued, products: await productsView(env, businessId) });
    }

    // GET /businesses/:id/agent — everything the configuration screen shows.
    //
    // One call, because these are read together and separately they would drift
    // out of step on a page that lets you change all of them.
    if (method === "GET" && segments[2] === "agent" && segments.length === 3) {
      const [card, business, setting, rules, channel, bots] = await Promise.all([
        businessCard(env, businessId),
        getBusiness(env, businessId),
        getAgentSetting(env, businessId),
        listRules(env, businessId),
        getChannelForBusiness(env, businessId),
        listBots(env, businessId),
      ]);
      const telegram = bots.find((bot) => bot.role === "reply") ?? null;
      return json({
        id: card.id,
        name: card.name,
        model: card.model,
        modelLabel: card.modelLabel,
        models: MODEL_PRESETS,
        persona: business.systemPrompt,
        rules,
        ruleKinds: RULE_KINDS,
        skills: SKILLS.map((skill) => ({ id: skill.id, label: skill.label, summary: skill.summary })),
        features: {
          telegram:
            telegram === null ? null : { username: telegram.username, enabled: telegram.enabled },
          web: channel === null ? null : { enabled: channel.enabled, dailyLimit: channel.dailyLimit },
          rememberCustomers: setting.rememberCustomers,
        },
        usage: card.usage,
      });
    }

    // PATCH /businesses/:id/features — the switches, each of which the runtime
    // already reads. Nothing here is a label on something that does not happen.
    if (method === "PATCH" && segments[2] === "features" && segments.length === 3) {
      const body = (await request.json().catch(() => ({}))) as {
        telegram?: boolean;
        web?: boolean;
        dailyLimit?: number;
        rememberCustomers?: boolean;
      };
      if (typeof body.telegram === "boolean") {
        await setBotEnabled(env, businessId, body.telegram);
      }
      if (typeof body.web === "boolean" || typeof body.dailyLimit === "number") {
        const channel = await getChannelForBusiness(env, businessId);
        if (channel !== null) {
          await updateChannel(env, channel.id, {
            ...(typeof body.web === "boolean" ? { enabled: body.web } : {}),
            ...(typeof body.dailyLimit === "number" ? { dailyLimit: body.dailyLimit } : {}),
          });
        }
      }
      if (typeof body.rememberCustomers === "boolean") {
        await saveAgentSetting(env, businessId, { rememberCustomers: body.rememberCustomers });
      }
      return json({ ok: true });
    }

    // Standing instructions, one to a row.
    if (segments[2] === "rules") {
      if (method === "GET" && segments.length === 3) {
        return json({ rules: await listRules(env, businessId) });
      }
      if (method === "POST" && segments.length === 3) {
        const body = (await request.json().catch(() => ({}))) as {
          id?: string;
          kind?: string;
          content?: string;
          active?: boolean;
          priority?: number;
        };
        const kind = RULE_KINDS.includes(body.kind as never) ? (body.kind as never) : "other";
        const content = String(body.content ?? "").trim();
        if (content.length === 0) return json({ error: "empty" }, 400);
        return json({
          rules: await saveRule(env, businessId, {
            id: body.id,
            kind,
            content,
            active: body.active,
            priority: body.priority,
          }),
        });
      }
      const ruleId = segments[3];
      if (method === "DELETE" && ruleId !== undefined) {
        return json({ rules: await deleteRule(env, businessId, ruleId) });
      }
    }

    // What the business is and where to find it.
    if (segments[2] === "profile" && segments.length === 3) {
      if (method === "GET") return json({ profile: await getProfile(env, businessId) });
      if (method === "PUT") {
        const body = (await request.json().catch(() => ({}))) as Record<string, string>;
        return json({ profile: await saveProfile(env, businessId, profilePatch(body)) });
      }
    }

    // The instructions the assistant answers by.
    if (segments[2] === "prompt") {
      if (method === "GET" && segments.length === 3) {
        const [business, previous] = await Promise.all([
          getBusiness(env, businessId),
          previousPrompt(env, businessId),
        ]);
        return json({ prompt: business.systemPrompt, previous });
      }
      if (method === "PUT" && segments.length === 3) {
        const body = (await request.json().catch(() => ({}))) as { prompt?: string };
        await setBusinessPrompt(env, businessId, String(body.prompt ?? "").slice(0, MAX_PROMPT_CHARS));
        return json({ ok: true, prompt: (await getBusiness(env, businessId)).systemPrompt });
      }
      // Undo is a write of the previous version, not a delete of this one, so
      // the thing being undone is itself undoable.
      if (method === "POST" && segments[3] === "undo") {
        const previous = await previousPrompt(env, businessId);
        if (previous === null) return json({ error: "nothing_to_undo" }, 400);
        await setBusinessPrompt(env, businessId, previous);
        return json({ ok: true, prompt: previous });
      }
    }

    // A ready made instruction set, written in as ordinary instructions so the
    // operator can edit it afterwards like anything they typed themselves.
    if (method === "POST" && segments[2] === "skill" && segments.length === 3) {
      const body = (await request.json().catch(() => ({}))) as { id?: string };
      const skill = SKILLS.find((candidate) => candidate.id === body.id);
      if (skill === undefined) return json({ error: "unknown_skill" }, 400);
      await setBusinessPrompt(env, businessId, skill.body);
      return json({ ok: true, prompt: skill.body });
    }

    // GET /businesses/:id/knowledge — everything the assistant can draw on,
    // in one list, whatever shape it was given in.
    //
    // The point of the page is that an owner can see the whole of it. Split
    // across four screens, the question "why did it say that" has four places
    // to look and no answer in any of them.
    if (method === "GET" && segments[2] === "knowledge" && segments.length === 3) {
      const [documents, products, notes, profile, rules] = await Promise.all([
        listDocuments(env, businessId, 100),
        productsView(env, businessId),
        listNotes(env, businessId),
        getProfile(env, businessId),
        listRules(env, businessId),
      ]);
      const uploaded = documents.filter(
        (document) => !GENERATED_DOCUMENTS.includes(document.filename as never),
      );
      const generated = documents.filter((document) =>
        GENERATED_DOCUMENTS.includes(document.filename as never),
      );
      const profileFilled = Object.values(profile).filter((value) => value.trim().length > 0).length;
      return json({
        // Searched: found by looking, when a question resembles what is in them.
        searched: [
          ...uploaded.map((document) => ({
            kind: "document",
            id: document.id,
            name: document.filename,
            detail: document.contentType,
            pieces: document.chunkCount,
            status: document.status,
            error: document.error,
            updatedAt: document.updatedAt,
          })),
          {
            kind: "products",
            id: "products",
            name: "Price list",
            detail: `${products.length} item${products.length === 1 ? "" : "s"}`,
            pieces:
              generated.find((d) => d.filename === OWNER_UPDATES_FILENAME)?.chunkCount ?? 0,
            status: products.length === 0 ? "empty" : "ready",
            error: null,
            updatedAt:
              generated.find((d) => d.filename === OWNER_UPDATES_FILENAME)?.updatedAt ?? null,
          },
          {
            kind: "notes",
            id: "notes",
            name: "Notes",
            detail: `${notes.length} note${notes.length === 1 ? "" : "s"}`,
            pieces: generated.find((d) => d.filename === NOTES_FILENAME)?.chunkCount ?? 0,
            status: notes.length === 0 ? "empty" : "ready",
            error: null,
            updatedAt: generated.find((d) => d.filename === NOTES_FILENAME)?.updatedAt ?? null,
          },
        ],
        // Always sent: small enough to go with every question, so they are
        // never missed by a search that did not match.
        alwaysSent: [
          {
            kind: "profile",
            id: "profile",
            name: "About the business",
            detail: `${profileFilled} of 9 fields filled in`,
            status: profileFilled === 0 ? "empty" : "ready",
          },
          {
            kind: "rules",
            id: "rules",
            name: "Standing instructions",
            detail: `${rules.filter((rule) => rule.active).length} of ${rules.length} switched on`,
            status: rules.length === 0 ? "empty" : "ready",
          },
        ],
      });
    }

    // Facts the owner types rather than uploads.
    if (segments[2] === "notes") {
      if (method === "GET" && segments.length === 3) {
        return json({ notes: await listNotes(env, businessId) });
      }
      if (method === "POST" && segments.length === 3) {
        const body = (await request.json().catch(() => ({}))) as {
          id?: string;
          title?: string;
          body?: string;
        };
        const text = String(body.body ?? "").trim();
        if (text.length === 0) return json({ error: "empty" }, 400);
        const notes = await saveNote(env, businessId, {
          id: body.id,
          title: String(body.title ?? ""),
          body: text,
        });
        // Indexed in the same call. A note the owner just wrote and the agent
        // cannot find yet is the shape of a feature that looks broken.
        await syncNotes(env, businessId);
        return json({ notes });
      }
      const noteId = segments[3];
      if (method === "DELETE" && noteId !== undefined) {
        const notes = await deleteNote(env, businessId, noteId);
        await syncNotes(env, businessId);
        return json({ notes });
      }
    }

    // What the assistant reads before it answers.
    if (segments[2] === "documents") {
      if (method === "GET" && segments.length === 3) {
        return json({ documents: await listDocuments(env, businessId, 50) });
      }
      if (method === "POST" && segments.length === 3) {
        const file = await request.arrayBuffer();
        if (file.byteLength === 0) return json({ error: "no_file" }, 400);
        const filename = (request.headers.get("x-filename") ?? "document").slice(0, 120);
        try {
          const result = await addDocument(env, {
            businessId,
            filename,
            contentType: request.headers.get("content-type") ?? "application/octet-stream",
            body: file,
          });
          // `searchable` is the honest part: the index accepts a write and can
          // answer from it a little later, so a document is stored and
          // unfindable at the same time for about half a minute. Saying "added"
          // during that gap is what makes a working upload look broken.
          return json({
            ok: true,
            searchable: result.searchable,
            chunks: result.chunkCount,
            documents: await listDocuments(env, businessId, 50),
          });
        } catch (error) {
          return json(
            { error: "ingest_failed", message: error instanceof Error ? error.message : "unknown" },
            400,
          );
        }
      }
      const documentId = segments[3];
      if (method === "DELETE" && documentId !== undefined) {
        // removeDocument, not deleteDocument. The second drops the row and
        // hands back the chunk ids for the caller to unindex; this console
        // threw them away, so a removed price list went on being retrieved and
        // quoted. One door, and it is this one.
        await removeDocument(env, businessId, documentId);
        return json({ documents: await listDocuments(env, businessId, 50) });
      }
    }

    // The chat bubble on the operator's own site.
    if (segments[2] === "web") {
      const channel = await getChannelForBusiness(env, businessId);
      if (channel === null) return notFound();
      if (method === "GET") {
        const origin = (await env.STATE.get(ORIGIN_KEY)) ?? "";
        return json({
          channel: {
            title: channel.title,
            greeting: channel.greeting,
            accent: channel.accent,
            allowedOrigins: channel.allowedOrigins,
            dailyLimit: channel.dailyLimit,
            enabled: channel.enabled,
          },
          // The key is public by nature: it sits in a script tag on a page
          // anyone can read. What protects the channel is the origin allowlist
          // and the daily cap, not this being secret.
          snippet:
            origin === ""
              ? ""
              : `<script src="${origin}/w/${channel.key}/widget.js"></script>`,
        });
      }
      if (method === "PATCH") {
        const body = (await request.json().catch(() => ({}))) as {
          title?: string;
          greeting?: string;
          accent?: string;
          allowedOrigins?: string;
          enabled?: boolean;
        };
        await updateChannel(env, channel.id, body);
        return json({ ok: true });
      }
    }

    // Attaching a Telegram bot to a business that already exists, which is how
    // a business created as a website later gains a second channel.
    if (method === "POST" && segments[2] === "telegram" && segments.length === 3) {
      const body = (await request.json().catch(() => ({}))) as {
        token?: string;
        useBotName?: boolean;
      };
      const token = String(body.token ?? "").trim();
      if (token.length === 0) return json({ error: "bad_token" }, 400);
      const attached = await attachTelegramBot(env, { businessId, token });
      if (!attached.ok) return json({ error: attached.reason }, 400);
      // Most owners give the bot the shop's name, and then type the shop's name
      // again here. Asking once is cheaper than two names for one thing, and
      // the answer is the owner's, so it is a flag rather than a guess.
      if (body.useBotName === true && attached.displayName.length > 0) {
        await renameBusiness(env, businessId, attached.displayName);
      }
      return json(await businessCard(env, businessId));
    }
  }

  // /customers/:id — one person, what is remembered about them, and the
  // buttons that change it.
  if (segments[0] === "customers" && segments.length >= 2) {
    const customerId = segments[1];
    if (customerId === undefined) return notFound();
    const customer = await getCustomer(env, customerId);
    if (!(await canAccessBusiness(env, userId, customer.businessId))) {
      return json({ error: "no_access" }, 403);
    }

    if (method === "GET" && segments.length === 2) {
      const [facts, business] = await Promise.all([
        listFacts(env, customerId),
        getBusiness(env, customer.businessId),
      ]);
      return json({ customer, facts, businessName: business.name });
    }
    if (method === "PATCH" && segments.length === 2) {
      const body = (await request.json().catch(() => ({}))) as { note?: string; stage?: string };
      if (typeof body.note === "string") {
        await setCustomerNote(env, customerId, body.note.slice(0, 500));
      }
      if (["new", "lead", "customer", "blocked"].includes(String(body.stage))) {
        await setCustomerStage(env, customerId, String(body.stage) as never);
      }
      return json({ customer: await getCustomer(env, customerId) });
    }
    // Forgetting what was remembered, without forgetting the person. The two
    // are different requests and are kept as different doors.
    if (method === "DELETE" && segments[2] === "facts") {
      await forgetFacts(env, customerId);
      return json({ ok: true, facts: [] });
    }
    if (method === "DELETE" && segments.length === 2) {
      await forgetCustomer(env, customerId);
      return json({ ok: true });
    }
  }

  // /conversations/:customerId  — addressed by customer, which is what a
  // person actually picks from a list.
  if (segments[0] === "conversations") {
    const customerId = segments[1];
    if (customerId === undefined) return notFound();
    const customer = await getCustomer(env, customerId);
    if (!(await canAccessBusiness(env, userId, customer.businessId))) {
      return json({ error: "no_access" }, 403);
    }
    const conversation = await conversationForCustomer(env, {
      businessId: customer.businessId,
      chatId: customer.chatId,
    });
    if (conversation === null) return json({ customer, messages: [], handover: null });
    const conversationId = conversation.id;

    if (method === "GET" && segments.length === 2) {
      const [messages, handover] = await Promise.all([
        transcript(env, conversationId, 100),
        getHandover(env, conversationId),
      ]);
      return json({ customer, conversationId, messages, handover });
    }
    if (method === "POST" && segments[2] === "takeover") {
      await takeOverConversation(env, {
        conversationId,
        businessId: customer.businessId,
        customerId: customer.id,
      });
      return json({ ok: true, handover: await getHandover(env, conversationId) });
    }
    if (method === "POST" && segments[2] === "release") {
      await endHandover(env, conversationId);
      return json({ ok: true, handover: await getHandover(env, conversationId) });
    }
    if (method === "POST" && segments[2] === "send") {
      const body = (await request.json().catch(() => ({}))) as { text?: string };
      const text = String(body.text ?? "").trim();
      if (text.length === 0) return json({ error: "empty" }, 400);
      // Through the shared path, which delivers before it records. The first
      // version of this route only wrote the row, so an operator's takeover
      // message reached the transcript and never the customer.
      const sent = await sendHumanReply(env, { customer, text });
      if (!sent.ok) return json({ error: sent.reason, message: sent.detail ?? "" }, 502);
      return json({ ok: true, messages: await transcript(env, conversationId, 100) });
    }

    // The bytes arrive as the body rather than as a multipart part. The name,
    // type and caption ride in headers, which keeps this route to one read of
    // one stream: a form parse would buffer the file twice on a worker with a
    // memory ceiling, to describe a file the browser already described.
    if (method === "POST" && segments[2] === "media") {
      const file = await request.blob();
      if (file.size === 0) return json({ error: "no_file" }, 400);
      if (file.size > MAX_UPLOAD_BYTES) {
        return json({ error: "too_large", message: "Files are limited to 20 MB." }, 413);
      }
      const filename = (request.headers.get("x-filename") ?? "file").slice(0, 120);
      const mime = request.headers.get("content-type") ?? "application/octet-stream";
      const sent = await sendHumanMedia(env, {
        customer,
        kind: kindForType(mime),
        file,
        filename,
        caption: decodeCaption(request.headers.get("x-caption")),
      });
      if (!sent.ok) return json({ error: sent.reason, message: sent.detail ?? "" }, 502);
      return json({ ok: true, messages: await transcript(env, conversationId, 100) });
    }

    // Removing a whole conversation. The customer's own copy is theirs and is
    // not touched: a bot cannot clear someone's chat history, and claiming to
    // would be the console lying about the world.
    if (method === "DELETE" && segments.length === 2) {
      await deleteConversationById(env, conversationId);
      return json({ ok: true });
    }
  }

  // What this deployment is running, and whether anything is waiting for it.
  if (method === "GET" && segments[0] === "system") {
    const [version, hasToken, usage, access, webSearch, documentData] = await Promise.all([
      versionStatus(),
      hasSecret(env, "github_token"),
      todayUsageAll(env),
      cloudflareAccess(env),
      hasSecret(env, "serpapi_key"),
      hasSecret(env, "nutrient_key"),
    ]);
    return json({
      apiRevision: API_REVISION,
      version,
      repo: UPSTREAM_REPO_URL,
      // Where an update would push. Shown because when it is unknown the
      // update cannot work, and that is worth saying before it is pressed.
      sourceRepo: await sourceRepoFor(env),
      githubToken: hasToken,
      // Whether the neuron figures can be read, and whose account they are for.
      cloudflare: access === null ? null : { account: access.name, accountId: access.accountId },
      origin: (await env.STATE.get(ORIGIN_KEY)) ?? "",
      // The two capabilities that are off until the owner adds their own key.
      // Whether the key is there, never the key: the console draws the state
      // from this and the assistant's prompt reads the same vault, so one
      // answer serves both and they cannot disagree.
      outside: { webSearch, documentData },
      usage,
    });
  }

  // The GitHub token this deployment updates itself with. It is sealed with the
  // deployment's own master key and kept in the owner's own KV, so this route
  // can store it and confirm its presence, and can never read it back out.
  if (segments[0] === "secrets" && segments[1] === "github_token") {
    if (method === "PUT") {
      const body = (await request.json().catch(() => ({}))) as { token?: string };
      const token = String(body.token ?? "").trim();
      if (token.length === 0) return json({ error: "empty" }, 400);
      // Checked against GitHub before it is stored, because a token that does
      // not work is discovered at the worst moment otherwise: mid update, with
      // the tree already read.
      const probe = await fetch("https://api.github.com/user", {
        headers: { authorization: `Bearer ${token}`, "user-agent": "muxel", accept: "application/vnd.github+json" },
      });
      if (!probe.ok) return json({ error: "token_rejected" }, 400);
      const who = (await probe.json().catch(() => ({}))) as { login?: string };
      await putSecret(env, "github_token", token);
      return json({ ok: true, login: who.login ?? "" });
    }
    if (method === "DELETE") {
      await clearSecret(env, "github_token");
      return json({ ok: true });
    }
  }

  /**
   * The Cloudflare read token, which is the only thing standing between this
   * deployment and its own usage figures.
   *
   * Stored the same way the GitHub token is, and checked before it is kept: a
   * token that cannot see an account is discovered here rather than as a
   * permanently blank cost line. What is deliberately not asked for is the
   * account id — the token belongs to one, and Cloudflare says which.
   */
  if (segments[0] === "secrets" && segments[1] === "cloudflare_token") {
    if (method === "PUT") {
      const body = (await request.json().catch(() => ({}))) as { token?: string };
      const token = String(body.token ?? "").trim();
      if (token.length === 0) return json({ error: "empty" }, 400);
      await putSecret(env, "cloudflare_token", token);
      // Anything learned from the previous token belongs to the previous token.
      await forgetAccess(env);
      const access = await cloudflareAccess(env);
      if (access === null) {
        await clearSecret(env, "cloudflare_token");
        await forgetAccess(env);
        return json({ error: "token_rejected" }, 400);
      }
      return json({ ok: true, account: access.name ?? "", accountId: access.accountId });
    }
    if (method === "DELETE") {
      await clearSecret(env, "cloudflare_token");
      await forgetAccess(env);
      return json({ ok: true });
    }
  }

  /**
   * The two keys for services outside Cloudflare, both the owner's own.
   *
   * One route rather than two, because they are the same act: paste a key,
   * have it checked against the service before it is kept, and switch a
   * capability on. A key that does not work is discovered here — while the
   * owner is looking at the field they typed it into — rather than as a tool
   * that refuses three days later with nothing to point at.
   *
   * What is deliberately not here is a way to read one back. The console shows
   * that a key is set and never shows the key, so a shared screen cannot leak
   * it, and this deployment is the only thing that ever holds it.
   */
  if (segments[0] === "secrets" && (segments[1] === "serpapi_key" || segments[1] === "nutrient_key")) {
    const name = segments[1];
    if (method === "PUT") {
      const body = (await request.json().catch(() => ({}))) as { token?: string };
      const token = String(body.token ?? "").trim();
      if (token.length === 0) return json({ error: "empty" }, 400);
      const refusal = await probeKey(name, token);
      if (refusal !== null) return json({ error: "token_rejected", detail: refusal }, 400);
      await putSecret(env, name, token);
      return json({ ok: true });
    }
    if (method === "DELETE") {
      await clearSecret(env, name);
      return json({ ok: true });
    }
  }

  if (method === "POST" && segments[0] === "update") {
    const [outcome, version] = await Promise.all([runSelfUpdate(env), versionStatus()]);
    // The version this push is bringing. The console watches for the deployment
    // to start reporting it, which is the one observable "the build is done" —
    // Cloudflare will not tell either of us how far through it is.
    return json({ ...outcome, expect: version.latest ?? "" });
  }

  // Telling the deployment where its own source lives, for a build that could
  // not work it out. Validated as a slug before it is stored, because it ends
  // up inside a URL that is then written to.
  /**
   * Whether the owner's own copy is public, read from GitHub.
   *
   * Its own route rather than a field on /system, which every page load asks
   * for: this is one call to GitHub and it belongs to the one tab that shows it.
   *
   * Read with the token already stored. A fine grained token can always read
   * the metadata of a repository it can see, so this needs no permission beyond
   * the one the update already has — which is the whole point. Making the
   * repository private is a thing the owner does on GitHub, because doing it
   * from here would mean this deployment held a token that could also delete
   * their repository.
   */
  if (method === "GET" && segments[0] === "source-repo") {
    const repo = await sourceRepoFor(env);
    const token = await getSecret(env, "github_token");
    if (repo === null || token === null) {
      return json({ repo, private: null, url: repo === null ? "" : `https://github.com/${repo}` });
    }
    let isPrivate: boolean | null = null;
    try {
      const response = await fetch(`https://api.github.com/repos/${repo}`, {
        headers: {
          authorization: `Bearer ${token}`,
          "user-agent": "muxel",
          accept: "application/vnd.github+json",
        },
      });
      if (response.ok) {
        isPrivate = ((await response.json()) as { private?: boolean }).private === true;
      }
    } catch {
      // Null is "we could not ask", which the console says rather than
      // guessing that a repository is safe.
    }
    return json({ repo, private: isPrivate, url: `https://github.com/${repo}/settings` });
  }

  if (method === "PUT" && segments[0] === "source-repo") {
    const body = (await request.json().catch(() => ({}))) as { repo?: string };
    const slug = String(body.repo ?? "").trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
    if (!isRepoSlug(slug)) return json({ error: "bad_repo" }, 400);
    await env.STATE.put(SOURCE_REPO_KEY, slug);
    return json({ ok: true, sourceRepo: slug });
  }

  // /messages/:messageId — one turn, on one side or both.
  if (segments[0] === "messages") {
    const messageId = segments[1];
    if (messageId === undefined) return notFound();
    const stored = await getMessageRow(env, messageId);
    if (stored === null) return notFound();
    if (!(await canAccessBusiness(env, userId, stored.businessId))) {
      return json({ error: "no_access" }, 403);
    }
    const wire = await wireFor(env, messageId);

    // The bytes of an attachment a customer sent.
    //
    // Streamed through the Worker rather than linked. A Telegram file link
    // carries the bot token in its path, so handing one to a browser would put
    // the business's own credential in an address bar, a proxy log and a
    // history file. The token stays here and only the file leaves.
    if (method === "GET" && segments[2] === "media") {
      const media = await getMedia(env, messageId);
      if (media === null) return notFound();
      const client = await clientForBot(env, media.botId);
      if (client === null) return notFound();
      try {
        const link = await client.getFileLink(media.fileId);
        const file = await fetch(link);
        if (!file.ok) return notFound();
        return new Response(file.body, {
          status: 200,
          headers: {
            ...CORS,
            "content-type": file.headers.get("content-type") ?? "application/octet-stream",
            // Telegram's own link expires; this one is only as good as the
            // request that made it, which is the honest lifetime for it.
            "cache-control": "private, max-age=300",
          },
        });
      } catch {
        return notFound();
      }
    }

    if (method === "PATCH") {
      const body = (await request.json().catch(() => ({}))) as { text?: string };
      const text = String(body.text ?? "").trim();
      if (text.length === 0) return json({ error: "empty" }, 400);
      // Only a message this deployment sent can be rewritten on the other
      // side. Telegram refuses to edit words it did not put there, so a
      // customer's own turn is edited in the record alone and the answer says
      // which of the two happened.
      let onWire = false;
      if (wire !== null && stored.role === "assistant") {
        const client = await clientForBot(env, wire.botId);
        if (client !== null) {
          try {
            await client.editMessageText({
              chatId: wire.chatId,
              messageId: wire.wireMessageId,
              text: escapeHtml(text.slice(0, 3500)),
            });
            onWire = true;
          } catch {
            onWire = false;
          }
        }
      }
      await updateMessageContent(env, messageId, text.slice(0, 3500));
      return json({ ok: true, onWire, messages: await transcript(env, stored.conversationId, 100) });
    }

    if (method === "DELETE") {
      const scope = new URL(request.url).searchParams.get("scope") === "everyone" ? "everyone" : "me";
      let onWire = false;
      if (scope === "everyone" && wire !== null) {
        const client = await clientForBot(env, wire.botId);
        if (client !== null) {
          // Telegram lets a bot withdraw a message for both sides inside 48
          // hours. Past that it refuses, and deleteMessage swallows the
          // refusal, so the honest answer is what the record can prove: the
          // console copy is gone, and onWire says whether the chat copy went
          // with it.
          await client.deleteMessage({ chatId: wire.chatId, messageId: wire.wireMessageId });
          onWire = true;
        }
      }
      await deleteMessageRow(env, messageId);
      return json({ ok: true, scope, onWire, messages: await transcript(env, stored.conversationId, 100) });
    }
  }

  return notFound();
}

/**
 * Checks a key against the service it belongs to, before it is stored.
 *
 * @returns Why it was refused, or null when the service accepted it.
 *
 * Each is probed on its own cheapest read. SerpApi has an account endpoint
 * that costs no search; Nutrient answers an unauthenticated-looking request
 * with a 401 that is distinguishable from a network failure. What neither does
 * is spend the owner's credits to find out whether their key works.
 *
 * A service that cannot be reached at all is not a rejection. Storing the key
 * in that case is the kinder failure: the owner typed it correctly and the
 * network was down, and refusing it would send them looking for a mistake they
 * did not make.
 */
async function probeKey(name: "serpapi_key" | "nutrient_key", token: string): Promise<string | null> {
  try {
    const response =
      name === "serpapi_key"
        // SerpApi's account endpoint reports the plan and the searches left,
        // and spends none of them.
        ? await fetch(`https://serpapi.com/account.json?api_key=${encodeURIComponent(token)}`, {
            signal: AbortSignal.timeout(10_000),
          })
        // Nutrient has no account endpoint on this API. The extract endpoint
        // with nothing attached is refused either way; what differs is how.
        // A bad key is 401 before any document is read, so this costs no
        // extraction credits, and a 400 for the missing file means the key got
        // far enough to be asked about the body.
        : await fetch("https://api.nutrient.io/extraction/extract", {
            method: "POST",
            headers: { authorization: `Bearer ${token}` },
            body: new FormData(),
            signal: AbortSignal.timeout(10_000),
          });
    if (response.status === 401 || response.status === 403) return "the service did not recognise that key";
    return null;
  } catch {
    return null;
  }
}
