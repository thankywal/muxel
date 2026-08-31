#!/bin/bash
# The one sync a deployment made before self update existed still needs.
#
# The one click deploy imports this project into the owner's own GitHub account
# at the moment they press it. A deployment imported before the update button
# was written has no update button, so it cannot fetch the button. That is a
# bootstrap, not a bug, and it happens exactly once per deployment.
#
# This does by hand what the button does by itself, under the same two rules:
#
#   - Never touch what belongs to the deployment. .github/ because the
#     Cloudflare GitHub App cannot write workflow files, and wrangler.jsonc
#     because it names the owner's Worker and the D1 database holding every
#     conversation. Upstream's copy has placeholders in those slots; copying it
#     over theirs would point a live deployment at a database that does not
#     exist. The list is kept in packages/runtime/src/web/deployment-files.ts.
#   - Never adopt upstream's history. Only file contents are copied, so every
#     object is created in the owner's own repository and no force is needed.
#
# Usage:  scripts/first-sync.sh <owner/repo> [--dry-run]
#         scripts/first-sync.sh thankywal/muxel-demo --dry-run
set -euo pipefail

TARGET="${1:?usage: first-sync.sh <owner/repo> [--dry-run]}"
DRY="${2:-}"
UPSTREAM="https://github.com/thankywal/muxel.git"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "Reading $TARGET"
git clone --quiet --depth 1 "https://github.com/${TARGET}.git" "$work/target"
echo "Reading upstream"
git clone --quiet --depth 1 "$UPSTREAM" "$work/upstream"

upstream_sha="$(cd "$work/upstream" && git rev-parse --short HEAD)"

rsync -a --delete \
  --exclude '.git/' --exclude '.github/' --exclude 'wrangler.jsonc' \
  "$work/upstream/" "$work/target/"

cd "$work/target"
if [ -z "$(git status --porcelain)" ]; then
  echo "Already up to date. Nothing to push."
  exit 0
fi

echo
git status --short | sed 's/^/  /'
echo
changed="$(git status --porcelain | wc -l | tr -d ' ')"
echo "$changed files differ from upstream $upstream_sha"

if [ "$DRY" = "--dry-run" ]; then
  echo "Dry run. Nothing was pushed."
  exit 0
fi

git add -A
git commit --quiet -m "Update from upstream ${upstream_sha}

Copied from thankywal/muxel. File contents only: no upstream history is
adopted and .github/ is left alone."
git push --quiet origin HEAD:main
echo "Pushed. Cloudflare builds and deploys it from $TARGET in a couple of minutes."
