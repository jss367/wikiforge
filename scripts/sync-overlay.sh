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
DEPS_MARKER="$QUARTZ/.wikiforge-deps-hash"

if [ ! -d "$QUARTZ" ]; then
  echo "[wikiforge] Quartz not found at $QUARTZ — run scripts/install.sh first."
  exit 1
fi

if [ ! -d "$OVERLAY" ]; then
  echo "[wikiforge] overlay directory missing at $OVERLAY"
  exit 1
fi

# Clean up the old hash-based overlay marker from earlier iterations of this
# script. No longer used — kept as best-effort housekeeping; safe to remove.
rm -f "$QUARTZ/.wikiforge-overlay-hash"

# Compare each overlay file against its counterpart in $QUARTZ. This is the
# right invariant to check: we want every overlay file to be currently in place
# on the Quartz install. A hash of the overlay *source* alone would miss the
# case where the user runs `git pull` inside $QUARTZ and upstream modifies a
# file we overlay — the source hash wouldn't change, but Quartz would have
# reverted to upstream content for that path.
overlay_drifted() {
  local f rel
  while IFS= read -r -d '' f; do
    rel="${f#$OVERLAY/}"
    if ! cmp -s "$f" "$QUARTZ/$rel" 2>/dev/null; then
      return 0
    fi
  done < <(find "$OVERLAY" -type f -print0)
  return 1
}

if overlay_drifted; then
  echo "[wikiforge] overlay drift — syncing into $QUARTZ/"
  cp -R "$OVERLAY/"* "$QUARTZ/"
else
  echo "[wikiforge] overlay up to date"
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
