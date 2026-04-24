# Serve Vault Locally via Quartz

Serve a registered Obsidian vault via Quartz on a deterministic localhost port. Delegates to `scripts/wiki-serve.sh`, which auto-applies the latest `quartz-overlay/` before each serve — so recent overlay changes (title-casing, redlinks, footer, etc.) always take effect without the user re-running `scripts/install.sh`.

## Usage

`/wikiforge:wiki-serve` — serve the legacy default vault (`$VAULT` or `~/Documents/Obsidian Vault`) raw on :8080
`/wikiforge:wiki-serve <name>` — serve a registered vault's raw notes (default mode; typical daily use)
`/wikiforge:wiki-serve <name> compiled` — serve `$vault/wiki/` if that directory exists from the legacy compile tool
`/wikiforge:wiki-serve <name> both` — serve raw and compiled-output modes side-by-side
`/wikiforge:wiki-serve --list` — show registered vaults
`/wikiforge:wiki-serve --add <name> <path>` — register a new vault (auto-assigns next free port)
`/wikiforge:wiki-serve --rm <name>` — unregister

Each registered vault gets one port pair: raw at the base port, compiled-output at `port + 1`.

## Instructions

1. Resolve the wikiforge repo root. `${CLAUDE_PLUGIN_ROOT}` is the plugin dir; the bash scripts live one level up at `${CLAUDE_PLUGIN_ROOT}/../scripts/`. If `WIKIFORGE_ROOT` env var is set, prefer that.

2. Forward the user's args to the bash script. For commands that return immediately (`--list`, `--add`, `--rm`, `--help`), run with Bash normally and report the output. For serve commands, run in the background via `run_in_background: true` since the server runs until killed.

   ```bash
   bash "${CLAUDE_PLUGIN_ROOT}/../scripts/wiki-serve.sh" {args}
   ```

3. For serve commands, tell the user the URL(s) that were printed. Also note that the overlay was auto-synced.

4. If the user asks to stop, kill the background bash process.

## Requirements

- Full wikiforge repo clone (the bash scripts live outside `plugin/`). A marketplace-only install wouldn't have access to them.
- Quartz installed at `~/Documents/wiki-quartz` — run `scripts/install.sh` once on first setup.
- `jq` for the multi-vault commands (`brew install jq`). Legacy single-vault serves don't need it.
