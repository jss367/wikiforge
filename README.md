# wikiforge

Personal knowledge wiki system. Compiles raw Obsidian notes into a browsable, Wikipedia-style wiki rendered by Quartz.

## Architecture

Three layers, each with its own sync mechanism:

| Layer | What | Location on disk | Synced via |
|---|---|---|---|
| 1 | **Compiler plugin** — Claude Code skill + templates that turn raw notes into compiled wiki pages | `plugin/` (this repo) | Git |
| 2 | **Vault** — raw notes + compiled wiki output + images | `~/Documents/Obsidian Vault/` | Obsidian Sync |
| 3 | **Quartz renderer** — stock Quartz + local overlay | `~/Documents/wiki-quartz/` | Git (stock Quartz) + `quartz-overlay/` (this repo) |

The compiled wiki lives inside the vault at `wiki/`, so it syncs automatically with your notes.

## First-time setup on a new machine

```
git clone git@github.com:jss367/wikiforge.git ~/git/wikiforge
cd ~/git/wikiforge
bash scripts/install.sh
```

The install script:
1. Clones upstream Quartz to `~/Documents/wiki-quartz/`, copies `quartz-overlay/` on top, and runs `npm install`.
2. Symlinks `scripts/claude-wf.sh` to `~/bin/claude-wf` so you can launch Claude Code with wikiforge loaded from anywhere.

Then sign in to Obsidian Sync and pair your vault.

## Daily use

Start Claude Code with wikiforge active:
```
claude-wf
```

That's a thin wrapper around `claude --plugin-dir $REPO_ROOT/plugin` — Claude Code reads the plugin files directly from this git checkout each session, so edits to `plugin/` are live with no cache invalidation, no version bumping, and no plugin-install dance. Run `/reload-plugins` inside a session to pick up changes to `plugin/` without restarting.

Compile the wiki from raw notes (inside a `claude-wf` session):
```
/wiki-compile
```

Serve it locally (either from the shell or with `/wiki-serve` inside Claude). First register each vault you want to browse:

```
bash scripts/wiki-serve.sh --add personal ~/Documents/Obsidian\ Vault
bash scripts/wiki-serve.sh --add work     ~/Documents/WorkVault
bash scripts/wiki-serve.sh --list
```

Each vault gets a stable compiled-wiki port (first vault → 8081, next → 8083, …) with raw served at `port - 1`. Then:

```
bash scripts/wiki-serve.sh personal            # compiled wiki (default mode)
bash scripts/wiki-serve.sh personal raw        # raw notes
bash scripts/wiki-serve.sh personal both       # both simultaneously
```

Run multiple vaults in parallel by opening separate terminals, each serving a different registered vault — ports don't collide because each vault owns its own pair.

Config lives at `~/.config/wikiforge/vaults.json`. Needs `jq` (`brew install jq`).

For a quick one-off without registering, the legacy form still works:
```
VAULT=~/Documents/SomeVault bash scripts/wiki-serve.sh compiled
```

`wiki-serve.sh` applies any new overlay files automatically before starting the server — you don't need to re-run `scripts/install.sh` after pulling wikiforge. The drift check is idempotent and costs tens of milliseconds when nothing has changed.

## Repo layout

```
plugin/                       Claude Code plugin — the compiler
  skills/wiki-compiler/       Compilation algorithm (SKILL.md)
  templates/                  Article + sub-article templates
  commands/                   Slash commands (/wiki-compile etc.)
quartz-overlay/               Files that overlay the stock Quartz install
  quartz.config.ts            Site title, base URL, analytics off
  quartz.layout.ts            Footer, layout tweaks
scripts/
  install.sh                  Set up a new machine (clone Quartz + overlay + wire the claude-wf wrapper)
  claude-wf.sh                Launch Claude Code with plugin/ loaded live via --plugin-dir
  sync-overlay.sh             Idempotently apply quartz-overlay/ to the Quartz install
  wiki-serve.sh               Serve raw / compiled / both (calls sync-overlay.sh first)
```

## Updating Quartz

To pull in upstream Quartz improvements:

```
cd ~/Documents/wiki-quartz && git pull
```

The next `wiki-serve.sh` invocation will re-apply the overlay automatically via `sync-overlay.sh` and rerun `npm install` if upstream's `package.json` or `package-lock.json` moved. You don't need to re-run `install.sh` unless you're setting up a new machine.

If a Quartz update breaks the overlay (e.g. renames a config field), the build fails on next serve — fix the overlay and commit.

## Sharing wikiforge

The daily flow above uses Claude Code's `--plugin-dir` to load `plugin/` live from the git checkout. That's ideal for a solo author iterating on the compiler — no caching, no version bumps, no install step.

If you ever want to install wikiforge as a managed Claude Code plugin on a different machine (or share it with someone else), the marketplace manifest at `.claude-plugin/marketplace.json` supports that path:

```
claude plugin marketplace add /path/to/wikiforge     # or the GitHub URL
claude plugin install wikiforge@wikiforge
```

That copies `plugin/` into `~/.claude/plugins/cache/wikiforge/wikiforge/<version>/`, keyed on the `version` field in `plugin/.claude-plugin/plugin.json`. `claude plugin update` only refreshes when that version changes, so distribution-via-marketplace requires bumping the version on each release. For solo use the `claude-wf` wrapper is strictly simpler; save the marketplace path for actual distribution.
