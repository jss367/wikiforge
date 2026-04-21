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

# Apply the overlay and (if needed) run npm install. One source of truth for
# this logic, shared with wiki-serve.sh.
bash "$(dirname "$0")/sync-overlay.sh"

# Force npm install on first setup even if package.json marker already matches —
# a fresh Quartz clone has no node_modules yet.
if [ ! -d "$QUARTZ/node_modules" ]; then
  echo "Installing Quartz dependencies..."
  (cd "$QUARTZ" && npm install)
fi

echo ""
echo "Quartz setup complete."
echo ""
echo "Next steps:"
echo "  1. Sign in to Obsidian Sync on this machine and pair with your vault."
echo "     Default vault path: ~/Documents/Obsidian Vault"
echo ""
echo "  2. Register the Claude Code plugin. Add to ~/.claude/settings.json:"
echo "       \"plugins\": [\"$REPO_ROOT/plugin\"]"
echo "     (or however you normally register plugins — consult Claude Code docs)"
echo ""
echo "  3. Serve the compiled wiki:"
echo "       bash $REPO_ROOT/scripts/wiki-serve.sh compiled"
echo "     (or /wiki-serve from inside Claude Code)"
echo ""
echo "  Future wikiforge updates: just git pull and re-serve. wiki-serve.sh"
echo "  calls sync-overlay.sh automatically."
echo ""
