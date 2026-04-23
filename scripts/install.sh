#!/bin/bash
# First-time setup for wikiforge on a new machine.
#
# Clones upstream Quartz (if missing), applies the wikiforge overlay, and
# prints next steps. The overlay apply itself is delegated to sync-overlay.sh
# so it stays in sync with the runtime path wiki-serve.sh uses.
#
# Idempotent — safe to re-run. On an existing machine you rarely need to:
# wiki-serve.sh calls sync-overlay.sh automatically on every serve.

set -e

QUARTZ="${QUARTZ:-$HOME/Documents/wiki-quartz}"
QUARTZ_REPO="${QUARTZ_REPO:-https://github.com/jackyzha0/quartz.git}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "wikiforge install"
echo "  repo:   $REPO_ROOT"
echo "  quartz: $QUARTZ"
echo ""

# Clone Quartz if missing.
if [ ! -d "$QUARTZ" ]; then
  echo "Cloning Quartz into $QUARTZ..."
  git clone "$QUARTZ_REPO" "$QUARTZ"
else
  echo "Quartz already at $QUARTZ — skipping clone."
fi

# Apply the overlay and refresh dependencies. One source of truth for this
# logic, shared with wiki-serve.sh — sync-overlay.sh runs npm install on a
# fresh clone (no node_modules) or whenever package.json / package-lock.json
# drift, so install.sh doesn't need its own dependency step.
bash "$(dirname "$0")/sync-overlay.sh"

echo ""
echo "Quartz setup complete."
echo ""

# Wire up the Claude Code wrapper. `claude-wf` launches Claude Code with
# this repo's plugin/ loaded live via --plugin-dir, so edits show up
# without any cache invalidation or version bumping. See scripts/claude-wf.sh.
#
# Pick a destination that's already on PATH. Prefer ~/.local/bin (the XDG
# standard); fall back to ~/bin if that's what's configured. If neither
# is on PATH, default to ~/.local/bin and tell the user they'll need to
# add it — silently creating a symlink in a directory git won't find
# would leave `claude-wf` broken with no obvious explanation.
WRAPPER_SRC="$REPO_ROOT/scripts/claude-wf.sh"
WRAPPER_DST=""
PATH_WARN=""
# Match both forms (with and without trailing slash); a PATH entry like
# "$HOME/bin/" is legitimate and would otherwise fall through to the
# default branch.
case ":$PATH:" in
  *":$HOME/.local/bin:"*|*":$HOME/.local/bin/:"*) WRAPPER_DST="$HOME/.local/bin/claude-wf" ;;
  *":$HOME/bin:"*|*":$HOME/bin/:"*)               WRAPPER_DST="$HOME/bin/claude-wf" ;;
  *)
    WRAPPER_DST="$HOME/.local/bin/claude-wf"
    PATH_WARN="$HOME/.local/bin is not on your PATH — add it to your shell profile for 'claude-wf' to resolve."
    ;;
esac
WRAPPER_DIR="$(dirname "$WRAPPER_DST")"
if mkdir -p "$WRAPPER_DIR" 2>/dev/null; then
  if [ -e "$WRAPPER_DST" ] && [ ! -L "$WRAPPER_DST" ]; then
    echo "$WRAPPER_DST exists and is not a symlink — leaving it alone."
  else
    ln -sf "$WRAPPER_SRC" "$WRAPPER_DST"
    echo "Wrapper symlinked: $WRAPPER_DST -> $WRAPPER_SRC"
  fi
  [ -n "$PATH_WARN" ] && echo "  NOTE: $PATH_WARN"
else
  echo "Could not create $WRAPPER_DIR; link the wrapper manually:"
  echo "    ln -sf $WRAPPER_SRC /some/dir/on/PATH/claude-wf"
fi

echo ""
echo "Next steps:"
echo "  1. Sign in to Obsidian Sync on this machine and pair with your vault."
echo "     Default vault path: ~/Documents/Obsidian Vault"
echo ""
echo "  2. Run 'claude-wf' to start Claude Code with wikiforge loaded. Use"
echo "     '/reload-plugins' inside a session to pick up edits to plugin/"
echo "     without restarting."
echo ""
echo "  3. Serve the compiled wiki:"
echo "       bash $REPO_ROOT/scripts/wiki-serve.sh compiled"
echo "     (or /wiki-serve from inside a claude-wf session)"
echo ""
echo "  Future wikiforge updates: just 'git pull'. Nothing else to do —"
echo "  'claude-wf' always reads the current checkout, and wiki-serve.sh"
echo "  re-applies the Quartz overlay automatically."
echo ""
echo "  To distribute wikiforge to someone else (or install it as a"
echo "  managed marketplace plugin on this machine), see the 'Sharing"
echo "  wikiforge' section of the README."
echo ""
