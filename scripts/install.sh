#!/bin/bash
# Set up wikiforge on a new machine.
#
# This script:
#   1. Clones upstream Quartz into $QUARTZ (default ~/Documents/wiki-quartz)
#   2. Copies quartz-overlay/ over the stock Quartz files
#   3. Runs npm install
#   4. Prints instructions for registering the Claude Code plugin
#
# Idempotent — safe to re-run after pulling new changes.

set -e

QUARTZ="${QUARTZ:-$HOME/Documents/wiki-quartz}"
QUARTZ_REPO="${QUARTZ_REPO:-https://github.com/jackyzha0/quartz.git}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "wikiforge install"
echo "  repo:   $REPO_ROOT"
echo "  quartz: $QUARTZ"
echo ""

# 1. Clone Quartz if missing
if [ ! -d "$QUARTZ" ]; then
  echo "Cloning Quartz into $QUARTZ..."
  git clone "$QUARTZ_REPO" "$QUARTZ"
else
  echo "Quartz already at $QUARTZ — skipping clone."
fi

# 2. Apply overlay (recursive — handles nested dirs like quartz/components/)
echo "Applying quartz-overlay/..."
rsync -av "$REPO_ROOT/quartz-overlay/" "$QUARTZ/"

# 3. npm install
echo "Installing Quartz dependencies..."
cd "$QUARTZ"
npm install

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
echo ""
