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

The install script clones upstream Quartz to `~/Documents/wiki-quartz/`, copies `quartz-overlay/` on top, and runs `npm install`.

Then:

1. Sign in to Obsidian Sync and pair your vault.
2. Register `plugin/` with Claude Code (see install script output).

## Daily use

Compile the wiki from raw notes:
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
  install.sh                  Set up Quartz on a new machine (clone + overlay + npm install)
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
