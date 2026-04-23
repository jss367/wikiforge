# wikiforge

A small Claude Code plugin for cleaning up Obsidian notes *in place*, plus a pre-configured Quartz instance for browsing your vault in a browser. Nothing is synthesized; nothing is rewritten without your approval.

Originally this repo did something more ambitious — compile a vault into a Wikipedia-style topic wiki. That didn't turn out to be what the author actually wanted, and the compiler has been removed. What's left is the stuff that earned its keep: a Quartz-powered browser view of your existing notes, and a growing set of narrow cleanup commands that act on one note at a time.

## Three layers

| Layer | What | Location on disk | Synced via |
|---|---|---|---|
| 1 | **Cleanup plugin** — Claude Code slash commands that normalize single notes | `plugin/` (this repo) | Git |
| 2 | **Vault** — your raw Obsidian notes | wherever your vault lives | Obsidian Sync |
| 3 | **Quartz renderer** — stock Quartz + local overlay | `~/Documents/wiki-quartz/` | Git (stock Quartz) + `quartz-overlay/` (this repo) |

## First-time setup on a new machine

```
git clone git@github.com:jss367/wikiforge.git ~/git/wikiforge
cd ~/git/wikiforge
bash scripts/install.sh
```

The install script:
1. Clones upstream Quartz to `~/Documents/wiki-quartz/`, copies `quartz-overlay/` on top, and runs `npm install`.
2. Symlinks `scripts/claude-wf.sh` into your PATH (prefers `~/.local/bin`, falls back to `~/bin`) so you can launch Claude Code with wikiforge loaded from anywhere.

Recommended but optional: `git init` your vault so every cleanup run leaves an inspectable, reversible commit trail.

## Daily use

### Cleaning up notes

Start a Claude Code session with wikiforge active:

```
claude-wf
```

That's a thin wrapper around `claude --plugin-dir $REPO_ROOT/plugin` — Claude Code reads the plugin files directly from your git checkout each session, so edits to `plugin/` are live with no cache invalidation, no version bumping. Run `/reload-plugins` inside a session to pick up changes without restarting.

Once inside a session, to normalize a single note:

```
/wikiforge:wiki-normalize path/to/note.md
```

This cleans up whitespace, standardizes list markers, enforces heading spacing, and — if the note has no YAML frontmatter — proposes a minimal block with title, created date, and a few LLM-suggested tags. You see the full diff and approve it before anything is written.

Other cleanup commands may be added later (wikilink enrichment, cross-vault dedupe reports). Each will be similarly scoped: one concrete operation, previewed diffs, no prose rewriting.

### Browsing notes in a browser

Quartz serves your vault as a static site. First register the vault:

```
bash scripts/wiki-serve.sh --add personal ~/Documents/Obsidian\ Vault
bash scripts/wiki-serve.sh --list
```

Each registered vault gets a port pair — compiled at the assigned port, raw at one less. Default is 8081/8080 for the first vault. Then:

```
bash scripts/wiki-serve.sh personal            # the vault as-is (raw)
bash scripts/wiki-serve.sh personal both       # raw + anything still in $vault/wiki/ from the legacy compile tool
```

(Historical: the `compiled` mode points Quartz at `$vault/wiki/`, where the old compile tool used to emit synthesized articles. Kept for users who still have that directory around and want to browse it.)

Run multiple vaults in parallel by opening separate terminals; ports don't collide because each vault owns its own pair.

Config lives at `~/.config/wikiforge/vaults.json`. Needs `jq` (`brew install jq`).

## Repo layout

```
plugin/                       Claude Code plugin — cleanup commands
  commands/wiki-normalize.md  /wikiforge:wiki-normalize <path>
  commands/wiki-serve.md      /wikiforge:wiki-serve
  skills/wiki-normalizer/     Normalization algorithm (SKILL.md)
  .claude-plugin/             Plugin manifest
quartz-overlay/               Files that overlay the stock Quartz install
  quartz.config.ts            Site title, base URL, analytics off
  quartz.layout.ts            Footer, layout tweaks
scripts/
  install.sh                  Set up a new machine (clone Quartz + overlay + wire the claude-wf wrapper)
  claude-wf.sh                Launch Claude Code with plugin/ loaded live via --plugin-dir
  sync-overlay.sh             Idempotently apply quartz-overlay/ to the Quartz install
  wiki-serve.sh               Serve a registered vault via Quartz
```

## Updating Quartz

To pull in upstream Quartz improvements:

```
cd ~/Documents/wiki-quartz && git pull
```

The next `wiki-serve.sh` invocation re-applies the overlay automatically and reruns `npm install` if upstream's `package.json` / `package-lock.json` moved.

## Sharing wikiforge

The daily flow uses Claude Code's `--plugin-dir` to load `plugin/` live from the git checkout. That's ideal for a solo user — no caching, no version bumps, no install step.

If you want to install wikiforge as a managed Claude Code plugin on a different machine (or share it with someone else), the marketplace manifest at `.claude-plugin/marketplace.json` supports that path:

```
claude plugin marketplace add /path/to/wikiforge     # or the GitHub URL
claude plugin install wikiforge@wikiforge
```

That copies `plugin/` into `~/.claude/plugins/cache/wikiforge/wikiforge/<version>/`, keyed on the `version` field in `plugin/.claude-plugin/plugin.json`. `claude plugin update` only refreshes when that version changes. For solo use the `claude-wf` wrapper is strictly simpler; save the marketplace path for actual distribution.
