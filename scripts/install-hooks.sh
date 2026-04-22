#!/bin/bash
# Install wikiforge git hooks.
#
# Symlinks scripts/bump-plugin-version.sh into the git common hooks dir
# (shared across worktrees) as pre-commit. Idempotent — safe to re-run.
#
# Called by install.sh. Can also be run standalone. No-op if not inside a
# git checkout (e.g. when wikiforge is installed as a tarball).

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK_SRC="$REPO_ROOT/scripts/bump-plugin-version.sh"

# Resolve the common hooks dir so the hook applies across all worktrees.
# Falls through quietly if this isn't a git checkout.
HOOKS_DIR=$(git -C "$REPO_ROOT" rev-parse --git-common-dir 2>/dev/null || true)
if [ -z "$HOOKS_DIR" ] || [ ! -d "$HOOKS_DIR" ]; then
  echo "[wikiforge] not a git checkout — skipping hook install"
  exit 0
fi
HOOKS_DIR="$HOOKS_DIR/hooks"
mkdir -p "$HOOKS_DIR"
HOOK_DST="$HOOKS_DIR/pre-commit"

# If there's already a non-symlink pre-commit hook, don't clobber it.
if [ -e "$HOOK_DST" ] && [ ! -L "$HOOK_DST" ]; then
  echo "[wikiforge] $HOOK_DST exists and is not a symlink — leaving it alone."
  echo "[wikiforge] To enable the version auto-bump, merge this logic into your existing hook:"
  echo "[wikiforge]   $HOOK_SRC"
  exit 0
fi

ln -sf "$HOOK_SRC" "$HOOK_DST"
chmod +x "$HOOK_SRC"
echo "[wikiforge] pre-commit hook installed: $HOOK_DST -> $HOOK_SRC"
