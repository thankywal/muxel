/**
 * Where this deployment's own source lives.
 *
 * The one click deploy copies this project into the operator's GitHub account
 * and creates that copy public, with no option to choose otherwise. Nothing in
 * a deployment can change that: the repository is created by Cloudflare's
 * GitHub App, the copy arrives without the `.github` directory so no workflow
 * of ours can run in it, and the Worker holds no GitHub credential and should
 * not. Flipping it to private stays a human action.
 *
 * What a deployment can do is stop the operator from having to remember. The
 * build stamps the repository it was built from into this file, so the setup
 * page can link straight at the setting, and can check whether it has already
 * been done. That check needs no token: an anonymous request for a private
 * repository is a 404.
 *
 * Empty when the build could not tell, which is the case for a local build or
 * a checkout with no origin. Callers must treat it as unknown rather than as an
 * error.
 */
export const SOURCE_REPO = "";

/**
 * Reports whether a stamp looks like an owner/name pair.
 *
 * The slug ends up inside URLs the operator is asked to click, so a stamp that
 * is not shaped like a repository must never be interpolated into one.
 */
export function isRepoSlug(slug: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(slug);
}

/** Link to the page holding the visibility setting. */
export function repositorySettingsUrl(slug: string): string {
  return `https://github.com/${slug}/settings`;
}

/** The page with the workflow permission toggle automatic updates need. */
export function workflowPermissionsUrl(slug: string): string {
  return `https://github.com/${slug}/settings/actions`;
}

/** The update workflow's page, where a run can be started by hand. */
export function updateWorkflowUrl(slug: string): string {
  return `https://github.com/${slug}/actions/workflows/update.yml`;
}

/**
 * A link that opens GitHub's new file editor with the update workflow already
 * filled in, so enabling automatic updates is one click and one commit.
 *
 * The whole nested path goes into `filename` and the URL path stays a bare
 * `/new/main`: GitHub drops the last directory segment of the URL path when a
 * filename parameter is present, so carrying the directories in the path
 * would put the file one level up from where workflows are read.
 */
export function enableUpdatesUrl(slug: string, stub: string): string {
  const filename = encodeURIComponent(".github/workflows/update.yml");
  return `https://github.com/${slug}/new/main?filename=${filename}&value=${encodeURIComponent(stub)}`;
}

export type RepoVisibility = "public" | "private" | "unknown";

/**
 * Reports whether the source copy is still readable by anyone.
 *
 * Asked without credentials on purpose. GitHub answers 404 rather than 403 for
 * a repository the caller cannot see, so absence of a public answer is the
 * signal, and no token has to exist anywhere for this to work.
 *
 * Anything other than a clean 200 or 404 is reported as unknown. A rate limit
 * or an outage must not be rendered as "your repository is private", which is
 * the reading that would stop someone acting.
 */
export async function repositoryVisibility(slug: string): Promise<RepoVisibility> {
  if (slug.length === 0) {
    return "unknown";
  }
  try {
    const response = await fetch(`https://api.github.com/repos/${slug}`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "muxel" },
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 200) {
      return "public";
    }
    return response.status === 404 ? "private" : "unknown";
  } catch {
    return "unknown";
  }
}
