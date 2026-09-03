#!/bin/bash
# Copies the console from this repository onto the host that serves it.
#
# The repository is the source of truth and this is the only direction, so the
# two copies cannot drift into disagreeing with each other.
set -euo pipefail
TARGET="${1:-/opt/muxel-console}"
HERE="$(cd "$(dirname "$0")" && pwd)"

ROOT="$(cd "$HERE/../.." && pwd)"

mkdir -p "$TARGET/public/assets" "$TARGET/public/docs/media" "$TARGET/guide"
cp "$HERE/server.mjs" "$HERE/guide.mjs" "$HERE/package.json" "$TARGET/"
cp "$HERE/public/"*.html "$HERE/public/"*.css "$HERE/public/"*.js "$HERE/public/"*.json "$TARGET/public/"
cp "$HERE/public/assets/"* "$TARGET/public/assets/"
# The guide is the README, so the README travels with the console: all five
# languages, the two documents it links to, and the images all of them show.
cp "$ROOT"/README.md "$ROOT"/README.*.md "$TARGET/guide/"
cp "$ROOT/docs/DEPLOY-RECOVERY.md" "$ROOT/docs/TELEGRAM-SETUP.md" "$TARGET/guide/"
cp "$ROOT/docs/media/"* "$TARGET/public/docs/media/"

cd "$TARGET"
npm install --omit=dev --silent
pm2 restart muxel-console >/dev/null 2>&1 || PORT=4400 pm2 start server.mjs --name muxel-console --cwd "$TARGET"
sleep 2
curl -fsS "http://127.0.0.1:${PORT:-4400}/healthz" && echo
