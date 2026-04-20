#!/bin/bash
# Serve your Obsidian vault or compiled wiki as a local website.
#
# Usage:
#   bash scripts/wiki-serve.sh           # compiled wiki on :8081 (default)
#   bash scripts/wiki-serve.sh raw       # raw notes on :8080
#   bash scripts/wiki-serve.sh compiled  # compiled wiki on :8081
#   bash scripts/wiki-serve.sh both      # both side by side
#
# Paths can be overridden via env vars:
#   VAULT  — path to your Obsidian vault (default: ~/Documents/Obsidian Vault)
#   QUARTZ — path to the Quartz install (default: ~/Documents/wiki-quartz)

VAULT="${VAULT:-$HOME/Documents/Obsidian Vault}"
QUARTZ="${QUARTZ:-$HOME/Documents/wiki-quartz}"

if [ ! -d "$QUARTZ" ]; then
  echo "Quartz not found at $QUARTZ. Run scripts/install.sh first."
  exit 1
fi

if [ ! -d "$VAULT" ]; then
  echo "Vault not found at $VAULT. Set VAULT env var if your vault lives elsewhere."
  exit 1
fi

serve_raw() {
  echo "Starting RAW notes wiki at http://localhost:8080"
  cd "$QUARTZ" && npx quartz build --serve --port 8080 -d "$VAULT"
}

serve_compiled() {
  echo "Starting COMPILED wiki at http://localhost:8081"
  cd "$QUARTZ" && npx quartz build --serve --port 8081 -d "$VAULT/wiki"
}

case "${1:-compiled}" in
  raw)
    serve_raw
    ;;
  compiled)
    serve_compiled
    ;;
  both)
    echo "Starting both wikis..."
    echo "  RAW notes:     http://localhost:8080"
    echo "  COMPILED wiki: http://localhost:8081"
    echo ""
    serve_raw &
    RAW_PID=$!
    sleep 2
    serve_compiled &
    COMPILED_PID=$!
    trap "kill $RAW_PID $COMPILED_PID 2>/dev/null" EXIT
    wait
    ;;
  *)
    echo "Usage: bash scripts/wiki-serve.sh [raw|compiled|both]"
    exit 1
    ;;
esac
