/**
 * Worker entry point.
 *
 * Two routes are exposed. `/health` reports readiness without revealing
 * configuration values, and `/tg/:path` receives Telegram webhooks. Every other
 * path returns 404 so that the deployment presents no other surface.
 */

import { isMuxelError, timingSafeEqual } from "@muxel/core";

import { open, sha256Hex } from "./crypto.js";
import { getBusiness, getBotByWebhookPath } from "./db/queries.js";
import { missingConfiguration, type Env } from "./env.js";
import { TelegramClient, type TelegramUpdate } from "./telegram/api.js";
import { handleAdminUpdate } from "./telegram/admin.js";
import { handleReplyUpdate } from "./telegram/reply.js";

const SECRET_HEADER = "x-telegram-bot-api-secret-token";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      const missing = missingConfiguration(env);
      return json(
        {
          service: "muxel",
          status: missing.length === 0 ? "ready" : "not_configured",
          missing,
        },
        missing.length === 0 ? 200 : 503,
      );
    }

    if (request.method === "POST" && url.pathname.startsWith("/tg/")) {
      return handleWebhook(request, env, ctx, url.pathname.slice("/tg/".length));
    }

    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function handleWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  webhookPath: string,
): Promise<Response> {
  const bot = await getBotByWebhookPath(env, webhookPath);
  if (bot === null) {
    // Same response as a bad secret so that probing cannot enumerate paths.
    return new Response("not found", { status: 404 });
  }

  const presented = request.headers.get(SECRET_HEADER) ?? "";
  const presentedHash = await sha256Hex(presented);
  if (!timingSafeEqual(presentedHash, bot.webhookSecretHash)) {
    return new Response("not found", { status: 404 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  // Telegram retries any webhook that does not answer quickly, which would
  // duplicate replies. Acknowledge immediately and finish the work in the
  // background.
  ctx.waitUntil(
    dispatch(env, bot, update, new URL(request.url).origin).catch((error: unknown) => {
      console.error("update handling failed", {
        botId: bot.id,
        businessId: bot.businessId,
        code: isMuxelError(error) ? error.code : "unknown",
        error: error instanceof Error ? error.message : String(error),
      });
    }),
  );

  return json({ ok: true });
}

async function dispatch(
  env: Env,
  bot: Awaited<ReturnType<typeof getBotByWebhookPath>> & object,
  update: TelegramUpdate,
  origin: string,
): Promise<void> {
  const token = await open(env.MASTER_KEY, bot.tokenCiphertext);
  const client = new TelegramClient(token);

  if (bot.role === "admin") {
    await handleAdminUpdate(env, client, bot, update, origin);
    return;
  }

  const business = await getBusiness(env, bot.businessId);
  await handleReplyUpdate(env, client, bot, business, update);
}
