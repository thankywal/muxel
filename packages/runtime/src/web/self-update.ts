/**
 * Updating without a workflow, and without leaving the console.
 *
 * The one click deploy copies this project into the operator's GitHub account,
 * and the copy arrives without `.github` because the Cloudflare GitHub App
 * cannot create workflow files. So the scheduled job never reaches most
 * deployments, and the only way to update was to paste a workflow in by hand
 * and turn on a repository permission, which almost nobody does.
 *
 * This does the same work the workflow did, from inside the deployment, using a
 * token the owner supplies once. A push to their repository is what Cloudflare
 * watches, so the redeploy still happens the way it always did.
 *
 * Two rules carried over from scripts/update.sh, both learned the hard way:
 *
 *  - Never touch `.github/`. A push that creates or updates a workflow file is
 *    refused unless the token carries the workflows permission, and the
 *    operator's stub is theirs to keep either way.
 *
 *  - Never adopt upstream's history. Only file contents are copied, so every
 *    object is created in the operator's own repository and no force is needed.
 */

import type { Env } from "../env.js";
import { isRepoSlug, SOURCE_REPO } from "../repo.js";
import { UPSTREAM_SLUG } from "../version.js";
import { getSecret } from "./secrets-vault.js";
import { belongsToDeployment, configDrift } from "./deployment-files.js";

const API = "https://api.github.com";
const UA = { "user-agent": "muxel-self-update", accept: "application/vnd.github+json" };

export interface UpdateOutcome {
  readonly ok: boolean;
  /** Plain enough to show an owner without translating an API error. */
  readonly message: string;
  readonly changed?: number;
  /**
   * Something upstream changed that this deployment's own files hold back.
   * Empty on almost every update; never silent when it is not.
   */
  readonly notes?: readonly string[];
}

interface TreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
}

async function gh<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...UA, authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const body = await response.text();
    // The path is in the message on purpose. A bare "GitHub said 404" is true
    // and useless: the update touches two repositories and eight endpoints, and
    // which one was not found is the whole diagnosis.
    throw new Error(`GitHub said ${response.status} for ${path}: ${body.slice(0, 160)}`);
  }
  return (await response.json()) as T;
}

/**
 * Copies upstream's tree into the operator's repository as one commit.
 *
 * The tree is taken wholesale rather than diffed. A diff would need upstream's
 * history, which this repository does not share, and the result is the same:
 * the commit that lands contains exactly the files upstream publishes.
 */
/**
 * Whether the owner has to touch their own wrangler.jsonc after this update.
 *
 * Their copy is kept because it names their Worker and their database. That is
 * correct and it also means a binding or a compatibility date upstream added
 * does not arrive. A failure to check is not treated as drift: a warning
 * nobody can act on is worse than none.
 */
async function configNotes(token: string, target: string, upstreamSha: string): Promise<string[]> {
  try {
    const read = async (repo: string, ref: string): Promise<string> => {
      const file = await gh<{ content: string }>(token, `/repos/${repo}/contents/wrangler.jsonc?ref=${ref}`);
      return atob(file.content.replace(/\n/g, ""));
    };
    const [upstream, own] = await Promise.all([
      read(UPSTREAM_SLUG, upstreamSha),
      read(target, "main"),
    ]);
    return configDrift(upstream, own)
      ? [
          "Your wrangler.jsonc was kept, because it names your Worker and your database. " +
            "Upstream's copy has changed in some other way, so compare the two and copy across " +
            "anything new. Nothing was overwritten.",
        ]
      : [];
  } catch {
    return [];
  }
}

/**
 * How many new files one press copies.
 *
 * Each is two requests, a read from upstream and a write here, and a Worker on
 * the free plan is allowed fifty subrequests per invocation. Eighteen leaves
 * room for the eight the update needs around them, with a margin, so a large
 * update takes several presses instead of dying at the limit halfway through.
 */
const MAX_BLOBS_PER_RUN = 18;

/** Blobs already written here, which no tree points at yet. */
const COPIED_KEY = "system:update_copied";

