/**
 * Worker entry point.
 *
 * Three routes are exposed. `/` and `/setup` complete first run configuration
 * and report status, `/health` answers monitoring, and `/tg/:path` receives
 * Telegram webhooks. Every other path returns 404 so the deployment presents no
 * other surface.
 */

import { isMuxelError, timingSafeEqual } from "@muxel/core";

import { open, sha256Hex } from "./crypto.js";
import { ensureSchema } from "./db/migrate.js";
import { getBusiness, getBotByWebhookPath, getConsoleBot } from "./db/queries.js";
import { missingConfiguration, type Env } from "./env.js";
import { peekMasterKey, requireMasterKey } from "./secrets.js";
import { renderSetupPage, repairWebhook, runSetup } from "./setup.js";
import { checkForUpdate } from "./updates.js";
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

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      const missing = missingConfiguration(env);
      const configured = (await peekMasterKey(env)) !== null;
      return json(
        {
          service: "muxel",
          status: missing.length > 0 ? "not_configured" : configured ? "ready" : "awaiting_setup",
          missing,
        },
        missing.length === 0 ? 200 : 503,
      );
    }

    if (url.pathname === "/" || url.pathname === "/setup") {
      try {
        const outcome = await runSetup(env, url.origin);
        return html(renderSetupPage(outcome), outcome.ok ? 200 : 503);
      } catch (error) {
        console.error("setup failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        return html(
          renderSetupPage({
            ok: false,
            schemaVersion: 0,
            botUsername: null,
            owner: null,
            missing: [],
            note:
              error instanceof Error
                ? `Setup could not finish: ${error.message}`
                : "Setup could not finish.",
          }),
          500,
        );
      }
    }

    if (request.method === "POST" && url.pathname.startsWith("/tg/")) {
      return handleWebhook(request, env, ctx, url.pathname.slice("/tg/".length));
    }

    return new Response("not found", { status: 404 });
  },

  /**
   * Periodic repair.
   *
   * Telegram drops a webhook that has been failing, and moving a deployment to
   * a custom domain leaves the old address registered. Either leaves a bot that
   * looks configured and answers nothing, which is the failure nobody notices.
   * This checks and re-registers rather than waiting to be told.
   */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      Promise.allSettled([repairWebhook(env), checkForUpdate(env)]).then(([webhook, update]) => {
        if (webhook.status === "rejected") {
          console.error("scheduled webhook check failed", { reason: String(webhook.reason) });
        } else if (webhook.value !== "healthy") {
          console.log("scheduled webhook check", { outcome: webhook.value });
        }
        if (update.status === "rejected") {
          console.error("scheduled update check failed", { reason: String(update.reason) });
        } else if (update.value === "notified") {
          console.log("told the owner an update is available");
        }
      }),
    );
  },
} satisfies ExportedHandler<Env>;

async function handleWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  webhookPath: string,
): Promise<Response> {
  // Cheap after the first call in an isolate, and it guarantees the tables
  // exist even if a webhook lands before anyone has opened the setup page.
  await ensureSchema(env);

  // The console bot and the customer bots are separate things. The console
  // belongs to the deployment and reaches every business; a customer bot serves
  // exactly one. They are looked up separately so a customer can never arrive
  // on the console path.
  const console_ = await getConsoleBot(env);
  const bot =
    console_ !== null && console_.webhookPath === webhookPath
      ? ({ kind: "console" as const, ...console_ })
      : await getBotByWebhookPath(env, webhookPath).then((found) =>
          found === null ? null : ({ kind: "reply" as const, ...found }),
        );

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
        kind: bot.kind,
        code: isMuxelError(error) ? error.code : "unknown",
        error: error instanceof Error ? error.message : String(error),
      });
    }),
  );

  return json({ ok: true });
}

type ResolvedBot =
  | ({ kind: "console" } & NonNullable<Awaited<ReturnType<typeof getConsoleBot>>>)
  | ({ kind: "reply" } & NonNullable<Awaited<ReturnType<typeof getBotByWebhookPath>>>);

async function dispatch(
  env: Env,
  bot: ResolvedBot,
  update: TelegramUpdate,
  origin: string,
): Promise<void> {
  const masterKey = await requireMasterKey(env);
  const client = new TelegramClient(await open(masterKey, bot.tokenCiphertext));

  if (bot.kind === "console") {
    await handleAdminUpdate(env, client, update, origin);
    return;
  }

  const business = await getBusiness(env, bot.businessId);
  await handleReplyUpdate(env, client, bot, business, update);
}
