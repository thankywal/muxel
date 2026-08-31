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
import { SOURCE_REPO } from "../repo.js";
import { UPSTREAM_REPO } from "../version.js";
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
    throw new Error(`GitHub said ${response.status}: ${body.slice(0, 200)}`);
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
      read(UPSTREAM_REPO, upstreamSha),
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

export async function runSelfUpdate(env: Env): Promise<UpdateOutcome> {
  const token = await getSecret(env, "github_token");
  if (token === null) {
    return { ok: false, message: "No GitHub token is set for this deployment yet." };
  }

  const target = SOURCE_REPO;
  if (target === null) {
    return { ok: false, message: "This deployment does not know which repository it came from." };
  }

  try {
    const upstreamHead = await gh<{ commit: { sha: string } }>(
      token,
      `/repos/${UPSTREAM_REPO}/branches/main`,
    );
    const upstreamTree = await gh<{ tree: TreeEntry[] }>(
      token,
      `/repos/${UPSTREAM_REPO}/git/trees/${upstreamHead.commit.sha}?recursive=1`,
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

    // Blob shas are content addressed and both repositories live on the same
    // host, so the objects are already there and only the tree has to be made.
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
      return { ok: true, changed: 0, message: "Already up to date. Nothing was pushed." };
    }

    const commit = await gh<{ sha: string }>(token, `/repos/${target}/git/commits`, {
      method: "POST",
      body: JSON.stringify({
        message: `Update from ${UPSTREAM_REPO}\n\nApplied from the console. Workflow files were left untouched.`,
        tree: created.sha,
        parents: [mine.commit.sha],
      }),
    });

    await gh(token, `/repos/${target}/git/refs/heads/main`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });

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
