#!/bin/bash
# Serve Obsidian vaults / compiled wikis as local websites.
#
# Supports multiple registered vaults, each assigned a deterministic port
# so URLs stay stable across restarts and bookmarks don't drift.
#
# Usage:
#   wiki-serve.sh <name> [raw|compiled|both]     Serve a registered vault (default mode: compiled)
#   wiki-serve.sh --add <name> <vault-path>      Register a vault; auto-assigns next free port
#   wiki-serve.sh --list                         Show registered vaults
#   wiki-serve.sh --rm <name>                    Unregister a vault
#   wiki-serve.sh [raw|compiled|both]            Back-compat: serve $VAULT on 8080/8081
#
# Each vault gets one compiled-wiki port; raw is served at (compiled_port - 1).
# Registered vaults start at 8081 and step by 2 (next vault gets 8083, then 8085, …).
#
# Config: ~/.config/wikiforge/vaults.json
# Env overrides: QUARTZ (default: ~/Documents/wiki-quartz), VAULT (legacy only).

set -e

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/wikiforge"
CONFIG_FILE="$CONFIG_DIR/vaults.json"
QUARTZ="${QUARTZ:-$HOME/Documents/wiki-quartz}"
BASE_PORT=8081
PORT_STEP=2

require_jq() {
  command -v jq >/dev/null 2>&1 || {
    echo "wiki-serve.sh needs jq. Install it with: brew install jq" >&2
    exit 1
  }
}

ensure_config() {
  mkdir -p "$CONFIG_DIR"
  [ -f "$CONFIG_FILE" ] || echo '[]' > "$CONFIG_FILE"
}

vault_lookup() {
  # $1 = name; prints "path\tport" tab-separated, or empty if not found.
  jq -r --arg n "$1" '.[] | select(.name==$n) | "\(.path)\t\(.port)"' "$CONFIG_FILE"
}

list_vaults() {
  require_jq
  ensure_config
  if [ "$(jq 'length' "$CONFIG_FILE")" = "0" ]; then
    echo "No vaults registered. Add one with: $0 --add <name> <path>"
    return
  fi
  printf "%-20s %-50s %10s %10s\n" NAME PATH COMPILED RAW
  jq -r '.[] | "\(.name)\t\(.path)\t\(.port)"' "$CONFIG_FILE" | \
    awk -F'\t' '{printf "%-20s %-50s %10s %10s\n", $1, $2, $3, $3-1}'
}

add_vault() {
  require_jq
  ensure_config
  local name="$1" path="$2"
  if [ -z "$name" ] || [ -z "$path" ]; then
    echo "Usage: $0 --add <name> <vault-path>" >&2
    exit 1
  fi
  # Reject names that collide with legacy mode keywords or flag syntax —
  # otherwise `wiki-serve.sh <name>` would hit the legacy path and silently
  # ignore the registered vault.
  case "$name" in
    raw|compiled|both|-*)
      echo "Reserved name: '$name' collides with mode keywords or flag syntax. Pick a different name." >&2
      exit 1
      ;;
  esac
  [ -d "$path" ] || { echo "Path not found: $path" >&2; exit 1; }
  path="$(cd "$path" && pwd)"
  if [ -n "$(vault_lookup "$name")" ]; then
    echo "Vault '$name' already registered. Remove it first with: $0 --rm $name" >&2
    exit 1
  fi
  # Find the next free port, stepping by PORT_STEP so each vault has a clean
  # (raw, compiled) pair with no overlap.
  local port=$BASE_PORT
  while [ -n "$(jq -r --argjson p "$port" '.[] | select(.port==$p) | .name' "$CONFIG_FILE")" ]; do
    port=$((port + PORT_STEP))
  done
  jq --arg n "$name" --arg p "$path" --argjson port "$port" \
    '. + [{name: $n, path: $p, port: $port}]' "$CONFIG_FILE" > "$CONFIG_FILE.tmp"
  mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"
  echo "Registered '$name' at $path"
  echo "  compiled: http://localhost:$port"
  echo "  raw:      http://localhost:$((port - 1))"
}

rm_vault() {
  require_jq
  ensure_config
  local name="$1"
  [ -z "$name" ] && { echo "Usage: $0 --rm <name>" >&2; exit 1; }
  if [ -z "$(vault_lookup "$name")" ]; then
    echo "Vault '$name' not registered." >&2
    exit 1
  fi
  jq --arg n "$name" 'map(select(.name != $n))' "$CONFIG_FILE" > "$CONFIG_FILE.tmp"
  mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"
  echo "Unregistered '$name'."
}

