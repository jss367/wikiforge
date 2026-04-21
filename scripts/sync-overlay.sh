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
PACKAGE_MARKER="$QUARTZ/.wikiforge-package-hash"

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

# Run npm install only when the overlay's package.json actually changed. The
# overlay doesn't currently ship a package.json, but if that ever changes this
# gate keeps cold-start overhead flat.
if [ -f "$OVERLAY/package.json" ]; then
  current_pkg_hash=$(shasum "$OVERLAY/package.json" | awk '{print $1}')
  stored_pkg_hash=$(cat "$PACKAGE_MARKER" 2>/dev/null || echo "")
  if [ "$current_pkg_hash" != "$stored_pkg_hash" ]; then
    echo "[wikiforge] package.json changed — running npm install"
    (cd "$QUARTZ" && npm install)
    echo "$current_pkg_hash" > "$PACKAGE_MARKER"
  fi
fi
