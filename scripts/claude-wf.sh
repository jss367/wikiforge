#!/usr/bin/env bash
# Launch Claude Code with the wikiforge plugin loaded live from this repo.
#
# Uses Claude Code's --plugin-dir flag, which reads plugin files directly
# from disk each session. No cache, no version bumping — edits to plugin/
# show up immediately (use /reload-plugins inside a session to pick up
# changes without restarting).
#
# Recommended install (once per machine):
#   ln -sf "$(pwd)/scripts/claude-wf.sh" ~/bin/claude-wf
# then run `claude-wf` anywhere to start a wikiforge-enabled session.

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec claude --plugin-dir "$REPO_ROOT/plugin" "$@"
