/**
 * First run setup.
 *
 * A one click deploy leaves a Worker with an empty database, no schema, no
 * owner and a bot that Telegram does not know how to reach. It also leaves the
 * Worker unable to discover its own public address, because that is assigned
 * after the code is uploaded.
 *
 * A request supplies the missing piece: it carries the public origin, so setup
 * can register the Telegram webhook against it, record it for later repair,
 * apply the schema and install the configured owner.
 *
 * No business is created here. A business exists because a bot serves it, and
 * that pairing is made in the console. The bot connected at this point is the
 * console itself, which belongs to the deployment and to no business.
 *
 * Every step is idempotent. Running it twice re-registers the webhook and
 * changes nothing else, which is also the repair path when a deployment moves
 * to a custom domain.
 */

import { generateId, generateShortId } from "@muxel/core";

import { open, seal, sha256Hex } from "./crypto.js";
import { addOperator, getConsoleBot, putConsoleBot } from "./db/queries.js";
import { ensureSchema } from "./db/migrate.js";
import { missingConfiguration, ownerTelegramId, type Env } from "./env.js";
import { dimensionAdvice } from "./rag/dimensions.js";
import { peekMasterKey, resolveMasterKey } from "./secrets.js";
import { TelegramClient } from "./telegram/api.js";

export const ORIGIN_KEY = "system:origin";

/** Mirrors the key dimensions.ts reads, so setup can prime it. */
const INDEX_DIMENSIONS_KEY = "system:index_dimensions";

/**
 * Records what the Vectorize index expects and reports whether it suits us.
 *
 * The index fixes its dimension count at creation and the Worker configuration
 * cannot carry that number, so on a one click deploy it is typed into a form.
 * Rather than refuse a deployment over it, embeddings are fitted to whatever
 * the index has, and this only reports the consequence.
 */
