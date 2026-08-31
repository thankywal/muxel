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
  appendHumanMessage,
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
  transcript,
  conversationForCustomer,
  updateBusinessModel,
} from "../db/queries.js";
import { createChannel, getChannelForBusiness } from "./channel.js";
import type { Env } from "../env.js";
import { MODEL_PRESETS } from "../telegram/admin.js";
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

  // GET /overview
  if (method === "GET" && segments[0] === "overview") {
    const businesses = await listBusinesses(env, userId);
    const cards = await Promise.all(businesses.map((b) => businessCard(env, b.id)));
    return json({
      businesses: cards,
      totals: {
        businesses: cards.length,
        agents: cards.filter((c) => c.telegram !== null).length + cards.filter((c) => c.web !== null).length,
        messagesToday: cards.reduce((n, c) => n + c.usage.messages, 0),
        customers: cards.reduce((n, c) => n + c.customers, 0),
      },
      events: await listEvents(env, 8),
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
      const [card, products, documents, customers] = await Promise.all([
        businessCard(env, businessId),
        listProducts(env, businessId),
        listDocuments(env, businessId),
        listCustomers(env, businessId, 50),
      ]);
      return json({ ...card, products, documents, customers });
    }
    if (method === "DELETE" && segments.length === 2) {
      await deleteBusiness(env, businessId);
      return json({ ok: true });
    }
    if (method === "PATCH" && segments.length === 2) {
      const body = (await request.json().catch(() => ({}))) as { model?: string };
      if (typeof body.model === "string" && MODEL_PRESETS.some((p) => p.id === body.model)) {
        await updateBusinessModel(env, businessId, body.model);
      }
      return json(await businessCard(env, businessId));
    }
    if (method === "GET" && segments[2] === "customers") {
      return json({ customers: await listCustomers(env, businessId, 100) });
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
      await appendHumanMessage(env, {
        conversationId,
        businessId: customer.businessId,
        content: text,
      });
      return json({ ok: true, messages: await transcript(env, conversationId, 100) });
    }
  }

  return notFound();
}
