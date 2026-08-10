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
import {
  enableUpdatesUrl,
  isRepoSlug,
  repositorySettingsUrl,
  repositoryVisibility,
  SOURCE_REPO,
  updateWorkflowUrl,
  workflowPermissionsUrl,
  type RepoVisibility,
} from "./repo.js";
import { UPDATE_STUB } from "./updateStub.js";
import { peekMasterKey, resolveMasterKey } from "./secrets.js";
import { TelegramClient } from "./telegram/api.js";
import { CONSOLE_COMMANDS } from "./telegram/admin.js";
import { t } from "./telegram/i18n.js";

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
  /** The GitHub copy this was built from, when the build could tell. */
  readonly repo?: string;
  readonly repoVisibility?: RepoVisibility;
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

  // Published in English, because Telegram holds one list per bot and setup
  // runs before anyone has chosen a console language. The screens the commands
  // open are translated.
  await client
    .setMyCommands(
      CONSOLE_COMMANDS.map((entry) => ({
        command: entry.command,
        description: t("en", entry.key),
      })),
    )
    // A missing menu is a smaller problem than a setup that refuses to finish.
    .catch((error: unknown) => {
      console.warn("could not publish the command list", {
        reason: error instanceof Error ? error.message : String(error),
      });
    });

  await env.STATE.put(ORIGIN_KEY, origin);

  // Checked on every visit rather than remembered, so the warning disappears
  // by itself the moment the operator acts on it.
  const repoVisibility = await repositoryVisibility(SOURCE_REPO);

  return {
    ok: true,
    schemaVersion,
    botUsername: username,
    owner,
    missing: [],
    repo: SOURCE_REPO,
    repoVisibility,
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
/**
 * Completes or repairs setup on a schedule.
 *
 * Setup is normally finished by the deploy script, which makes the first
 * request itself. That request can fail for a reason that has nothing to do
 * with the deployment: a workers.dev address on a brand new account is not
 * routable for a minute or two after the Worker is uploaded, and every attempt
 * inside that window is answered by the edge with a 404. A deployment could
 * therefore be perfectly good and still have no Telegram webhook, waiting on a
 * person to open a URL nobody told them mattered.
 *
 * So the address is written into KV by the deploy script before any request is
 * made, and this finishes the job unattended once the address starts serving.
 */
export async function finishSetup(
  env: Env,
): Promise<"skipped" | "healthy" | "repaired" | "completed"> {
  const origin = await env.STATE.get(ORIGIN_KEY);
  if (origin === null) {
    // Nothing has ever reached this deployment and the deploy script did not
    // record an address, so it still does not know where it lives.
    return "skipped";
  }

  if ((await getConsoleBot(env)) === null) {
    // Deployed but never set up. Everything runSetup needs is configuration,
    // and the address is now known, so it can be run from here.
    if (missingConfiguration(env).length > 0) {
      return "skipped";
    }
    await runSetup(env, origin);
    return "completed";
  }

  return repairWebhook(env);
}

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

/**
 * Renders the one thing the deploy flow cannot do for the operator.
 *
 * Cloudflare creates the GitHub copy public and offers no choice, and nothing
 * in the deployment can change that for them. Shown only while the copy is
 * actually still public, so acting on it makes it go away rather than leaving a
 * permanent scold on the page.
 */
function renderRepoCard(outcome: SetupOutcome): string {
  const repo = outcome.repo ?? "";
  if (repo.length === 0 || outcome.repoVisibility !== "public") {
    return "";
  }
  const settings = escapeHtml(repositorySettingsUrl(repo));
  return `
      <div class="card">
        <p class="warn"><strong>Your code copy is public</strong></p>
        <p>Cloudflare copied this project into
        <code>${escapeHtml(repo)}</code> and had to create it public. No business
        data or secret is in it, but the identifiers of the resources in your
        account are, and those are not worth publishing.</p>
        <p><a href="${settings}" rel="noreferrer">Open the repository settings</a>,
        scroll to <strong>Danger Zone</strong>, choose <strong>Change
        visibility</strong> and pick <strong>Private</strong>. Deployments keep
        working. Reload this page afterwards and this notice will be gone.</p>
      </div>`;
}

/**
 * Renders the three step enable flow for automatic updates.
 *
 * The first link opens GitHub's new file editor with the workflow already
 * filled in, so the operator commits a file they never typed. It cannot go
 * further than that: the file has to be committed by a person because the
 * deploy flow's GitHub App cannot create workflow files, and the permission
 * toggle in step two is a repository setting GitHub lets nobody set from a
 * link. Whether the workflow already exists cannot be checked from here once
 * the repository is private, so the card stays and says so.
 */
function renderUpdatesCard(outcome: SetupOutcome): string {
  const repo = outcome.repo ?? "";
  if (!isRepoSlug(repo)) {
    return "";
  }
  const addFile = escapeHtml(enableUpdatesUrl(repo, UPDATE_STUB));
  const permissions = escapeHtml(workflowPermissionsUrl(repo));
  const run = escapeHtml(updateWorkflowUrl(repo));
  return `
      <div class="card">
        <p><strong>Automatic updates</strong></p>
        <p>Three steps, once. Afterwards fixes arrive on their own, daily. If
        you have already done this, there is nothing to do here.</p>
        <ol>
          <li><a href="${addFile}" rel="noreferrer">Add the update workflow</a>.
          The file is already filled in; press <strong>Commit changes</strong>.</li>
          <li><a href="${permissions}" rel="noreferrer">Allow it to write</a>:
          under <strong>Workflow permissions</strong> choose
          <strong>Read and write permissions</strong> and save.</li>
          <li><a href="${run}" rel="noreferrer">Run it once</a> with
          <strong>Run workflow</strong> to update right now.</li>
        </ol>
      </div>`;
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
      }
      ${renderRepoCard(outcome)}
      ${renderUpdatesCard(outcome)}`
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
  .card {
    border: 1px solid #a16207; border-radius: 0.5rem;
    padding: 0.25rem 1rem; margin: 1.75rem 0;
  }
  .card p:first-child { margin-top: 0.85rem; }
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
