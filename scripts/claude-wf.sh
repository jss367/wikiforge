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

# Resolve the real script path, following symlinks. `install.sh` creates
# ~/bin/claude-wf as a symlink to this file, so $0 at runtime is the
# symlink path — dirname($0)/.. would resolve to $HOME, not the repo.
# Walk the symlink chain to get the actual file location. Pure bash so
# this works on macOS (BSD readlink, no -f) and Linux alike.
SOURCE="${BASH_SOURCE[0]:-$0}"
while [ -L "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
REPO_ROOT="$(cd -P "$(dirname "$SOURCE")/.." && pwd)"

exec claude --plugin-dir "$REPO_ROOT/plugin" "$@"
