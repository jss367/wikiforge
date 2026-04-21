# Serve Compiled Wiki Locally

Serve the Obsidian vault or compiled wiki via Quartz at `localhost:8080` / `localhost:8081`. Runs `scripts/wiki-serve.sh`, which auto-applies the latest `quartz-overlay/` before serving — so recent wikiforge changes (title-casing, redlinks, footer, etc.) always take effect without the user running `scripts/install.sh` manually.

## Usage

`/wiki-serve` — compiled wiki on :8081 (default)
`/wiki-serve raw` — raw notes on :8080
`/wiki-serve compiled` — compiled wiki on :8081
`/wiki-serve both` — both side-by-side

## Instructions

1. Resolve the wikiforge repo root. `${CLAUDE_PLUGIN_ROOT}` is the plugin dir; the bash scripts live one level up at `${CLAUDE_PLUGIN_ROOT}/../scripts/`. If `WIKIFORGE_ROOT` env var is set, prefer that.

2. Pick the mode from the user's argument (default `compiled`).

3. Start the server in the background via Bash's `run_in_background: true`:

   ```bash
   bash "${CLAUDE_PLUGIN_ROOT}/../scripts/wiki-serve.sh" {mode}
   ```

   The script will first call `sync-overlay.sh` (fast, idempotent) and then `node ./quartz/bootstrap-cli.mjs build --serve`. The server runs until killed.

4. Report to the user:

   ```
   Wiki serving at:
   - Compiled: http://localhost:8081   (or whichever mode applies)
   
   Overlay was auto-synced before launch, so the latest wikiforge changes
   (title-case headings, redlinks, last-edited footer, etc.) are in effect.
   
   Stop with the kill command, or interrupt the background task.
   ```

5. If the user asks to stop, kill the background bash process.

## When to use vs. when not

Use `/wiki-serve` when the user wants to view the wiki in a browser. Do NOT use it for recompiling source notes into the wiki — that's `/wiki-compile`. The two are independent: you can serve without recompiling, and you can recompile without serving.

## Requirements

- Full wikiforge repo clone (the bash scripts live outside `plugin/`). Users who install the plugin via marketplace without cloning the repo will need to either clone it or run `install.sh` manually — `/wiki-serve` surfaces a clear error in that case.
- Quartz installed at `~/Documents/wiki-quartz` (run `scripts/install.sh` once on first setup).
