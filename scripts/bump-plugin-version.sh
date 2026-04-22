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
#   - Branch already bumped vs origin/main (prevents a 10-commit PR from
#     bumping the version 10 times; the first plugin-touching commit bumps,
#     the rest ride along).
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

# Has the version already changed on this branch (committed or staged) vs
# origin/main? If so, the first bumping commit already landed; skip.
if git diff --cached origin/main -- "$MANIFEST" 2>/dev/null | grep -qE '^\+.*"version"'; then
  exit 0
fi

# Parse current version. Tolerates different whitespace around the colon.
CURRENT=$(grep -oE '"version"[[:space:]]*:[[:space:]]*"[0-9]+\.[0-9]+\.[0-9]+"' "$MANIFEST" | sed -E 's/.*"([0-9]+\.[0-9]+\.[0-9]+)"$/\1/')
if [ -z "$CURRENT" ]; then
  echo "[wikiforge] ERROR: could not parse version from $MANIFEST" >&2
  exit 1
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
