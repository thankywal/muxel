/**
 * Worker entry point.
 *
 * `/` and `/setup` complete first run configuration and report status,
 * `/health` answers monitoring, `/tg/:path` receives Telegram webhooks, and
 * `/w/:key` serves the website widget and the requests it makes. Every other
 * path returns 404 so the deployment presents no other surface.
 */

import { isMuxelError, timingSafeEqual } from "@muxel/core";

import { open, sha256Hex } from "./crypto.js";
import { pendingExtractions, runExtraction } from "./rag/extract.js";
import { ensureSchema } from "./db/migrate.js";
import { getBusiness, getBotByWebhookPath, getConsoleBot } from "./db/queries.js";
import { missingConfiguration, type Env } from "./env.js";
import { peekMasterKey, requireMasterKey } from "./secrets.js";
import { finishSetup, renderSetupPage, runSetup } from "./setup.js";
import { checkForUpdate } from "./updates.js";
import { TelegramClient, type TelegramUpdate } from "./telegram/api.js";
import { handleAdminUpdate } from "./telegram/admin.js";
import { handleReplyUpdate } from "./telegram/reply.js";
import { handleWebRequest } from "./web/routes.js";

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

/**
 * Whether the database answers the cheapest question there is.
 *
 * Cheap on purpose: /health is asked by every console that opens and by every
 * deploy, and it has to stay something anyone can ask without thinking.
 */
async function databaseAnswers(env: Env): Promise<boolean> {
  try {
    await env.DB.prepare("SELECT 1").first();
    return true;
  } catch (error) {
    console.error("health: the database did not answer", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * The answer when a request fails on its way in, which in practice means the
 * database it needs is not there.
 *
 * The failure used to escape as Cloudflare's error 1101: a plain text page with
 * no cross origin headers, which a browser will not hand to a script at all. A
 * shop's chat bubble simply never appeared, and the console had nothing it
 * could show. The reason goes to the log, where the owner can read it. The
 * response says only that the deployment cannot answer, because anyone can ask.
 */
function unavailable(door: string, error: unknown, cors: Readonly<Record<string, string>>): Response {
  console.error(`${door} request failed`, {
    code: isMuxelError(error) ? error.code : "unknown",
    error: error instanceof Error ? error.message : String(error),
  });
  return new Response(
    JSON.stringify({ error: "unavailable", message: "This deployment cannot answer right now." }),
    {
      status: 503,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cors },
    },
  );
}

import { handleConsoleApi } from "./web/console-api.js";
import { CORS, handleConsoleRequest } from "./web/console.js";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Answered with cross origin headers because the console is a page the
    // owner opens somewhere else, and this is the first thing it asks. It
    // carries no secret: what it reports is whether the deployment is
    // configured, which anyone who can reach the URL can already tell.
    if (url.pathname === "/health") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
      const missing = missingConfiguration(env);
      const configured = (await peekMasterKey(env)) !== null;
      // Asked of the database itself, because nothing else here can tell. The
      // master key lives in KV, so a deployment whose database had been deleted
      // went on reporting ready for over a month while every chat bubble and
      // every console call it served failed. Only asked once nothing is
      // missing: a binding that is not there cannot be asked anything.
      const reachable = missing.length > 0 || (await databaseAnswers(env));
      return new Response(
        JSON.stringify({
          service: "muxel",
          status: missing.length > 0 ? "not_configured" : !reachable ? "database_unavailable" : configured ? "ready" : "awaiting_setup",
          missing,
        }),
        {
          status: missing.length === 0 && reachable ? 200 : 503,
          headers: { "content-type": "application/json; charset=utf-8", ...CORS },
        },
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

    // The web console. Bearer authenticated against a code the owner got from
    // the console bot, so the same operator checks apply as on Telegram.
    if (url.pathname.startsWith("/admin/")) {
      // Every preflight under here was already answered this way, by both
      // handlers below, but only after the schema check. Answered first, a
      // console can still read why its real request failed while the database
      // is unreachable, instead of seeing a refused preflight and nothing else.
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
      try {
        await ensureSchema(env);
        const rest = url.pathname.slice("/admin".length);
        // The data API the web console lays out for itself, checked first so a
        // path under it never falls through to the screen renderer.
        if (rest.startsWith("/api/")) {
          const answered = await handleConsoleApi(env, request, rest.slice("/api".length), (work) => ctx.waitUntil(work));
          if (answered !== null) return answered;
        }
        const handled = await handleConsoleRequest(env, request, rest);
        if (handled !== null) return handled;
      } catch (error) {
        return unavailable("console", error, CORS);
      }
    }

    // The website channel. Public by nature, so it validates the origin and
    // the daily allowance itself rather than relying on a secret path.
    if (url.pathname.startsWith("/w/")) {
      try {
        await ensureSchema(env);
        return await handleWebRequest(request, env, ctx, url.pathname.slice("/w/".length));
      } catch (error) {
        return unavailable("website", error, { "access-control-allow-origin": "*" });
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
      // The schedule can fire on a deployment nothing has ever reached, so the
      // schema is applied here as well as on the webhook path.
      ensureSchema(env)
        .then(() =>
          Promise.allSettled([finishSetup(env), checkForUpdate(env), pumpExtraction(env)]),
        )
        .then(([webhook, update, extraction]) => {
        if (webhook.status === "rejected") {
          console.error("scheduled setup check failed", { reason: String(webhook.reason) });
        } else if (webhook.value !== "healthy") {
          console.log("scheduled setup check", { outcome: webhook.value });
        }
        if (update.status === "rejected") {
          console.error("scheduled update check failed", { reason: String(update.reason) });
        } else {
          // Every outcome is logged, including the quiet ones. A check that
          // silently declines to run looks exactly like one that found nothing,
          // and that ambiguity already cost a release worth of notices.
          console.log("scheduled update check", { outcome: update.value });
        }
        if (extraction.status === "rejected") {
          // The failure is also recorded on the document's extraction state,
          // which is what the console reads.
          console.error("scheduled extraction failed", { reason: String(extraction.reason) });
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

/**
 * Reads one document the products view is still waiting on.
 *
 * One per tick, because extraction is an inference call and this runs beside
 * the other scheduled work inside one bounded invocation. A backlog of five
 * documents clears within an hour and a quarter, unattended.
 */
async function pumpExtraction(env: Env): Promise<void> {
  const [next] = await pendingExtractions(env, 1);
  if (next === undefined) {
    return;
  }
  const business = await getBusiness(env, next.businessId);
  const count = await runExtraction(env, { ...next, model: business.model });
  console.log("extracted products from a document", {
    businessId: next.businessId,
    documentId: next.documentId,
    count,
  });
}
