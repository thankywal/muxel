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
 * There are two ways to reach the console and setup finishes with either. A
 * console key needs nothing registered anywhere, so its half is one row: the
 * owner. The Telegram half is the one with an outside party in it, and it runs
 * only when both of its settings are there, so a deployment is never left
 * holding half a bot.
 *
 * No business is created here. A business exists because a bot serves it, and
 * that pairing is made in the console. The bot connected at this point is the
 * console itself, which belongs to the deployment and to no business.
 *
 * Every step is idempotent. Running it twice re-registers the webhook and
 * changes nothing else, which is also the repair path when a deployment moves
 * to a custom domain.
 */

import { generateId, generateShortId, MuxelError } from "@muxel/core";

import { consoleClaimed, ensureConsoleKey } from "./console-key.js";
import { open, seal, sha256Hex } from "./crypto.js";
import { addOperator, findOperator, getConsoleBot, putConsoleBot } from "./db/queries.js";
import { ensureSchema } from "./db/migrate.js";
import {
  consoleKey,
  CONSOLE_KEY_MIN_LENGTH,
  hasTelegramConsole,
  missingConfiguration,
  ownerTelegramId,
  WEB_OWNER_ID,
  type Env,
} from "./env.js";
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
  /**
   * The console key this deployment issued to itself, while it is still worth
   * printing.
   *
   * Present only when the deployment made the key AND nobody has signed in yet.
   * A key the owner configured themselves is never echoed back: they already
   * know it, and this page is public. See console-key.ts.
   */
  readonly issuedKey?: string;
  /**
   * A CONSOLE_KEY that is set and too short to be one.
   *
   * Only reachable on a deployment Telegram is already carrying, where it is a
   * thing to fix rather than a thing that stops anything. Said out loud all the
   * same: a key that is set and ignored is the worst of both, because the owner
   * believes they have a second way in and they have not.
   */
  readonly shortKey?: boolean;
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
  // A CONSOLE_KEY that is set and shorter than the minimum is not a key: this
  // Worker's address is public and the key is the only lock on it, so length is
  // the whole of the rule. Sixteen characters is far past what anybody can
  // guess, which is also why there is no attempt limit — a limit would defend
  // against an attack that cannot be mounted while adding a number for the
  // owner to wonder about.
  //
  // It stops nothing. The deployment has its own key and works either way, so
  // refusing to finish over an optional setting would take a working console
  // down to punish somebody for trying something. It is said out loud on the
  // page instead, because a key that is set and ignored is the worst of both:
  // the owner believes they chose their key and they did not.
  const configured = consoleKey(env);
  const shortKey = (env.CONSOLE_KEY?.trim() ?? "").length > 0 && configured === null;

  const missing = missingConfiguration(env);
  if (missing.length > 0) {
    return notReady("Add the missing settings as Worker secrets, then reload this page.", missing);
  }

  // Only a complete Telegram pair gets the Telegram half of setup. Half of it
  // registers a webhook for a bot the deployment cannot name an owner for.
  const telegram = hasTelegramConsole(env);
  const owner = telegram ? ownerTelegramId(env) : null;
  if (telegram && owner === null) {
    return notReady(
      "OWNER_TELEGRAM_ID must be the numeric Telegram account id, digits only.",
      ["OWNER_TELEGRAM_ID"],
    );
  }

  // Reported rather than fatal: a surprising dimension count costs accuracy,
  // not correctness, and refusing to set up over it strands the deployment.
  const indexNote = await inspectIndex(env);

  const schemaVersion = await ensureSchema(env);
  // Resolved whether or not a bot is connected. It seals every token this
  // deployment will ever hold, and its existence is what /health reads as the
  // answer to whether setup has run.
  const masterKey = await resolveMasterKey(env);

  let username: string | null = null;
  let reregistered = false;

  // Past the check above, an owner id is the proof that the Telegram pair is
  // both complete and well formed, so it is the thing this half hangs on.
  if (owner !== null) {
    // The bot token is validated before anything is written, so a typo does not
    // leave a half configured deployment behind.
    //
    // A rejected token is a setting to correct, not a crash: it used to throw
    // past this and the first screen of a new deployment read "Setup could not
    // finish: Telegram getMe failed", which names an API method to somebody who
    // has just pasted the wrong one of two tokens. Telegram says what is wrong
    // with it — Unauthorized, Not Found — and that sentence is what the page
    // carried nowhere.
    const token = env.ADMIN_BOT_TOKEN as string;
    const client = new TelegramClient(token);
    let me;
    try {
      me = await client.getMe();
    } catch (error) {
      const said =
        error instanceof MuxelError && typeof error.details?.description === "string"
          ? error.details.description
          : "";
      return notReady(
        `Telegram did not accept the console bot token${said === "" ? "" : `: ${said}`}. `
        + "It is the whole token @BotFather gave you for your console bot, digits and colon "
        + "included, and not the bot your customers write to. Correct ADMIN_BOT_TOKEN in this "
        + "Worker's settings and reload this page.",
        ["ADMIN_BOT_TOKEN"],
      );
    }
    username = me.username ?? "unknown";

    await addOperator(env, { telegramUserId: owner, role: "owner" });

    reregistered = (await getConsoleBot(env)) !== null;

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
  }

  // Every deployment can be signed into from a browser, so every deployment
  // gets the key for it here, and this is the only place that makes one.
  //
  // The key admits one person and the access checks downstream look them up
  // like anybody else, so the row has to exist. Without it a claimed session is
  // answered with "this console is private" by the very deployment its holder
  // set up. It is installed even where Telegram is connected: the browser door
  // is not a fallback for people without Telegram, it is the ordinary way in.
  const key = await ensureConsoleKey(env);
  await addOperator(env, { telegramUserId: WEB_OWNER_ID, role: "owner" });

  await env.STATE.put(ORIGIN_KEY, origin);

  // Checked on every visit rather than remembered, so the warning disappears
  // by itself the moment the operator acts on it.
  const repoVisibility = await repositoryVisibility(SOURCE_REPO);

  return {
    ok: true,
    schemaVersion,
    botUsername: username,
    owner,
    // Shown only until somebody signs in, and only if this deployment chose it.
    issuedKey: configured === null && !(await consoleClaimed(env)) ? key : undefined,
    shortKey,
    missing: [],
    repo: SOURCE_REPO,
    repoVisibility,
    note: [
      reregistered ? "Webhook re-registered against the current address." : "Setup complete.",
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

  if (missingConfiguration(env).length > 0) {
    return "skipped";
  }

  if (!hasTelegramConsole(env)) {
    // A console key registers nothing with anybody, so there is no webhook out
    // there to drop and nothing here to keep alive. The one thing a schedule
    // can still owe such a deployment is the first run itself, and the record
    // that says whether it happened is the owner row: without it a claimed
    // session is met with "this console is private".
    if ((await findOperator(env, WEB_OWNER_ID)) !== null) {
      return "healthy";
    }
    await runSetup(env, origin);
    return "completed";
  }

  if ((await getConsoleBot(env)) === null) {
    // Deployed but never set up. Everything runSetup needs is configuration,
    // and the address is now known, so it can be run from here.
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

/**
 * Hands the owner the key their deployment made for them.
 *
 * What stopped people here was never typing a secret into a box, it was being
 * asked to invent one before anything existed — and Cloudflare's deploy form
 * would not let them past it. So the deployment makes its own and this is where
 * it says what it is.
 *
 * Shown until somebody signs in for the first time, because until then nobody
 * owns this deployment and its owner has no other way to learn the key. After
 * that first sign in this card is gone for good.
 */
function renderKeyCard(outcome: SetupOutcome): string {
  const key = outcome.issuedKey ?? "";
  if (key === "") {
    return "";
  }
  return `
      <div class="card">
        <p><strong>Your console key</strong></p>
        <p class="key"><code>${escapeHtml(key)}</code></p>
        <p>Open <strong>app.muxel.site</strong>, paste the address of this page,
        and paste that key. Nothing else is needed and nothing else was asked of
        you: your deployment made this key itself.</p>
        <p>Keep it where you keep passwords. It is shown here until the first
        time you sign in, and then this page stops showing it, because this page
        is public and by then the console has an owner.</p>
      </div>`;
}

/** Renders the outcome as a page a non technical owner can act on. */
export function renderSetupPage(outcome: SetupOutcome): string {
  const bot = escapeHtml(outcome.botUsername ?? "");
  // Two doors, either of which is a finished deployment, so the page reports
  // which ones are open rather than describing the one it used to insist on. A
  // console key and no bot is set up, not half built, and a page that read
  // otherwise would send its owner looking for a bot nobody asked them for.
  const telegram = bot !== "";
  const body = outcome.ok
    ? `
      <p class="ok">Your console is connected.</p>
      <dl>
        <dt>Console key</dt><dd>${outcome.issuedKey !== undefined ? "issued, below" : "set"}</dd>
        ${
          telegram
            ? `<dt>Console bot</dt><dd>@${bot}</dd>
        <dt>Owner</dt><dd>Telegram id ${outcome.owner}</dd>`
            : `<dt>Console bot</dt><dd>none</dd>`
        }
      </dl>
      ${renderKeyCard(outcome)}
      ${
        outcome.issuedKey === undefined
          ? `<p>Open <strong>app.muxel.site</strong>, paste the address of this page, and
      enter your console key. That is your private control panel: add a business
      there and it will ask for the bot your customers will write to.</p>`
          : ""
      }
      ${
        outcome.shortKey === true
          ? `<p class="warn">The <code>CONSOLE_KEY</code> you set is shorter than
      ${CONSOLE_KEY_MIN_LENGTH} characters, so it is not being used and will not sign you in.
      Nothing is broken — the key above is the one that works. Set a longer
      <code>CONSOLE_KEY</code> if you would rather choose your own.</p>`
          : ""
      }
      ${
        telegram
          ? `<p>Open <strong>@${bot}</strong> in Telegram and send
      <code>/start</code>. This bot is a second way into the same console.</p>`
          : `<p>Telegram is optional and this deployment has none. If you would like a
      console you can carry in Telegram as well, add <code>ADMIN_BOT_TOKEN</code> and
      <code>OWNER_TELEGRAM_ID</code> and reload this page. Nothing set up now is lost
      by adding it later.</p>`
      }
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
  .key code { font-size: 1.15em; user-select: all; padding: 0.35em 0.5em; }
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
