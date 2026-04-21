# Serve Compiled Wiki Locally

Serve a registered Obsidian vault (or the legacy default vault) via Quartz on a deterministic localhost port. Delegates to `scripts/wiki-serve.sh`, which auto-applies the latest `quartz-overlay/` before each serve — so recent wikiforge changes (title-casing, redlinks, footer, etc.) always take effect without the user running `scripts/install.sh` manually.

## Usage

`/wiki-serve` — serve the legacy default vault (`$VAULT` or `~/Documents/Obsidian Vault`) on :8081 (compiled)
`/wiki-serve <name>` — serve a registered vault in compiled mode
`/wiki-serve <name> raw` — serve a registered vault in raw mode
`/wiki-serve <name> both` — serve both modes side-by-side for one vault
`/wiki-serve --list` — show registered vaults
`/wiki-serve --add <name> <path>` — register a new vault (auto-assigns next free port)
`/wiki-serve --rm <name>` — unregister

Each registered vault gets one compiled-wiki port (starting at 8081, stepping by 2); raw is served at `port - 1`.

## Instructions

1. Resolve the wikiforge repo root. `${CLAUDE_PLUGIN_ROOT}` is the plugin dir; the bash scripts live one level up at `${CLAUDE_PLUGIN_ROOT}/../scripts/`. If `WIKIFORGE_ROOT` env var is set, prefer that.

2. Forward the user's args to the bash script. For commands that return immediately (`--list`, `--add`, `--rm`, `--help`), run with Bash normally and report the output. For serve commands (default, or `<name> [mode]`), run in the background via `run_in_background: true` since the server runs until killed.

   ```bash
   bash "${CLAUDE_PLUGIN_ROOT}/../scripts/wiki-serve.sh" {args}
   ```

3. For serve commands, tell the user the URL that was printed (the bash script echoes `Serving COMPILED wiki at http://localhost:NNNN`). Also note that the overlay was auto-synced — so title-cased headings, redlinks, the last-edited footer, etc., are live.

4. If the user asks to stop, kill the background bash process.

## When to use vs. when not

Use `/wiki-serve` to view a wiki in a browser. Do NOT use it for recompiling source notes — that's `/wiki-compile`. The two are independent: you can serve without recompiling, and you can recompile without serving.

## Requirements

- Full wikiforge repo clone (the bash scripts live outside `plugin/`). Marketplace-only installs won't have access to them.
- Quartz installed at `~/Documents/wiki-quartz` — run `scripts/install.sh` once on first setup.
- `jq` for the multi-vault commands (`brew install jq`). Legacy single-vault serves don't need it.
