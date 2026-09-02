#!/bin/bash
# Copies the console from this repository onto the host that serves it.
#
# The repository is the source of truth and this is the only direction, so the
# two copies cannot drift into disagreeing with each other.
set -euo pipefail
TARGET="${1:-/opt/muxel-console}"
HERE="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$TARGET/public/assets"
cp "$HERE/server.mjs" "$HERE/package.json" "$TARGET/"
cp "$HERE/public/"*.html "$HERE/public/"*.css "$HERE/public/"*.js "$HERE/public/"*.json "$TARGET/public/"
cp "$HERE/public/assets/"* "$TARGET/public/assets/"

cd "$TARGET"
npm install --omit=dev --silent
pm2 restart muxel-console >/dev/null 2>&1 || PORT=4400 pm2 start server.mjs --name muxel-console --cwd "$TARGET"
sleep 2
curl -fsS "http://127.0.0.1:${PORT:-4400}/healthz" && echo
