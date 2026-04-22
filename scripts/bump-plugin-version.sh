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

# Parse the version from the INDEX (the state that will actually be
# committed), not the working tree. A developer may stage an unrelated
# plugin/ change while leaving an unstaged manual version edit in
# plugin.json; reading the working tree would misread that unstaged edit
# as "branch already bumped" and skip, letting the commit land with the
# index's (unchanged) version. Sourcing from the index ties the check to
# what's actually about to be committed.
BASE_VERSION=$(git show "$BASE:$MANIFEST" 2>/dev/null | parse_version || true)
INDEX_BLOB=$(git show ":0:$MANIFEST" 2>/dev/null || true)
if [ -z "$INDEX_BLOB" ]; then
  # plugin.json not in the index — something's wrong. Bail rather than
  # fabricate one.
  exit 0
fi
INDEX_VERSION=$(echo "$INDEX_BLOB" | parse_version || true)
if [ -z "$INDEX_VERSION" ]; then
  echo "[wikiforge] ERROR: could not parse version from staged $MANIFEST" >&2
  exit 1
fi

# Skip when the index's version already differs from merge-base — the
# branch already bumped (in a prior commit or an explicit staged edit).
# Compare values, not diff-line text, so a format-only rewrite with the
# same version value still bumps normally.
if [ -n "$BASE_VERSION" ] && [ "$BASE_VERSION" != "$INDEX_VERSION" ]; then
  exit 0
fi

IFS='.' read -r MAJOR MINOR PATCH <<< "$INDEX_VERSION"
NEW="$MAJOR.$MINOR.$((PATCH + 1))"

# Bump the INDEX directly so the committed blob has the new version
# regardless of any unstaged working-tree state. Write a new blob, then
# point the index entry at it.
NEW_BLOB_HASH=$(echo "$INDEX_BLOB" \
  | sed -E "s/\"version\"[[:space:]]*:[[:space:]]*\"$INDEX_VERSION\"/\"version\": \"$NEW\"/" \
  | git hash-object -w --stdin)
git update-index --cacheinfo 100644,"$NEW_BLOB_HASH","$MANIFEST"

# Also bump the working tree, but only when it matches the old index
# version — i.e. the developer had no unstaged plugin.json edit. If they
# did, leave their working copy alone; the index bump already ensures
# the commit is correct, and clobbering their unstaged edit would be
# surprising.
WT_VERSION=$(parse_version < "$MANIFEST" 2>/dev/null || true)
if [ "$WT_VERSION" = "$INDEX_VERSION" ]; then
  if [[ "$OSTYPE" == darwin* ]]; then
    sed -i '' -E "s/\"version\"[[:space:]]*:[[:space:]]*\"$INDEX_VERSION\"/\"version\": \"$NEW\"/" "$MANIFEST"
  else
    sed -i -E "s/\"version\"[[:space:]]*:[[:space:]]*\"$INDEX_VERSION\"/\"version\": \"$NEW\"/" "$MANIFEST"
  fi
fi

echo "[wikiforge] bumped plugin version: $INDEX_VERSION → $NEW" >&2