async function copiedAlready(env: Env): Promise<string[]> {
  const raw = await env.STATE.get(COPIED_KEY);
  if (raw === null) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((sha): sha is string => typeof sha === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Notes what has been copied so the next press does not copy it again.
 *
 * A blob with nothing pointing at it is not in the repository's tree, so
 * looking would say it is missing. Forgotten once the commit lands, because
 * from then on the tree is where it is found.
 */
async function rememberCopied(env: Env, shas: readonly string[]): Promise<void> {
  if (shas.length === 0) return;
  const merged = [...new Set([...(await copiedAlready(env)), ...shas])];
  await env.STATE.put(COPIED_KEY, JSON.stringify(merged.slice(-2000)));
}

async function forgetCopied(env: Env): Promise<void> {
  await env.STATE.delete(COPIED_KEY);
}

/** Where an operator's answer is kept when the build could not tell. */
export const SOURCE_REPO_KEY = "system:source_repo";

/**
 * Which repository this deployment pushes to.
 *
 * The build stamps it, and a build with no git origin cannot. Rather than leave
 * the update permanently broken in that case, an operator can say, and what
 * they said wins: they can see the address bar and the build cannot.
 */
export async function sourceRepoFor(env: Env): Promise<string> {
  const told = (await env.STATE.get(SOURCE_REPO_KEY))?.trim();
  if (told !== undefined && isRepoSlug(told)) return told;
  return SOURCE_REPO;
}

export async function runSelfUpdate(env: Env): Promise<UpdateOutcome> {
  const token = await getSecret(env, "github_token");
  if (token === null) {
    return { ok: false, message: "No GitHub token is set for this deployment yet." };
  }

  // SOURCE_REPO is the empty string when the build could not tell, never null,
  // so the old `=== null` check passed and the update asked GitHub for
  // `/repos//branches/main`. Checked for the shape it has to have instead.
  const target = await sourceRepoFor(env);
  if (!isRepoSlug(target)) {
    return {
      ok: false,
      message:
        "This deployment does not know which repository it was built from, so it has nowhere to push. "
        + "Set it under Settings, Deployment.",
    };
  }

  try {
    const upstreamHead = await gh<{ commit: { sha: string } }>(
      token,
      `/repos/${UPSTREAM_SLUG}/branches/main`,
    );
    const upstreamTree = await gh<{ tree: TreeEntry[] }>(
      token,
      `/repos/${UPSTREAM_SLUG}/git/trees/${upstreamHead.commit.sha}?recursive=1`,
    );

    // Everything except what belongs to this deployment rather than to
    // upstream. src/web/deployment-files.ts is the one record of that.
    const files = upstreamTree.tree.filter(
      (entry) => entry.type === "blob" && !belongsToDeployment(entry.path),
    );
    if (files.length === 0) {
      return { ok: false, message: "Upstream returned no files, so nothing was changed." };
    }

    const mine = await gh<{ commit: { sha: string } }>(token, `/repos/${target}/branches/main`);
    const baseTree = await gh<{ tree: TreeEntry[] }>(
      token,
      `/repos/${target}/git/trees/${mine.commit.sha}?recursive=1`,
    );
    const keep = baseTree.tree.filter(
      (entry) => entry.type === "blob" && belongsToDeployment(entry.path),
    );

    // A blob sha is content addressed, so a file whose content has not changed
    // is already an object this repository holds, from its own history. Only
    // genuinely new content has to be copied across.
    //
    // The old code copied none of it, on the belief that two repositories on
    // one host share their objects. Forks do; this is not a fork, because the
    // deploy button imports rather than forks. So GitHub was handed a tree
    // referring to blobs the repository had never seen, and answered 422.
    const held = new Set(baseTree.tree.filter((e) => e.type === "blob").map((e) => e.sha));
    for (const sha of await copiedAlready(env)) held.add(sha);
    const missing = files.filter((entry) => !held.has(entry.sha));

    // Every copy is two requests, and a Worker on the free plan gets fifty per
    // invocation. So a large update is done across several presses rather than
    // failing at the limit, and what has been copied is remembered, because a
    // blob no tree points at yet is not in the repository's tree to be found.
    const budget = Math.min(missing.length, MAX_BLOBS_PER_RUN);
    if (budget > 0) {
      const copied: string[] = [];
      for (const entry of missing.slice(0, budget)) {
        const blob = await gh<{ content: string; encoding: string }>(
          token,
          `/repos/${UPSTREAM_SLUG}/git/blobs/${entry.sha}`,
        );
        const made = await gh<{ sha: string }>(token, `/repos/${target}/git/blobs`, {
          method: "POST",
          body: JSON.stringify({ content: blob.content, encoding: blob.encoding }),
        });
        copied.push(made.sha);
      }
      await rememberCopied(env, copied);

      const left = missing.length - budget;
      if (left > 0) {
        return {
          ok: true,
          changed: 0,
          message:
            `Copied ${budget} of ${missing.length} changed files. Press Update again to continue; `
            + "nothing is pushed until all of them are across.",
        };
      }
    }

    const created = await gh<{ sha: string }>(token, `/repos/${target}/git/trees`, {
      method: "POST",
      body: JSON.stringify({
        tree: [...files, ...keep].map((entry) => ({
          path: entry.path,
          mode: entry.mode,
          type: "blob",
          sha: entry.sha,
        })),
      }),
    });

    // An identical tree means upstream has nothing this deployment lacks.
    // Committing anyway would push an empty change and trigger a pointless
    // rebuild, so the console says so instead.
    const currentCommit = await gh<{ tree: { sha: string } }>(
      token,
      `/repos/${target}/git/commits/${mine.commit.sha}`,
    );
    if (currentCommit.tree.sha === created.sha) {
      await forgetCopied(env);
      return { ok: true, changed: 0, message: "Already up to date. Nothing was pushed." };
    }

    const commit = await gh<{ sha: string }>(token, `/repos/${target}/git/commits`, {
      method: "POST",
      body: JSON.stringify({
        message: `Update from ${UPSTREAM_SLUG}\n\nApplied from the console. Workflow files were left untouched.`,
        tree: created.sha,
        parents: [mine.commit.sha],
      }),
    });

    await gh(token, `/repos/${target}/git/refs/heads/main`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });

    // The copies are in the tree now, so the note of them has done its job.
    await forgetCopied(env);
    return {
      ok: true,
      changed: files.length,
      message: "Pushed. Cloudflare builds the new version from your repository now.",
      notes: await configNotes(token, target, upstreamHead.commit.sha),
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
