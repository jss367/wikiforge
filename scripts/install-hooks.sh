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

# Resolve where git actually executes hooks from.
#
# Respect `core.hooksPath` when set (husky/lefthook and other shared hook
# setups rely on it — git won't run hooks from $GIT_COMMON_DIR/hooks if
# that config is present). Fall back to the common git dir so the hook
# applies across all worktrees when no custom path is configured.
#
# Both paths can be returned relative (e.g. ".git"), so resolve against
# $REPO_ROOT before testing — running `install.sh` from outside the repo
# is common, and we don't want to silently no-op in that case.
CUSTOM_HOOKS=$(git -C "$REPO_ROOT" config --get core.hooksPath 2>/dev/null || true)
if [ -n "$CUSTOM_HOOKS" ]; then
  HOOKS_DIR="$CUSTOM_HOOKS"
else
  HOOKS_COMMON=$(git -C "$REPO_ROOT" rev-parse --git-common-dir 2>/dev/null || true)
  if [ -z "$HOOKS_COMMON" ]; then
    echo "[wikiforge] not a git checkout — skipping hook install"
    exit 0
  fi
  HOOKS_DIR="$HOOKS_COMMON/hooks"
fi
case "$HOOKS_DIR" in
  /*) ;;                              # already absolute
  *)  HOOKS_DIR="$REPO_ROOT/$HOOKS_DIR" ;;
esac
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
