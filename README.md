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

Serve it locally:
```
bash scripts/wiki-serve.sh compiled   # compiled wiki on :8081 (default)
bash scripts/wiki-serve.sh raw        # raw notes on :8080
bash scripts/wiki-serve.sh both       # both simultaneously
```

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
  install.sh                  Set up Quartz + overlay on a new machine
  wiki-serve.sh               Serve raw / compiled / both
```

## Updating Quartz

To pull in upstream Quartz improvements:

```
cd ~/Documents/wiki-quartz && git pull
cd ~/git/wikiforge && bash scripts/install.sh     # re-applies overlay + npm install
```

If a Quartz update breaks the overlay (e.g. renames a config field), the install script errors or the build fails — fix the overlay and commit.