# Force-kill a node process and its children (esbuild, etc.) on Ctrl+C.
# Quartz's serve mode catches SIGINT but does not actually exit — the file
# watcher keeps the event loop alive. `exec` to forward signals is not
# enough; we need a bash trap that issues SIGKILL to the whole subtree so
# the port is released immediately.
kill_subtree() {
  local pid=$1
  # Kill direct children (esbuild, workers) first, then the parent. Use
  # numeric signal `-9` — it's portable across macOS/Linux pkill variants.
  # `|| :` protects against `set -e` aborting the trap before the parent
  # gets killed: pkill returns non-zero when a process has no live
  # children, and kill returns non-zero if the process already exited.
  pkill -9 -P "$pid" 2>/dev/null || :
  kill -9 "$pid" 2>/dev/null || :
}

run_quartz() {
  local port=$1 content_dir=$2
  cd "$QUARTZ" || exit 1
  node ./quartz/bootstrap-cli.mjs build --serve --port "$port" -d "$content_dir" &
  local pid=$!
  trap "kill_subtree $pid; exit 130" INT TERM
  wait "$pid"
}

serve_on_ports() {
  # $1 = vault path, $2 = compiled port, $3 = mode
  local vault_path="$1" compiled_port="$2" mode="$3"
  local raw_port=$((compiled_port - 1))
  [ -d "$QUARTZ" ] || { echo "Quartz not found at $QUARTZ. Run scripts/install.sh first." >&2; exit 1; }
  [ -d "$vault_path" ] || { echo "Vault path not found: $vault_path" >&2; exit 1; }

  # Bring the Quartz install up to the latest overlay before serving. Idempotent;
  # a clean run costs only a handful of cmp calls. Propagate a non-zero exit so a
  # failed sync doesn't silently fall through into the serve path.
  bash "$(dirname "$0")/sync-overlay.sh" || exit $?

  case "$mode" in
    raw)
      echo "Serving RAW notes at http://localhost:$raw_port"
      run_quartz "$raw_port" "$vault_path"
      ;;
    compiled)
      [ -d "$vault_path/wiki" ] || {
        echo "No compiled wiki at $vault_path/wiki — run /wiki-compile first." >&2
        exit 1
      }
      echo "Serving COMPILED wiki at http://localhost:$compiled_port"
      run_quartz "$compiled_port" "$vault_path/wiki"
      ;;
    both)
      echo "  RAW:      http://localhost:$raw_port"
      echo "  COMPILED: http://localhost:$compiled_port"
      # `exec` inside each subshell replaces the subshell with node, so the
      # captured PID is node itself. Without exec, $! points at the subshell
      # and pkill -P would kill node but orphan its grandchildren (esbuild,
      # watchers) when the subshell dies.
      (cd "$QUARTZ" && exec node ./quartz/bootstrap-cli.mjs build --serve --port "$raw_port" -d "$vault_path") &
      local raw_pid=$!
      sleep 2
      (cd "$QUARTZ" && exec node ./quartz/bootstrap-cli.mjs build --serve --port "$compiled_port" -d "$vault_path/wiki") &
      local compiled_pid=$!
      trap "kill_subtree $raw_pid; kill_subtree $compiled_pid; exit 130" INT TERM
      wait
      ;;
    *)
      echo "Unknown mode: $mode (expected: raw, compiled, both)" >&2
      exit 1
      ;;
  esac
}

serve_vault() {
  require_jq
  ensure_config
  local name="$1" mode="${2:-compiled}"
  local info
  info="$(vault_lookup "$name")"
  if [ -z "$info" ]; then
    echo "Vault '$name' not registered. Register it with: $0 --add $name <path>" >&2
    exit 1
  fi
  local path port
  path="$(echo "$info" | cut -f1)"
  port="$(echo "$info" | cut -f2)"
  echo "Vault: $name  ($path)"
  serve_on_ports "$path" "$port" "$mode"
}

legacy_serve() {
  local mode="${1:-compiled}"
  local vault="${VAULT:-$HOME/Documents/Obsidian Vault}"
  serve_on_ports "$vault" 8081 "$mode"
}

show_help() {
  cat <<EOF
wiki-serve.sh — serve Obsidian vaults / compiled wikis locally with Quartz.

Usage:
  $0 <name> [raw|compiled|both]     Serve a registered vault (default mode: compiled)
  $0 --add <name> <vault-path>      Register a vault; auto-assigns next free port
  $0 --list                         Show registered vaults
  $0 --rm <name>                    Unregister a vault
  $0 [raw|compiled|both]            Back-compat: serve \$VAULT on 8080/8081

Each vault is assigned one compiled-wiki port; raw is served at (compiled_port - 1).
Ports start at $BASE_PORT and step by $PORT_STEP per vault.

Config: $CONFIG_FILE
EOF
}

case "${1:-}" in
  --list)                list_vaults ;;
  --add)                 add_vault "$2" "$3" ;;
  --rm)                  rm_vault "$2" ;;
  -h|--help)             show_help ;;
  ""|raw|compiled|both)  legacy_serve "$1" ;;
  *)                     serve_vault "$1" "$2" ;;
esac
