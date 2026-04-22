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

# Register the Claude Code plugin. Both commands are idempotent — safe to re-run.
if command -v claude >/dev/null 2>&1; then
  echo "Registering Claude Code plugin..."
  claude plugin marketplace add "$REPO_ROOT"
  claude plugin install wikiforge@wikiforge
  echo ""
  echo "Plugin registered. Restart Claude Code to load the new commands and hooks."
else
  echo "Claude Code CLI ('claude') not found on PATH — skipping plugin registration."
  echo "Install Claude Code, then re-run this script, or register manually:"
  echo "    claude plugin marketplace add $REPO_ROOT"
  echo "    claude plugin install wikiforge@wikiforge"
fi

echo ""
bash "$(dirname "$0")/install-hooks.sh"

echo ""
echo "Next steps:"
echo "  1. Sign in to Obsidian Sync on this machine and pair with your vault."
echo "     Default vault path: ~/Documents/Obsidian Vault"
echo ""
echo "  2. Serve the compiled wiki:"
echo "       bash $REPO_ROOT/scripts/wiki-serve.sh compiled"
echo "     (or /wiki-serve from inside Claude Code)"
echo ""
echo "  Future wikiforge updates: git pull, then 'claude plugin update wikiforge'"
echo "  to refresh the plugin cache. Quartz overlay is re-applied automatically"
echo "  by wiki-serve.sh on every serve."
echo ""
