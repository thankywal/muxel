#!/bin/bash
# Copies the built site onto a host that serves it with the file server here.
#
# GitHub Pages is the site's home and builds it itself; this is for a host that
# is not Pages. Both serve what scripts/build-site.mjs writes, so there is one
# site and two places it can be put, rather than two sites.
set -euo pipefail
TARGET="${1:-/opt/muxel-console}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

# Served at the root here, so the site is built to think it lives there.
SITE_BASE=/ node "$ROOT/scripts/build-site.mjs"

mkdir -p "$TARGET"
rm -rf "$TARGET/site"
cp -r "$ROOT/site" "$TARGET/site"
cp "$HERE/server.mjs" "$HERE/package.json" "$TARGET/"

cd "$TARGET"
npm install --omit=dev --silent
pm2 restart muxel-console >/dev/null 2>&1 || PORT=4400 pm2 start server.mjs --name muxel-console --cwd "$TARGET"
sleep 2
curl -fsS "http://127.0.0.1:${PORT:-4400}/healthz" && echo
