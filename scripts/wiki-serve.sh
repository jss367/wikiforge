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

# Force-kill a node process and its children (esbuild, etc.) on Ctrl+C.
# Quartz's serve mode catches SIGINT but does not actually exit — the file
# watcher keeps the event loop alive. `exec` to forward signals is not
# enough; we need a bash trap that issues SIGKILL to the whole subtree so
# the port is released immediately.
kill_subtree() {
  local pid=$1
  # Kill direct children (esbuild, workers) first, then the parent. Use
  # numeric signal `-9` — it's portable across macOS/Linux pkill variants.
  pkill -9 -P "$pid" 2>/dev/null
  kill -9 "$pid" 2>/dev/null
}

run_quartz() {
  local port=$1
  local content_dir=$2
  cd "$QUARTZ" || exit 1
  node ./quartz/bootstrap-cli.mjs build --serve --port "$port" -d "$content_dir" &
  local pid=$!
  trap "kill_subtree $pid; exit 130" INT TERM
  wait "$pid"
}

serve_raw() {
  echo "Starting RAW notes wiki at http://localhost:8080"
  run_quartz 8080 "$VAULT"
}

serve_compiled() {
  echo "Starting COMPILED wiki at http://localhost:8081"
  run_quartz 8081 "$VAULT/wiki"
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
    (cd "$QUARTZ" && node ./quartz/bootstrap-cli.mjs build --serve --port 8080 -d "$VAULT") &
    RAW_PID=$!
    sleep 2
    (cd "$QUARTZ" && node ./quartz/bootstrap-cli.mjs build --serve --port 8081 -d "$VAULT/wiki") &
    COMPILED_PID=$!
    trap "kill_subtree $RAW_PID; kill_subtree $COMPILED_PID; exit 130" INT TERM
    wait
    ;;
  *)
    echo "Usage: bash scripts/wiki-serve.sh [raw|compiled|both]"
    exit 1
    ;;
esac
