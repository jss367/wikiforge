---
name: wiki-normalizer
description: Core algorithm for normalizing a single markdown note. Applies deterministic formatting rules (whitespace, blank lines, list markers, heading spacing) and, when the note has no frontmatter, scaffolds a minimal YAML frontmatter block with title, created date, and LLM-proposed tags. Returns a unified diff for user approval; never writes to disk itself. Called by the /wiki-normalize command.
---

# Wiki Normalizer Skill

Produce a normalized version of one markdown file, along with a unified diff the caller can show to the user. The skill does not write to disk — the calling command does that only after explicit approval.

## Safety invariants

1. **Never write to disk.** Return the proposed new content and a diff; the caller is responsible for actually writing.
2. **Never modify prose content below the frontmatter and H1.** The deterministic whitespace rules are allowed; anything else is out of scope.
3. **Never modify existing frontmatter.** If a frontmatter block is already present, leave its fields untouched. The scaffolding step runs only when frontmatter is absent entirely.
4. **Never modify the H1 heading.** It's the canonical title and the author's authorship claim.

## Phase 1: Deterministic formatting

Apply all of these unconditionally. They're idempotent cosmetic rules — running the skill twice in a row on the same file must be a no-op.

1. **Trailing whitespace**: strip from every line. EXCEPTION: preserve exactly two trailing spaces (markdown's hard-line-break marker).
2. **Blank-line runs**: collapse any run of 3+ consecutive blank lines to exactly 2. Don't collapse to 1 — some authors intentionally use 2 blanks for rhythm; the markdown renderer will collapse them but the source should preserve intent.
3. **Trailing newline**: ensure the file ends with exactly one `\n`.
4. **Unordered list markers**: normalize to `-`. Convert `*` and `+` at the start of a list item (respecting indentation) to `-`. Leave ordered list markers (`1.`, `2.`, etc.) alone.
5. **Heading spacing**: ensure a blank line before each `#`-prefixed heading (except at file start / directly after frontmatter) and a blank line after each heading. Don't insert duplicate blank lines if the spacing is already correct.
6. **Fenced code blocks**: ensure a blank line before and after triple-backtick fences. Don't touch the fence content itself.

## Phase 2: Frontmatter scaffolding (conditional)

Only runs when the file has no YAML frontmatter block at the top (no `---` as the first line).

If a malformed frontmatter-like block is present (e.g. `---` without a closing `---`), surface a warning and skip scaffolding — don't try to auto-repair structural YAML problems.

Propose a minimal frontmatter block with exactly these fields, in this order:

```yaml
---
title: <derived>
created: <YYYY-MM-DD>
tags: [<list>]
---
```

### Field derivation rules

- **`title`**: prefer the first `#` heading in the file (strip the `#` and leading whitespace). If no H1 exists, derive from the filename: strip the `.md` extension, replace `_` and `-` with spaces, apply Title Case.
- **`created`**: if the vault is a git repository, use `git log --reverse --format=%as -- <path> | head -1` to get the first-commit date. Otherwise use the file's mtime. Always emit as ISO 8601 date (`YYYY-MM-DD`, no time).
- **`tags`**: propose 3–7 tags based on the note's content. Rules:
  - Use kebab-case (`ai-safety`, not `AI Safety` or `aiSafety`).
  - **Prefer reusing tags from the rest of the vault.** Before proposing, sample a few other notes' frontmatter to learn the existing tag namespace; reuse a tag that's already in use rather than minting a near-duplicate.
  - Err on the side of too few. The user can always add more; subtracting a bad suggestion is higher friction.
  - Skip tags that are trivially derivable from the folder (a note in `Career/` doesn't need a `career` tag).
- **`aliases`** (optional, omit by default): only propose if the filename is substantively different from the derived title AND the note is long enough (>500 words) to warrant being linked under an alternative name. When omitted, don't emit the field at all.

## Phase 3: Diff assembly

Build a unified diff between the original content and the normalized content. Format:

```
--- <path>  (current)
+++ <path>  (normalized)
@@ <hunk header>
 <unchanged line>
-<removed line>
+<added line>
```

Pack all changes into one diff — the caller shows it to the user as a single block.

## Phase 4: Return payload

Return to the caller:

1. **`new_content`** — the full normalized file content (string).
2. **`diff`** — the unified diff (string).
3. **`notes`** — a list of short human-readable change descriptions:
   - "added frontmatter (title, created=2024-08-15, 4 tags)"
   - "normalized 12 lines of trailing whitespace"
   - "collapsed 3 runs of blank lines"
   - "warning: frontmatter block malformed — skipped scaffolding"

## Idempotence check

After computing the normalized content, running the same skill on that output must produce zero changes. If it doesn't, there's a bug in the formatter rules — surface it to the caller rather than silently producing unstable output.
