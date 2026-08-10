#!/usr/bin/env bash
#
# Brings a deployed copy of Muxel up to date with upstream.
#
# Runs inside the operator's own GitHub Actions, invoked by the stub workflow
# in .github/workflows/update.yml. The stub stays a stub on purpose: the
# Cloudflare GitHub App cannot create workflow files when it makes the copy,
# so the stub is pasted by a person exactly once and can never be updated by
# this mechanism. Everything that might need to change lives here instead,
# and this file arrives with every sync like any other code.
#
# The stub copies this script out of the tree before running it, because the
# sync below replaces the tree it is reading from.
#
# Two rules the sync must never break, both learned the hard way:
#
#  - Never touch .github/. A push from the default GITHUB_TOKEN that creates
#    or updates a workflow file is rejected by GitHub itself ("refusing to
#    allow a GitHub App to create or update workflow ... without `workflows`
#    permission"), verified against a live repository. Excluding the whole
#    directory keeps the push acceptable and keeps the operator's stub theirs.
#
#  - Never adopt upstream's history. This repository's history is unrelated
#    to upstream's, and resetting onto a shallow fetch leaves the branch at a
#    graft point the remote will refuse. Only the tree is taken, so every
#    pushed object is created locally and no force is ever needed.

set -euo pipefail

UPSTREAM_REPO="${UPSTREAM_REPO:-thankywal/muxel}"

if [ "${GITHUB_REPOSITORY:-}" = "$UPSTREAM_REPO" ]; then
  echo "This is upstream. Nothing to pull."
  exit 0
fi

# Only adopt a commit whose own checks passed, and pin everything after to the
# sha that was checked. Checking a moving ref and then fetching it again would
# let a commit that arrived in between slip through unexamined. A commit with
# no check runs yet reads as not ready rather than as passing.
sha=""
if command -v gh >/dev/null 2>&1 && [ -n "${GH_TOKEN:-}" ]; then
  sha=$(gh api "repos/${UPSTREAM_REPO}/commits/main" --jq '.sha')
  state=$(gh api "repos/${UPSTREAM_REPO}/commits/${sha}/check-runs" --jq \
    '[.check_runs[].conclusion]
     | if length == 0 then "pending"
       elif all(. == "success" or . == "skipped" or . == "neutral") then "success"
       else "failed" end')
  echo "Upstream ${sha:0:8} checks: ${state}"
  if [ "$state" != "success" ]; then
    echo "Not applying. This runs again on the next schedule."
    exit 0
  fi
fi

git remote remove upstream 2>/dev/null || true
git remote add upstream "https://github.com/${UPSTREAM_REPO}.git"
git fetch --depth=1 upstream "${sha:-main}"

# The gate before anything destructive: if this does not look like Muxel,
# stop before a single file has been removed. A truncated or foreign tree
# committed here would deploy as an empty site everywhere at once.
for sentinel in VERSION wrangler.jsonc packages/runtime/src/index.ts; do
  if ! git ls-tree -r --name-only FETCH_HEAD | grep -qx "$sentinel"; then
    echo "Upstream tree is missing ${sentinel}. Refusing to continue." >&2
    exit 1
  fi
done

# wrangler.jsonc holds the identifiers of the resources in this account, and
# .github/ holds the operator's stub. Both are excluded from the removal and
# from the checkout, so the sync commit never contains either.
git ls-files -z -- . ':!wrangler.jsonc' ':!.github' | xargs -0 -r rm -f
git checkout FETCH_HEAD -- . ':!wrangler.jsonc' ':!.github'

git add -A
if git diff --cached --quiet; then
  echo "Already current."
  exit 0
fi

git -c user.name="muxel-update" -c user.email="muxel-update@users.noreply.github.com" \
  commit -m "Update from upstream ${sha:-main}

Applied by .github/workflows/update.yml running scripts/update.sh. The
Worker configuration in wrangler.jsonc and the .github directory are
preserved: the first holds this account's resource identifiers, the
second cannot be pushed by the workflow token at all."

git push origin HEAD
echo "Updated. Workers Builds will redeploy from this push."
