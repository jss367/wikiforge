#!/bin/bash
# Apply wikiforge/quartz-overlay/ onto the Quartz install, idempotently.
#
# Called automatically by wiki-serve.sh before each serve. Safe to re-run;
# a drift-free invocation finishes in tens of milliseconds.
#
# Env vars:
#   QUARTZ — path to the Quartz install (default: ~/Documents/wiki-quartz)

set -e

QUARTZ="${QUARTZ:-$HOME/Documents/wiki-quartz}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OVERLAY="$REPO_ROOT/quartz-overlay"
OVERLAY_MARKER="$QUARTZ/.wikiforge-overlay-hash"
DEPS_MARKER="$QUARTZ/.wikiforge-deps-hash"

if [ ! -d "$QUARTZ" ]; then
  echo "[wikiforge] Quartz not found at $QUARTZ — run scripts/install.sh first."
  exit 1
fi

if [ ! -d "$OVERLAY" ]; then
  echo "[wikiforge] overlay directory missing at $OVERLAY"
  exit 1
fi

# Deterministic content hash of the overlay tree. Null-delimited so filenames
# with spaces don't break sort/xargs.
overlay_hash() {
  (cd "$OVERLAY" && find . -type f -print0 | sort -z | xargs -0 shasum) | shasum | awk '{print $1}'
}

current_hash=$(overlay_hash)
stored_hash=$(cat "$OVERLAY_MARKER" 2>/dev/null || echo "")

if [ "$current_hash" = "$stored_hash" ]; then
  echo "[wikiforge] overlay up to date"
else
  echo "[wikiforge] overlay drift — syncing into $QUARTZ/"
  cp -R "$OVERLAY/"* "$QUARTZ/"
  echo "$current_hash" > "$OVERLAY_MARKER"
fi

# Refresh Quartz dependencies when they drift. Hash the *effective* package
# files after the overlay is applied, so this single gate catches:
#   - Upstream Quartz updates that change package.json / package-lock.json
#     (what `git pull` in $QUARTZ brings in)
#   - Overlay-provided package.json, whenever the overlay starts shipping one
#   - Missing node_modules (fresh clone, or someone cleaned it)
deps_hash() {
  shasum "$QUARTZ/package.json" "$QUARTZ/package-lock.json" 2>/dev/null | shasum | awk '{print $1}'
}

current_deps_hash=$(deps_hash)
stored_deps_hash=$(cat "$DEPS_MARKER" 2>/dev/null || echo "")

if [ ! -d "$QUARTZ/node_modules" ] || [ "$current_deps_hash" != "$stored_deps_hash" ]; then
  echo "[wikiforge] Quartz deps out of date — running npm install"
  (cd "$QUARTZ" && npm install)
  echo "$current_deps_hash" > "$DEPS_MARKER"
fi
