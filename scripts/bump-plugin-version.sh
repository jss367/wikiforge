#!/bin/bash
# Pre-commit hook: auto-bump plugin/.claude-plugin/plugin.json patch version
# when a commit touches plugin/ content.
#
# Why this exists: Claude Code's plugin cache is keyed on plugin.json version.
# Without a bump, `claude plugin update` is a no-op and users never see new
# content until they uninstall/reinstall. This hook makes the bump automatic
# so authors don't have to remember.
#
# Skip conditions (all exit 0, no bump):
#   - No staged files under plugin/ (nothing to do).
#   - Version value already differs from merge-base with origin/main
#     (prevents a 10-commit PR from bumping the version 10 times; the
#     first plugin-touching commit bumps, the rest ride along). Compares
#     parsed values, not diff-line text, so a format-only rewrite of
#     plugin.json can't masquerade as an already-bumped version.
#   - origin/main unknown (fresh repo, detached HEAD, etc) — don't block.
#
# Fail conditions (exit 1, commit aborted):
#   - plugin.json exists but version field is missing or malformed.

set -e

MANIFEST="plugin/.claude-plugin/plugin.json"

# Only run if any plugin/ files are staged.
if ! git diff --cached --name-only | grep -q '^plugin/'; then
  exit 0
fi

# Only run if plugin.json exists. (Defensive — should always exist.)
if [ ! -f "$MANIFEST" ]; then
  exit 0
fi

# If origin/main isn't available, bail quietly. Can happen on fresh clones
# pre-fetch, or if the user renamed their main branch.
if ! git rev-parse --verify origin/main >/dev/null 2>&1; then
  exit 0
fi

# Use the merge-base, not origin/main's tip, as the "what did this branch
# change" baseline. A stale branch (cut at 2.1.0 while main later moved
# to 2.1.1) otherwise looks like it has a "+version" line in its diff
# vs origin/main tip even though this branch never touched the manifest.
BASE=$(git merge-base HEAD origin/main 2>/dev/null || true)
if [ -z "$BASE" ]; then
  exit 0
fi

parse_version() {
  # Read a version string from stdin (plugin.json content).
  grep -oE '"version"[[:space:]]*:[[:space:]]*"[0-9]+\.[0-9]+\.[0-9]+"' \
    | head -1 \
    | sed -E 's/.*"([0-9]+\.[0-9]+\.[0-9]+)"$/\1/'
}

BASE_VERSION=$(git show "$BASE:$MANIFEST" 2>/dev/null | parse_version || true)
CURRENT=$(parse_version < "$MANIFEST" || true)
if [ -z "$CURRENT" ]; then
  echo "[wikiforge] ERROR: could not parse version from $MANIFEST" >&2
  exit 1
fi

# Compare actual version values, not diff-line presence. A formatter that
# rewrites plugin.json without changing the version number produces a
# "+version: X" line in the raw diff even though X is unchanged — the
# previous line-based skip check misread that as "already bumped" and
# silently let plugin-touching commits through without a real bump.
if [ -n "$BASE_VERSION" ] && [ "$BASE_VERSION" != "$CURRENT" ]; then
  exit 0
fi

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
NEW="$MAJOR.$MINOR.$((PATCH + 1))"

# Portable in-place sed (macOS vs GNU).
if [[ "$OSTYPE" == darwin* ]]; then
  sed -i '' -E "s/\"version\"[[:space:]]*:[[:space:]]*\"$CURRENT\"/\"version\": \"$NEW\"/" "$MANIFEST"
else
  sed -i -E "s/\"version\"[[:space:]]*:[[:space:]]*\"$CURRENT\"/\"version\": \"$NEW\"/" "$MANIFEST"
fi

git add "$MANIFEST"
echo "[wikiforge] bumped plugin version: $CURRENT → $NEW" >&2