async function inspectIndex(env: Env): Promise<string | null> {
  let dimensions: number | undefined;
  try {
    dimensions = (await env.KNOWLEDGE.describe()).dimensions;
  } catch (error) {
    // Setup runs seconds after the index was created, and a read that early can
    // fail while it settles. The model's own size is assumed until it can be
    // read, which the next upload or scheduled run will do.
    console.warn("could not read the vectorize index during setup", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  if (typeof dimensions !== "number" || dimensions <= 0) {
    return null;
  }
  await env.STATE.put(INDEX_DIMENSIONS_KEY, String(dimensions));
  return dimensionAdvice(dimensions);
}

export interface SetupOutcome {
  readonly ok: boolean;
  readonly schemaVersion: number;
  readonly botUsername: string | null;
  readonly owner: number | null;
  readonly missing: readonly string[];
  readonly note: string;
}

function notReady(note: string, missing: readonly string[] = []): SetupOutcome {
  return {
    ok: false,
    schemaVersion: 0,
    botUsername: null,
    owner: null,
    missing,
    note,
  };
}

export async function runSetup(env: Env, origin: string): Promise<SetupOutcome> {
  const missing = missingConfiguration(env);
  if (missing.length > 0) {
    return notReady("Add the missing settings as Worker secrets, then reload this page.", missing);
  }

  const owner = ownerTelegramId(env);
  if (owner === null) {
    return notReady(
      "OWNER_TELEGRAM_ID must be the numeric Telegram account id, digits only.",
      ["OWNER_TELEGRAM_ID"],
    );
  }

  // Reported rather than fatal: a surprising dimension count costs accuracy,
  // not correctness, and refusing to set up over it strands the deployment.
  const indexNote = await inspectIndex(env);

  const schemaVersion = await ensureSchema(env);
  const masterKey = await resolveMasterKey(env);

  // The bot token is validated before anything is written, so a typo does not
  // leave a half configured deployment behind.
  const token = env.ADMIN_BOT_TOKEN as string;
  const client = new TelegramClient(token);
  const me = await client.getMe();
  const username = me.username ?? "unknown";

  await addOperator(env, { telegramUserId: owner, role: "owner" });

  const existing = await getConsoleBot(env);

  // A fresh path and secret on every run means an address leaked from an old
  // deployment stops working as soon as setup is repeated.
  const webhookPath = generateId(24);
  const webhookSecret = generateShortId() + generateShortId();

  await putConsoleBot(env, {
    username,
    webhookPath,
    tokenCiphertext: await seal(masterKey, token),
    webhookSecretHash: await sha256Hex(webhookSecret),
  });

  await client.setWebhook({
    url: `${origin}/tg/${webhookPath}`,
    secretToken: webhookSecret,
  });

  await env.STATE.put(ORIGIN_KEY, origin);

  return {
    ok: true,
    schemaVersion,
    botUsername: username,
    owner,
    missing: [],
    note: [
      existing === null ? "Setup complete." : "Webhook re-registered against the current address.",
      indexNote,
    ]
      .filter((line) => line !== null)
      .join(" "),
  };
}

/**
 * Re-registers the Telegram webhook if it has drifted.
 *
 * Runs on a schedule once a deployment knows its own address. Telegram drops a
 * webhook that fails for long enough, and a move to a custom domain leaves the
 * old address registered. Both leave a bot that looks configured and answers
 * nothing, so they are repaired rather than waited on.
 */
export async function repairWebhook(env: Env): Promise<"skipped" | "healthy" | "repaired"> {
  const origin = await env.STATE.get(ORIGIN_KEY);
  if (origin === null) {
    // Nothing has ever reached this deployment, so its address is still unknown.
    return "skipped";
  }

  const bot = await getConsoleBot(env);
  const masterKey = await peekMasterKey(env);
  if (bot === null || masterKey === null) {
    return "skipped";
  }

  const client = new TelegramClient(await open(masterKey, bot.tokenCiphertext));
  const expected = `${origin}/tg/${bot.webhookPath}`;
  const info = await client.getWebhookInfo();
  if (info.url === expected) {
    return "healthy";
  }

  console.warn("telegram webhook had drifted, re-registering", {
    expected,
    found: info.url,
    lastError: info.last_error_message ?? null,
  });
  await runSetup(env, origin);
  return "repaired";
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Renders the outcome as a page a non technical owner can act on. */
export function renderSetupPage(outcome: SetupOutcome): string {
  const body = outcome.ok
    ? `
      <p class="ok">Your console is connected.</p>
      <dl>
        <dt>Console bot</dt><dd>@${escapeHtml(outcome.botUsername ?? "")}</dd>
        <dt>Owner</dt><dd>Telegram id ${outcome.owner}</dd>
      </dl>
      <p>Open <strong>@${escapeHtml(outcome.botUsername ?? "")}</strong> in Telegram and send
      <code>/start</code>. This bot is your private control panel: add a business
      there and it will ask for the bot your customers will write to.</p>
      ${
        outcome.note.includes("dimensions")
          ? `<p class="warn">${escapeHtml(outcome.note)}</p>`
          : ""
      }`
    : `
      <p class="bad">Not ready yet.</p>
      <p>${escapeHtml(outcome.note)}</p>
      ${
        outcome.missing.length > 0
          ? `<p>Missing: <code>${outcome.missing.map(escapeHtml).join("</code>, <code>")}</code></p>`
          : ""
      }`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Muxel setup</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font: 16px/1.6 ui-sans-serif, system-ui, sans-serif;
    max-width: 34rem; margin: 4rem auto; padding: 0 1.25rem;
  }
  h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
  .sub { opacity: 0.65; margin-top: 0; }
  .ok { color: #15803d; font-weight: 600; }
  .bad { color: #b91c1c; font-weight: 600; }
  .warn { color: #a16207; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 0.35rem 1rem; margin: 1.5rem 0; }
  dt { opacity: 0.65; }
  dd { margin: 0; }
  code {
    font: 0.9em ui-monospace, monospace;
    background: rgba(127,127,127,0.15); padding: 0.1em 0.35em; border-radius: 4px;
  }
</style>
</head>
<body>
  <h1>Muxel</h1>
  <p class="sub">Running in your own Cloudflare account.</p>
  ${body}
</body>
</html>`;
}
