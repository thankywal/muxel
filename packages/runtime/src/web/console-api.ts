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
  listProducts,
  takeOverConversation,
  todayUsage,
  todayUsageAll,
  transcript,
  conversationForCustomer,
  createBot,
  createProduct,
  deleteDocument,
  forgetCustomer,
  forgetFacts,
  getOperatorLocale,
  listFacts,
  listHandovers,
  previousPrompt,
  setBusinessPrompt,
  setCustomerNote,
  setCustomerStage,
  setOperatorLocale,
  deleteConversationById,
  deleteMessageRow,
  deleteProduct,
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
import { clearSecret, hasSecret, putSecret } from "./secrets-vault.js";
import { runSelfUpdate } from "./self-update.js";
import { versionStatus } from "../updates.js";
import { ingestDocument } from "../rag/ingest.js";
import { SKILLS } from "../telegram/skills.js";
import { LOCALE_NAMES, LOCALES, isLocale } from "../telegram/i18n.js";
import { missingConfiguration } from "../env.js";
import { TARGET_VERSION, currentVersion } from "../db/migrate.js";
import { UPSTREAM_REPO } from "../version.js";
import type { Env } from "../env.js";
import { MAX_PROMPT_CHARS, MODEL_PRESETS } from "../telegram/admin.js";
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
): Promise<{ ok: true; username: string } | { ok: false; reason: string }> {
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
  return { ok: true, username };
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
    const operator = await findOperator(env, userId);
    const row = await env.DB.prepare("SELECT label FROM operator WHERE telegram_user_id = ?")
      .bind(userId)
      .first<{ label: string | null }>();
    return json({
      label: row?.label?.trim() || (operator?.role === "owner" ? "Owner" : "Operator"),
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
      const body = (await request.json().catch(() => ({}))) as { name?: string };
      const name = String(body.name ?? "").trim();
      if (name.length === 0 || name.length > 80) {
        return json({ error: "bad_name", message: "Give the business a name of 1 to 80 characters." }, 400);
      }
      const business = await createBusiness(env, {
        name,
        locale: env.BUSINESS_LOCALE?.trim() || "en",
        model: env.DEFAULT_MODEL,
      });
      // Same as the Telegram path: a business always has a web channel, which
      // is switched off until someone turns it on.
      await createChannel(env, { businessId: business.id, title: name });
      return json(await businessCard(env, business.id), 201);
    }

    const businessId = segments[1];
    if (businessId === undefined) return notFound();
    if (!(await canAccessBusiness(env, userId, businessId))) return json({ error: "no_access" }, 403);

    if (method === "GET" && segments.length === 2) {
      const [card, products, documents, recentCustomers] = await Promise.all([
        businessCard(env, businessId),
        listProducts(env, businessId),
        listDocuments(env, businessId),
        listCustomers(env, businessId, 50),
      ]);
      // Deliberately not `customers`. The card already carries that name for
      // the count, and spreading a list over it left the console drawing
      // "[object Object]" where a number belonged. One name, one meaning.
      return json({ ...card, products, documents, recentCustomers });
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

    // What the assistant is allowed to quote a price from.
    if (segments[2] === "products") {
      if (method === "GET" && segments.length === 3) {
        return json({ products: await listProducts(env, businessId) });
      }
      if (method === "POST" && segments.length === 3) {
        const body = (await request.json().catch(() => ({}))) as {
          name?: string;
          price?: string;
          description?: string;
        };
        const name = String(body.name ?? "").trim();
        if (name.length === 0) return json({ error: "bad_name" }, 400);
        await createProduct(env, {
          businessId,
          name: name.slice(0, 120),
          price: String(body.price ?? "").trim().slice(0, 60),
          description: String(body.description ?? "").trim().slice(0, 500),
        });
        return json({ products: await listProducts(env, businessId) }, 201);
      }
      const productId = segments[3];
      if (method === "DELETE" && productId !== undefined) {
        await deleteProduct(env, productId);
        return json({ products: await listProducts(env, businessId) });
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
          const result = await ingestDocument(env, {
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
        await deleteDocument(env, businessId, documentId);
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
      const body = (await request.json().catch(() => ({}))) as { token?: string };
      const token = String(body.token ?? "").trim();
      if (token.length === 0) return json({ error: "bad_token" }, 400);
      const attached = await attachTelegramBot(env, { businessId, token });
      if (!attached.ok) return json({ error: attached.reason }, 400);
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
    const [version, hasToken, usage] = await Promise.all([
      versionStatus(),
      hasSecret(env, "github_token"),
      todayUsageAll(env),
    ]);
    return json({
      version,
      repo: UPSTREAM_REPO,
      githubToken: hasToken,
      origin: (await env.STATE.get(ORIGIN_KEY)) ?? "",
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

  if (method === "POST" && segments[0] === "update") {
    return json(await runSelfUpdate(env));
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
