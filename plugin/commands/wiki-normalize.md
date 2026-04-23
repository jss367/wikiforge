# Normalize a Markdown Note

Clean up formatting and scaffold YAML frontmatter on a single markdown note.

Deterministic cosmetic changes (whitespace, blank lines, list markers) are applied unconditionally. Frontmatter scaffolding (title, created date, tags) is LLM-assisted and requires explicit approval. Either way, the full diff is shown before anything is written to disk.

## Arguments

- `<path>` (required) — path to the markdown file, relative to CWD or absolute.

## Instructions

1. **Validate the argument.** If no path was given, or the path doesn't exist, or it isn't a `.md` file, print a short error and exit. Example error: "Usage: /wiki-normalize <path-to-note.md>".

2. **Warn on uncommitted git changes.** If the vault is a git repo and the target file has unstaged or staged changes, warn the user: "This file has uncommitted changes — the normalize diff will be mixed with your in-progress edits. Commit or stash first?" Wait for explicit "continue" before proceeding. Skip this check if the vault isn't a git repo.

3. **Invoke the `wiki-normalizer` skill** to compute the normalized version. The skill returns:
   - The proposed new file content.
   - A unified diff vs the current content.
   - A list of notes/warnings (e.g. "added frontmatter", "5 trailing-whitespace lines cleaned", "proposed 4 tags based on content").

4. **Show the diff** in a code block, followed by the notes/warnings list.

5. **Ask for approval.** Accept yes/y/apply/ok to write, no/n/skip/abort to bail. If the user wants to tweak tags or title before applying, let them dictate the change and re-show the diff.

6. **On approval, write the file atomically** — write to a temp sibling file, then rename over the original. Never truncate-in-place.

7. **Report the outcome** in one line: e.g., "normalized Career/80k hours.md (5 whitespace, +frontmatter with 4 tags)".

## What this command does NOT do

- **Wikilink enrichment** (adding `[[links]]` to bare text that matches existing note titles) — separate command, not yet implemented.
- **TLDR insertion** at the top of long notes — separate command, not yet implemented.
- **Cross-note operations** like dead-link repair or dedupe detection — separate command (`/wiki-lint`), not yet implemented.
- **Prose edits** — the skill does not rewrite any content below the frontmatter or the H1 heading.
