#!/bin/sh
# Assemble what gets published to the Space: Stacker's Vite build plus the Zero capsule
# (rooms, docs/11). Usage: tools/stage-site.sh <out dir>   (build app/dist first)
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:?usage: tools/stage-site.sh <out dir>}
[ -f "$ROOT/app/dist/index.html" ] || { echo "app/dist is missing: npm run build in app/ first" >&2; exit 1; }
rm -rf "$OUT" && mkdir -p "$OUT"
cp -R "$ROOT/app/dist/." "$OUT/"
find "$OUT" -name AGENTS.md -delete
cp -R "$ROOT/capsule/server" "$ROOT/capsule/client" "$ROOT/capsule/sf.jsonc" "$ROOT/capsule/package.json" "$OUT/"
[ -d "$ROOT/capsule/pages" ] && [ -n "$(ls "$ROOT/capsule/pages")" ] && cp -R "$ROOT/capsule/pages" "$OUT/"
echo "$OUT"
