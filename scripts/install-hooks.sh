#!/bin/bash
# Install wikiforge git hooks.
#
# Symlinks scripts/bump-plugin-version.sh as pre-commit in the location
# git actually executes hooks from. Idempotent — safe to re-run.
#
# Called by install.sh. Can also be run standalone. No-op if not inside a
# git checkout (e.g. when wikiforge is installed as a tarball).
#
# Resolution rules (match git's own hook-lookup semantics):
#   1. If core.hooksPath is set and absolute → install there once (shared
#      across all worktrees).
#   2. If core.hooksPath is set and relative → git resolves per-worktree,
#      so install into every worktree's <root>/<hooksPath>.
#   3. Otherwise → use $GIT_COMMON_DIR/hooks, which is shared across all
#      worktrees by default. Install once.

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Must be inside a git checkout before reading any config. `git config
# --get` falls back to global + system scopes when there's no repo-local
# config, so running install-hooks from a tarball extraction with a
# global `core.hooksPath` set would otherwise make us write symlinks
# into the user's global hooks directory — affecting every repo on
# their machine. Bail before that can happen.
if ! git -C "$REPO_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  echo "[wikiforge] $REPO_ROOT is not a git checkout — skipping hook install"
  exit 0
fi

# Resolve core.hooksPath in two steps. Naively calling `git config --get`
# reads local + global + system and returns any of them — which means a
# developer with a global hooksPath (e.g. for a husky-style shared hook
# dir) would have us symlink into that shared directory and affect every
# repo on their machine. Restricting to `--local` avoids clobbering, but
# then silently no-op's when git itself would execute hooks from the
# global path — the user gets a "successfully installed" message and
# the hook never runs. Neither is right.
#
# Policy: trust a repo-local core.hooksPath implicitly (it's scoped to
# this repo). If a global/system hooksPath exists without a local one,
# print clear guidance and bail instead of silently installing somewhere
# that either won't be read or will affect unrelated repos.
#
# `--path` expands "~" and other path-specific config forms the same way
# git does at hook-execution time.
CUSTOM_HOOKS=$(git -C "$REPO_ROOT" config --local --path --get core.hooksPath 2>/dev/null || true)
if [ -z "$CUSTOM_HOOKS" ]; then
  INHERITED_HOOKS=$(git -C "$REPO_ROOT" config --path --get core.hooksPath 2>/dev/null || true)
  if [ -n "$INHERITED_HOOKS" ]; then
    echo "[wikiforge] core.hooksPath is set in global/system git config to: $INHERITED_HOOKS"
    echo "[wikiforge] Git will execute hooks from that shared directory, so an install into \$GIT_DIR/hooks"
    echo "[wikiforge] would be inert and an install into the shared dir would affect every repo on your"
    echo "[wikiforge] machine. Skipping — to enable the wikiforge auto-bump here, choose one:"
    echo "[wikiforge]   (a) scope it to this repo:   git -C $REPO_ROOT config --local core.hooksPath .githooks"
    echo "[wikiforge]       then re-run:             bash $REPO_ROOT/scripts/install-hooks.sh"
    echo "[wikiforge]   (b) wire it into your shared dir manually:"
    echo "[wikiforge]       ln -sf $REPO_ROOT/scripts/bump-plugin-version.sh $INHERITED_HOOKS/pre-commit"
    exit 0
  fi
fi

install_hook_in_worktree() {
  # Install the pre-commit symlink inside one worktree.
  local worktree="$1"
  local hook_src="$worktree/scripts/bump-plugin-version.sh"
  local hooks_dir hook_dst existing_target hooks_common

  if [ -n "$CUSTOM_HOOKS" ]; then
    hooks_dir="$CUSTOM_HOOKS"
  else
    hooks_common=$(git -C "$worktree" rev-parse --git-common-dir 2>/dev/null || true)
    if [ -z "$hooks_common" ]; then
      echo "[wikiforge] $worktree is not a git checkout — skipping"
      return 0
    fi
    hooks_dir="$hooks_common/hooks"
  fi
  case "$hooks_dir" in
    /*) ;;                              # already absolute
    *)  hooks_dir="$worktree/$hooks_dir" ;;
  esac
  mkdir -p "$hooks_dir"
  hook_dst="$hooks_dir/pre-commit"

  # Don't clobber existing hooks. Three cases:
  #   1. Symlink to our own hook → refresh (idempotent re-run).
  #   2. Symlink to a different hook → leave alone and print instructions.
  #      This matters when core.hooksPath points at a shared/global dir
  #      (e.g. ~/.githooks) where overwriting another hook manager's
  #      symlink would silently change behavior across unrelated repos.
  #   3. Non-symlink file (hand-written script) → leave alone.
  if [ -L "$hook_dst" ]; then
    existing_target=$(readlink "$hook_dst")
    if [ "$existing_target" != "$hook_src" ]; then
      echo "[wikiforge] $hook_dst is a symlink to a different hook ($existing_target) — leaving it alone."
      echo "[wikiforge] To also run the wikiforge version auto-bump, either re-point it or invoke both from a wrapper:"
      echo "[wikiforge]   $hook_src"
      return 0
    fi
  elif [ -e "$hook_dst" ]; then
    echo "[wikiforge] $hook_dst exists and is not a symlink — leaving it alone."
    echo "[wikiforge] To enable the version auto-bump, merge this logic into your existing hook:"
    echo "[wikiforge]   $hook_src"
    return 0
  fi

  ln -sf "$hook_src" "$hook_dst"
  chmod +x "$hook_src"
  echo "[wikiforge] pre-commit hook installed: $hook_dst -> $hook_src"
}

# Only iterate worktrees when core.hooksPath is set AND relative — in
# that case git resolves per-worktree, so each worktree needs its own
# install. Absolute paths (including tilde-expanded) and the default
# common-dir path are shared, so installing once is enough.
PER_WORKTREE=0
if [ -n "$CUSTOM_HOOKS" ]; then
  case "$CUSTOM_HOOKS" in
    /*) ;;                              # absolute — install once
    *)  PER_WORKTREE=1 ;;
  esac
fi

if [ "$PER_WORKTREE" = "1" ]; then
  while IFS= read -r wt; do
    [ -n "$wt" ] && install_hook_in_worktree "$wt"
  done < <(git -C "$REPO_ROOT" worktree list --porcelain 2>/dev/null | awk '/^worktree / { print substr($0, 10) }')
else
  install_hook_in_worktree "$REPO_ROOT"
fi
