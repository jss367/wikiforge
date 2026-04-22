---
name: wiki-compiler
description: Core compilation algorithm for the LLM Wiki Compiler. Reads source files from configured directories and compiles them into topic-based wiki articles. Supports both knowledge mode (markdown files) and codebase mode (code repositories). Called by /wiki-compile command.
---

# Wiki Compiler — Compilation Algorithm

This skill contains the 5-phase algorithm for compiling source files into a topic-based wiki.

**Safety rule:** NEVER modify any file outside the configured output directory. Source files are read-only.

**Exceptions (allowed writes outside the output directory):**
- `.wiki-compiler.yml` and `.wiki-compiler.json` at the project root. The skill writes these only in two situations: (1) one-time JSON→YAML migration on first run if only the JSON file exists, and (2) appending a user-approved directive to `preferences` or `topics.<slug>.notes` via the "Learning from user feedback" loop. All other edits to source notes remain out of scope.

## Prerequisites

Before running, read the compiler config file from the project root. Prefer `.wiki-compiler.yml`; fall back to `.wiki-compiler.json` if the YAML file doesn't exist. If ONLY the JSON file exists, **migrate it**: parse it, re-emit as YAML at `.wiki-compiler.yml`, then delete the JSON file. The two formats share the same schema — YAML is preferred because it supports multi-line strings and comments, which the `preferences` and `topics.<slug>.notes` fields benefit from.

**Config schema:**

```yaml
version: 2
name: "Julius's Wiki"
mode: knowledge          # or "codebase"
sources:
  - path: "./"
    exclude: ["wiki/", "attachments/", ".obsidian/", ".trash/"]
output: wiki/
link_style: obsidian     # or "markdown"
auto_update: prompt

# Global editorial preferences — applied to EVERY topic's compile agent
preferences:
  - No academic parenthetical citations. Link to paper notes instead.
  - Wikipedia-style inline wikilinks, dense linking.
  - Short hub sections; push detail to sub-pages.

# Per-topic directives — OPTIONAL. Claude infers sources/excludes from directory
# structure by default. Use topics entries to override defaults or pass notes.
topics:
  gradient-routing:
    sources: ["Gradient Routing/**"]     # optional override
    exclude: ["Untitled 7.md"]           # optional topic-scoped exclude
    notes:
      - Keep the ablation table in spike-v3 prominent.
      - Explain NAND routing before the spike sequence.
      - Each spike (v1–v4) gets its own sub-page.

article_sections:         # optional — overrides default article template
  - { name: Summary, required: true }
  - { name: Key Details }
  - { name: Sources, required: true }

topic_hints:              # optional seed topics for first compile
  - gradient routing
  - AI safety
```

**Legacy fields (still supported for backward compat on read; emit as YAML on migration):**
- `article_sections` — override article structure
- `topic_hints` — seed topic names for first compile

**Codebase mode additional config:**
- `service_discovery` — "auto" (detect monorepo vs single project) or "manual"
- `knowledge_files[]` — glob patterns for priority documentation files (README.md, CLAUDE.md, etc.)
- `deep_scan` — `false` (default) or `true` (also read key source files for richer articles)
- `code_extensions[]` — file extensions to consider as source code (e.g., `.ts`, `.py`, `.go`)

**How config drives compilation:**

The `preferences` list and `topics.<slug>.notes` list are passed verbatim to the agent prompt that compiles each topic. They behave like a persistent editorial voice the compiler respects. When the user gives editorial feedback during a session ("always include the X table", "don't mention Y"), the skill should offer to add that directive to the config so it's remembered across compiles. See "Learning from user feedback" at the bottom of this file.

## Phase 1: Scan Sources

### Knowledge mode (default)

1. For each entry in `sources[]`, list all `.md` files using Glob
2. Exclude any paths matching `exclude` patterns (e.g., the `wiki/` output directory itself)
3. After Phase 2 classification, resolve each topic's final source set as follows:
   - **If `topics.<slug>.sources` is set in config** — this is an explicit override. Use it as the authoritative source list for this topic. Ignore classification for those globs; files matching them belong to this topic regardless of heuristic. Files NOT matching any topic's override are still classified by content.
   - Then apply `topics.<slug>.exclude` to remove files from that topic even if they matched.
4. Read `.compile-state.json` from the output directory
5. Compare file list against previous state to identify new or changed files
6. On first run (no prior state), treat ALL files as new

### Incremental-skip decision (per topic, evaluated before Phase 3)

For each topic, decide RECOMPILE or SKIP. The decision must invalidate correctly on four independent axes: source-file set changes, source-file content changes, config changes scoped to this topic, and changes to the compiler itself (plugin version or skill instructions).

**State the skip decision needs (stored per topic in `.compile-state.json` from the last compile):**
- `topics.<slug>.sources`: sorted list of source file paths included last compile
- `topics.<slug>.config_hash`: hash of the config subtree that influenced this topic last compile — specifically `preferences` (global) + `topics.<slug>` (this topic's entry), including its `sources`, `exclude`, and `notes`
- `topics.<slug>.plugin_version`: the `version` field from `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` when *this topic* was last compiled
- `topics.<slug>.skill_hash`: SHA-256 (first 16 hex chars is fine) of `${CLAUDE_PLUGIN_ROOT}/skills/wiki-compiler/SKILL.md` when *this topic* was last compiled. Catches heuristic changes that ship without a version bump.

These compiler-identity fields are stored **per topic**, not globally. A topic that didn't recompile in the last run retains its old `plugin_version`/`skill_hash`, so the next compile still detects the mismatch for that specific topic — the signal survives scoped `--topic` runs.

**Plus one global state field:**
- `schema_hash`: hash of schema-level fields that affect all topics — `article_sections`, `mode`, `output`, `link_style`, and any other cross-cutting config that changes what every compile emits

**Global gates applied before the per-topic loop:**

- If `--topic <slug>` was passed, restrict the entire compile to that one slug. Every other topic is skipped without any further evaluation. The per-topic loop below runs for exactly one topic, and step 2 below fires for it.
- If `--force` was passed with no `--topic`, every topic enters the loop and hits step 2.

**Decision (per topic in the restricted loop):**

1. **No prior compile?** → RECOMPILE (first-run behavior).
2. **`--force`, or `--topic <slug>` and this IS the targeted slug?** → RECOMPILE.
3. **Compiler change?** Read the current plugin version and compute the current skill hash. If either differs from this topic's stored `plugin_version` or `skill_hash` → RECOMPILE. This is what propagates heuristic changes retroactively: a topic compiled under old rules keeps its old stored values until it's re-evaluated under the new ones.
4. **Schema change?** Compute the current `schema_hash` from config. If it differs from the stored `schema_hash` → RECOMPILE (applies to every topic; check this once at the start of the skip pass and, if changed, RECOMPILE every topic without running the remaining per-topic checks).
5. **Source-set change?** Compute the current source set (after Phase 2 + per-topic sources/excludes resolution). If it differs from `topics.<slug>.sources` in the prior state — any addition, removal, or rename — → RECOMPILE. This catches deleted or renamed sources that would otherwise leave stale Sources entries.
6. **Config-scope change?** Compute a fresh hash of `preferences` + `topics.<slug>` from the current config. If it differs from the stored `topics.<slug>.config_hash` → RECOMPILE *this topic only*. A change to one topic's `notes` does not invalidate other topics.
7. **Source-content change?** For each current source, compare its `mtime` to the compiled hub's `mtime` at `{output}/topics/{slug}.md`. If any source is newer → RECOMPILE.
8. **None of the above triggered?** → SKIP. Report as "unchanged, skipped".

**Completion-summary callouts related to compiler changes:**

- If the compiler-change check (step 3) fired for every topic and drove a full rebuild (i.e. no `--topic` was passed and the plugin version or skill hash differed from every stored entry), surface it as: "Compiler updated since last compile (v{old} → v{new}) — full rebuild." This is the normal case when a user upgrades the plugin and runs `/wiki-compile` next.
- If `--topic <slug>` was passed and the compiler changed, recompile only the targeted topic and warn: "Compiler updated since last compile, but `--topic` was passed — other topics remain on old rules. Run `/wiki-compile` (without `--topic`) to propagate the change." Do not touch other topics' stored values.

**Note on global config and compiler changes:**
- A change to `preferences` (the global list) changes every topic's `config_hash` (since each hash includes `preferences`), so it correctly invalidates all topics.
- A change to a single `topics.<slug>` entry only changes that topic's `config_hash`.
- Schema-level changes (e.g. `article_sections`, `mode`, `output`) should invalidate all topics — include them in the hash or force a full recompile when they change.
- Plugin version bumps and edits to `SKILL.md` invalidate each topic the next time it's evaluated, via step 3 above. This is load-bearing for getting heuristic changes to propagate retroactively. **Bump `version` in `plugin.json` whenever compiler logic or editorial rules change** — otherwise users on a stale cached install will silently run old instructions. The `skill_hash` check is a belt-and-braces backup for the common case where someone edits `SKILL.md` without remembering to bump the version.

**Persisting the state (in Phase 5):**

After each topic is compiled, update `.compile-state.json`. Only update a topic's `plugin_version` and `skill_hash` when *that topic* actually recompiled — skipped topics keep their previous values, which is what preserves the compiler-change signal across scoped `--topic` runs.
```json
{
  "topics": {
    "gradient-routing": {
      "sources": ["Gradient Routing/OVERVIEW.md", "..."],
      "config_hash": "<hash>",
      "plugin_version": "2.1.0",
      "skill_hash": "<first 16 hex chars of SHA-256>",
      "last_compiled": "2026-04-20T12:34:56Z"
    }
  },
  "schema_hash": "<hash>"
}
```

This rule is important for a vault with many topics: only the ones that actually changed cost LLM tokens to recompile. A quiet day updates zero topics. A source deletion or a single `topics.<slug>.notes` entry only invalidates the one affected topic — but a plugin version bump or `SKILL.md` edit invalidates every topic the next time it's evaluated via step 3 above.

### Phase 1b: Image inventory

Also scan source directories for image files (`.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`). Record the full inventory — these will be presented to the LLM during topic compilation (Phase 3) so relevant figures can be embedded. Images that end up referenced in compiled articles are copied into `{output}/images/{topic-slug}/` in Phase 3b, preserving source subpath for disambiguation (e.g., `images/gradient-routing/spike-v3/runs/grmoe/samples/step_0040000.png`).

Exclude image directories the user wouldn't want surfaced (configured via `exclude` in `sources[]`).

### Codebase mode

1. For each entry in `sources[]`, scan for **knowledge files** matching `knowledge_files[]` patterns:
   - Documentation: `README.md`, `CLAUDE.md`, `AGENTS.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md`
   - API contracts: `*.proto`, `*.graphql`, `openapi.yaml`, `openapi.json`
   - Decision records: `ADR-*.md`, `docs/adr/*.md`
   - Infrastructure: `docker-compose.yml`, `Dockerfile`, `k8s/*.yaml`
   - Operations: `docs/runbooks/*.md`, `CHANGELOG.md`, `.env.example`
2. If `deep_scan` is `true`, also scan for key source files per topic area:
   - Entry points: `index.ts`, `main.py`, `main.go`, `lib.rs`, `App.swift`, etc.
   - Type definitions: `types.ts`, `models.py`, `schema.prisma`, `*.proto`
   - Config files: `package.json`, `tsconfig.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`
   - Limit to ~20 source files per topic area to control token cost
3. Exclude: `node_modules/`, `dist/`, `.git/`, `vendor/`, `__pycache__/`, `.build/`, `target/`, and configured `exclude` patterns
4. Read `.compile-state.json` and compare to identify new or changed files
5. On first run, treat ALL discovered files as new

## Phase 2: Classify and Discover Topics

### Knowledge mode (default)

1. For each source file, read its:
   - File path (directory structure is a strong signal)
   - Title (first `#` heading)
   - First 500 characters of content
2. Classify each file into one or more topics based on content signals
3. **Use `topic_hints` from config** as seed topics when available
4. **Prefer existing topic slugs** from `.compile-state.json` — avoid creating near-duplicates
5. A single file CAN belong to multiple topics
6. Files that don't match any topic: group them — if 3+ unclassified files share a theme, create a new topic
7. Topic slugs should be lowercase-kebab-case (e.g., `d1-retention`, `push-notifications`)

**Topic detection guidance:**
- Use directory names as strong signals (files in `retention/` likely belong to a retention topic)
- Use headings and key terms in content as secondary signals
- Meeting notes and session histories often belong to multiple topics
- Team memory files (gotchas, decisions, dead-ends) contain entries for many topics — classify by scanning content

### Codebase mode

Topic discovery uses a 3-pass approach: structure → knowledge → optional deep scan.

**Pass 1 — Structure scan (automatic topic discovery):**

1. Detect project type by looking for manifest files in the root:
   - `package.json` → Node.js/JavaScript/TypeScript
   - `go.mod` → Go
   - `Cargo.toml` → Rust
   - `pyproject.toml` / `requirements.txt` / `setup.py` → Python
   - `Gemfile` → Ruby
   - `*.sln` / `*.csproj` → .NET
   - `Package.swift` → Swift
   - `pom.xml` / `build.gradle` → Java/Kotlin

2. Detect monorepo vs single project:
   - **Monorepo/microservices:** Multiple directories each containing their own manifest file (e.g., `services/auth/package.json`, `services/billing/package.json`). Each service directory = a topic.
   - **Single project:** One manifest at root. Use top-level directory structure as topic boundaries (e.g., `src/auth/`, `src/api/`, `src/models/` each become topics).

3. Auto-create cross-cutting topics when relevant files exist:
   - `infrastructure` — if `docker-compose.yml`, `Dockerfile`, `k8s/`, `.github/workflows/` exist
   - `testing` — if `tests/`, `__tests__/`, `spec/`, `test/` directories exist
   - `deployment` — if CI/CD configs, Dockerfile, deployment scripts exist

**Pass 2 — Knowledge file scan (primary sources):**

For each topic area discovered in Pass 1:
1. Find all knowledge files (from `knowledge_files[]` config) within that topic's directory
2. Read each knowledge file's content — these are the primary sources for compilation
3. A knowledge file CAN belong to multiple topics (e.g., root `README.md` touches all topics)
4. Root-level knowledge files (`./README.md`, `./CLAUDE.md`, `./ARCHITECTURE.md`) contribute to ALL topics or get their own `project-overview` topic

**Pass 3 — Deep scan (optional, when `deep_scan: true`):**

For each topic area, also read key source files to enrich understanding:
1. **Entry points:** `index.ts`, `main.py`, `main.go`, `lib.rs`, `App.swift`, `app.py`
2. **Type definitions:** `types.ts`, `models.py`, `schema.prisma`, `*.proto`, `types.go`
3. **Route/API definitions:** `routes.ts`, `api.py`, `handlers.go`, `controller.ts`
4. **Config:** `package.json` (dependencies), `tsconfig.json`, language-specific config
5. Limit to ~20 files per topic to control token cost
6. These supplement knowledge files — they add implementation detail to the article's Architecture, API Surface, and Data sections

**Classification output** is identical to knowledge mode: topic slug → list of source files. The rest of the pipeline (Phases 3-5) runs unchanged.

**Topic slug conventions for codebases:**
- Service names: `auth-service`, `billing-service`, `notification-service`
- Module names: `auth`, `api-routes`, `data-layer`, `ui-components`
- Cross-cutting: `infrastructure`, `testing`, `deployment`, `shared-utils`

**Article template:** When `mode` is `codebase`, use `${CLAUDE_PLUGIN_ROOT}/templates/codebase-article-template.md` as the fallback template (instead of the default knowledge template). If `article_sections` is set in config, use those sections (same as knowledge mode).

## Phase 3: Compile Topic Hub Articles

For EACH topic that has new or changed source files (i.e. not skipped by the Incremental-skip decision above):

1. Read ALL source files classified under that topic (need full context, not just changed files)
2. Write the topic **hub article** to `{output}/topics/{topic-slug}.md`
3. **Determine article structure:**
   - If the active config file (`.wiki-compiler.yml`, or legacy `.wiki-compiler.json` if YAML isn't present) defines an `article_sections` array: use those sections in order. Each section's `description` field tells you what content belongs there.
   - If `article_sections` is absent: fall back to `${CLAUDE_PLUGIN_ROOT}/templates/article-template.md`
4. Fill every section with specific, factual content — no placeholders
5. **Lead** is a Wikipedia-style 1-3 paragraph intro. No preamble; start with the topic name bolded and its definition.
6. **Sources** lists every source file that contributed, using the configured link style

### Editorial directives from config (include in EVERY agent prompt)

Before dispatching a compile agent for a topic, assemble an **Editorial directives** section and include it near the top of the agent's prompt. Structure:

```
## Editorial directives

Global preferences (from .wiki-compiler.yml `preferences`):
- {preference 1}
- {preference 2}
...

Topic-specific directives for `{topic-slug}` (from `topics.{slug}.notes`):
- {note 1}
- {note 2}
...
```

If `preferences` is empty, omit the Global section. If the topic has no per-topic notes, omit the Topic-specific section. If both are empty, skip the whole Editorial directives block.

These directives carry the user's accumulated editorial voice — structural preferences, what to emphasize, what to leave out. Agents should treat them as non-negotiable unless they conflict with a hard rule below (in which case the hard rule wins and the agent reports the conflict).

### Writing rules for hub articles (enforce during compilation)

1. **No coverage tags** in section headings. Don't write `[coverage: high -- 5 sources]` or any variation. If coverage tracking is useful downstream, it lives in frontmatter metadata only, invisible to readers.
2. **No academic parenthetical citations.** Don't write `(Cloud et al., arxiv 2410.04332)` or `(Author, 2024)`. If citing a paper: either link to a paper note via `[[papers/{slug}]]` or use a clean markdown link to the external URL. Never inline the author-year parenthetical.
3. **Inline wikilinks everywhere.** Every mention of a sub-topic, experiment, decision, person, paper, organization, or concept that has its own source file or compiled sub-page must be an Obsidian `[[wikilink]]` in prose, not just listed in Sources. Wikipedia-dense linking.
4. **Hub sections are SHORT.** 2-4 paragraphs per section, not detail walls. When a section has a dedicated sub-article (from Phase 3a), end the section with a hatnote: `> **Main article:** [[topics/{topic}/{sub-slug}|Display name]]`.
5. **Encyclopedic tone.** Descriptive, present tense, third person. No "I", no "we". No temporal words in headings or titles (`New`, `Recent`, `Current`, `Latest`) — these go stale.
6. **Embed images** when source material includes relevant figures. Reference images at `../images/{topic-slug}/{filename}` (Phase 3b handles the copy). At least one image per article when any exist in source material.
7. **Frontmatter source field.** Include `source: {relative path from vault root}` pointing to the single best primary source note. This drives the "Edit in Obsidian" link rendered by Quartz.

**Lead-paragraph discipline.** The very first paragraph under the H1 is the article's *lead* and carries the single most important stylistic constraint. Open with the bolded topic name as the grammatical subject of a present-tense definitional sentence — no framing preamble, no "this page covers…", no hedging. The entire lead (every paragraph before the first `##` heading) is capped at 150 words; when the draft spills past that, move the excess into a section and leave a tight summary upstairs. The templates in `plugin/templates/` encode this as rule 7 of the writing-rules comment; this paragraph is a deliberate reinforcement — the rule is load-bearing for the Wikipedia feel and easy to drift from.

### Link style
- `obsidian`: Use `[[relative/path/to/file]]` (without .md extension)
- `markdown`: Use `[filename](relative/path/to/file.md)`

Relative paths from the `topics/` directory to the source file. For files in the vault root: `[[../../filename]]`. For sub-pages under this topic: `[[{topic-slug}/{sub-slug}]]`.

**Parallel compilation:** When possible, compile multiple topic articles in parallel using subagents. Each subagent gets one topic + its source files + the image inventory. This significantly speeds up first-run compilation.

**IMPORTANT — Sequencing:** Parallel dispatch is ONLY for Phase 3 (topic hub articles). After ALL parallel agents have returned, the PARENT process MUST continue to Phase 3a (sub-article compilation), then 3b (image copy), then 3.5 (concepts), 3.7 (schema), 4 (INDEX), 5 (state + log). Do NOT end the compilation after Phase 3.

## Phase 3a: Compile Sub-Articles (Hub-and-Spoke)

After the hub article for a topic is compiled, identify natural **sub-topic clusters** within the topic's source files and compile a sub-article for each. Sub-articles live at `{output}/topics/{topic-slug}/{sub-slug}.md`.

### Identifying sub-articles

The default rule: **every substantial standalone source file (≳100 lines of self-contained content) gets its own sub-page**, unless it's clearly a variant of another file. Don't filter by what *kind* of unit the file is — filter by whether it carries a coherent, sub-page-sized argument that a reader would want to land on directly.

Specifically, sub-pages should be created for:
- Individual named experiments (e.g., a `spike-v3/` directory, a `flux-klein-v01-design.md` file)
- **Every individual decision record** (`decisions/*.md`, `ADR-*.md`, `docs/adr/*.md` — one sub-page per decision, even short ones; use the file basename without the `.md` extension as the sub-slug, regardless of whether the basename is dated, numbered, or named). If a decision file's basename would produce a sub-slug that collides with any other sub-page slug in the same topic — whether another decision or a non-decision sub-page — disambiguate by walking up the file's path one directory at a time and prefixing each ancestor (joined with `-`, lowercase, kebab-cased) until the resulting sub-slug is unique against the topic's full sub-page slug set. Examples: `decisions/auth.md` vs `docs/adr/auth.md` → `decisions-auth` and `adr-auth`; `service-a/decisions/auth.md` vs `service-b/decisions/auth.md` → `service-a-decisions-auth` and `service-b-decisions-auth`. Continue walking up until uniqueness is achieved (no fixed prefix depth). Decisions are the load-bearing why-records of the project and must remain individually addressable, and no decision may be silently overwritten by another.
- Individual concept notes (`concepts/*.md` — one sub-page per concept)
- Named tracks / workstreams (a group of related files covering one research track)
- **Cross-cutting design, rationale, reference, and strategy documents** that span multiple units (e.g., a `proxy-experiment-design.md` covering V01–V05, a `dataset-strategy.md`, a `training-cost-reference.md`). These are the easiest category to miss because they don't slot into the named-unit categories above — but they're often the most reused parts of the wiki. If the file reads like a Wikipedia reference article in its own right, it gets a sub-page.

Merge related files into one sub-article in two cases: (a) when files are clearly variants of the same thing (e.g., `nand-routing-spike-v4-design.md` and `nand-routing-spike-v4_1-design.md` → one `spike-v4` sub-page), or (b) when files are complementary parts of a single named track or workstream that warrants one consolidated sub-page (e.g., a track's `design.md`, `evaluation.md`, and `rollout.md` → one track sub-page). Do NOT merge files that are independent enough to stand on their own — bias toward more sub-pages, not fewer; a substantial file folded into a hub section becomes invisible. One-paragraph stubs (≲30 lines with no real content beyond a pointer) can be linked inline from the hub instead.

Target: 5–20 sub-articles per topic depending on topic size. Erring on the high side is fine — sub-pages are cheap, and missed pages are expensive (the content stops being findable). The substance-based rule above is sufficient on its own; do not skip sub-pages for a topic just because it has few source files. A topic with three substantial 150-line design docs gets three sub-pages; a topic whose only source files are short non-decision stubs naturally produces zero sub-pages and is linked from the hub directly. Decision records are exempt from the short-stub exclusion — every file matching any of the decision discovery patterns above (`decisions/*.md`, `ADR-*.md`, `docs/adr/*.md`) gets its own sub-page regardless of length, per the rule above.

### Writing sub-articles

1. Use the sub-article template at `${CLAUDE_PLUGIN_ROOT}/templates/sub-article-template.md`
2. A sub-article is a **polished, consolidated, Wikipedia-style rewrite** of the source cluster — not a summary, not a copy. Preserve all technical content: numbers, tables, code blocks, results.
3. Same writing rules as hub articles (no coverage tags, no academic parentheticals, inline wikilinks, encyclopedic tone, embed images).
4. Link back to the parent topic via `[[topics/{parent-topic}]]` in the lead.
5. Link sibling sub-pages when referenced: `[[topics/{parent}/{sibling-slug}]]`.
6. Frontmatter must include `topic`, `sub_page`, `source` (primary source path for Edit button), and `sources` (list of all contributing paths).

### Updating the hub

After sub-articles are compiled, update the hub article's frontmatter `sub_pages: []` with the list of sub-slugs, and ensure every sub-article is referenced somewhere in the hub prose (via wikilink or hatnote).

## Phase 3b: Copy referenced images into wiki/images/

After hub + sub-articles are compiled for a topic:

1. Parse all image references in the compiled markdown (both hub and sub-articles)
2. For each referenced image, locate the original in the source directory inventory from Phase 1b
3. Copy the original to `{output}/images/{topic-slug}/{preserved-subpath}/{filename}`
4. Verify the reference path in the compiled articles matches the copied location

Never modify source images. Copy only; don't move or symlink (Quartz needs real files for its build).

If a referenced image can't be found in the inventory, log a warning and leave the reference in place (the broken image makes the gap visible rather than hiding it).

**Link style:**
- `obsidian`: Use `[[relative/path/to/file]]` (without .md extension)
- `markdown`: Use `[filename](relative/path/to/file.md)`

Relative paths should be from the `topics/` directory to the source file.

**Parallel compilation:** When possible, compile multiple topic articles in parallel using subagents. Each subagent gets one topic + its source files. This significantly speeds up first-run compilation.

**IMPORTANT — Sequencing:** Parallel dispatch is ONLY for Phase 3 (topic article compilation). After ALL parallel agents have returned and all topic articles are written, the PARENT process MUST continue to Phase 3.5 (concept discovery). Do NOT end the compilation after Phase 3. The remaining phases (3.5, 3.7, 4, 5) run sequentially in the parent process after parallel compilation completes.

## Phase 3.5: Discover and Compile Concept Articles

**This phase MUST run after Phase 3 completes.** Read the topic articles that were just compiled and look for cross-cutting patterns. These become **concept articles** -- stored in `{output}/concepts/`.

**How to discover concepts:**

1. Read all topic articles that were just compiled (or all if first run)
2. Look for patterns that appear in 3+ topic articles:
   - **Recurring decisions** -- the same tradeoff appearing in different contexts (e.g., "speed vs quality" showing up in retention decisions, push notification strategy, and experiment design)
   - **Relationship patterns** -- a person, team, or stakeholder who appears across multiple topics with consistent dynamics
   - **Methodology evolution** -- how an approach changed over time across topics (e.g., "how we measure retention" evolving from n-day to bracket)
   - **Recurring failures** -- the same type of mistake across different domains (e.g., "trusting aggregated data without checking raw events")
3. Check `schema.md` for existing concepts -- prefer updating existing concept articles over creating new ones
4. Only create a concept if it genuinely connects 3+ topics with a non-obvious insight. Don't force concepts.

**Concept article format:**

Write to `{output}/concepts/{concept-slug}.md`:

```markdown
---
title: {Concept Name}
concept: {Concept Name}
last_compiled: {YYYY-MM-DD}
topics_connected: [{topic1}, {topic2}, {topic3}]
status: active
---

## Pattern
{1-2 paragraphs describing the cross-cutting pattern. What keeps recurring and why.}

## Instances
{Each time this pattern appeared, with dates and context}
- **{date}** in [[../topics/{topic}]]: {what happened}
- **{date}** in [[../topics/{topic}]]: {what happened}

## What This Means
{Synthesis -- what the pattern tells you about your work, decisions, or blind spots.
This is the "so what" that Farzapedia calls the writer's job.}

## Sources
- [[../topics/{topic1}]]
- [[../topics/{topic2}]]
```

**Important:** Concept articles are interpretive, not just factual. They answer "what does this pattern mean?" not just "what happened?" This is what makes them useful for strategic and creative thinking.

**Create the concepts/ directory** if it doesn't exist.

## Phase 3.7: Generate or Update Schema

If `{output}/schema.md` does not exist (first run):
1. Generate it from `${CLAUDE_PLUGIN_ROOT}/templates/schema-template.md`
2. Fill in the Topics section AND Concepts section with all discovered slugs and descriptions
3. Add an Evolution Log entry: "{today's date}: Initial schema generated from {N} topics, {N} concepts"

If `{output}/schema.md` already exists:
1. Read it BEFORE Phase 2 (classification) -- use its topic list, concept list, and naming conventions
2. After Phase 3.5 (concepts), check for new topics and concepts not in the schema
3. Add any new topics/concepts to the schema
4. Add an Evolution Log entry if anything was added: "{today's date}: Added {slug} -- {reason}"
5. Never remove topics or concepts from schema without human approval -- flag them as candidates instead

The schema is the source of truth for wiki structure. The human can edit it between compiles to rename topics, merge them, or change conventions. The compiler respects those changes.

## Phase 4: Update index.md

Write to `{output}/index.md`:

```markdown
---
title: {name} Knowledge Base
---

Last compiled: {today's date}
Total topics: {count} | Total sources: {unique file count}

## Topics

| Topic | Also Known As | Sources | Last Updated | Status |
|-------|--------------|---------|-------------|--------|
| [[topics/{slug}]] | {keyword aliases} | {count} | {date} | active |

## Concepts

| Concept | Connects | Last Updated |
|---------|----------|-------------|
| [[concepts/{slug}]] | {topic1}, {topic2}, {topic3} | {date} |

## Recent Changes
- {date}: {what changed in this compilation run}
```

**Keyword aliases:** For each topic, include alternate names, abbreviations, and related terms that someone might search for. For example, a topic called `side-quest-ideas` might have aliases "FitOS, Growth OS, Paperclip, ClawShip". These help `/wiki-search` and Claude find the right topic even when the user uses different terminology.

**Concepts section:** List all concept articles with the topics they connect. If no concepts exist yet, omit this section.

Always regenerate index.md, even if no topics changed (it's cheap).

## Phase 5: Update State and Log

1. **Log** — Append to `{output}/log.md`:
```markdown
## {today's date}

**Topics updated:** {list}
**New topics:** {list or "none"}
**Sources scanned:** {count}
**Sources changed:** {count}
```

2. **Compile state** — Update `{output}/.compile-state.json`. Per-topic tracking is required for the incremental-skip decision:
```json
{
  "last_compiled": "{today's date}",
  "topics": {
    "{slug1}": {
      "sources": ["{path1}", "{path2}", ...],
      "config_hash": "{hash of preferences + topics.slug1 subtree used this compile}",
      "plugin_version": "{version field from plugin.json when this topic was last compiled}",
      "skill_hash": "{first 16 hex chars of SHA-256 of SKILL.md when this topic was last compiled}",
      "last_compiled": "{ISO timestamp}"
    }
  },
  "schema_hash": "{hash of schema-level config — article_sections, mode, output, link_style — used this compile}",
  "source_locations": ["{path1}", "{path2}", ...],
  "total_sources_scanned": {count}
}
```

For topics that were skipped in this run, preserve their existing entry unchanged — including their `plugin_version` and `skill_hash`, which is what makes the compiler-change signal survive a `--topic` scoped run. For topics that recompiled, update `sources`, `config_hash`, `plugin_version`, `skill_hash`, and `last_compiled` to the current values. For topics no longer present (removed from schema by user), remove their entry.

## Phase 6: Generate CONTEXT.md (codebase mode only, first run)

On the **first compile** (no prior `topics` entries in `.compile-state.json` — either because the file doesn't exist or because `/wiki-init` just created it in an empty state), generate `{output}/CONTEXT.md`:

```markdown
---
title: Codebase Wiki — Navigation Guide
---

This project has a compiled knowledge wiki. Use it instead of scanning raw files.

## How to use this wiki

1. Start at index.md — scan the topic table to find relevant modules
2. Read 1-3 topic hub articles relevant to your current task
3. Follow sub-article links for detail when the hub section has a `**Main article:**` hatnote
4. Check concepts/ for cross-cutting patterns (auth strategy, error handling, etc.)
5. Only read raw source files when you need code-level detail

## When NOT to use the wiki
- Writing new code (read the actual source files for exact syntax/types)
- Debugging a specific function (go to the file directly)

## Stats
Compiled: {date} | Topics: {N} | Sources: {M} | Auto-updates on session start
```

On subsequent compiles, update the Stats line in CONTEXT.md.

After generating CONTEXT.md, **ask the user** (don't auto-modify): "Want me to add a reference to `wiki/CONTEXT.md` in your CLAUDE.md? This helps the agent discover the wiki automatically."

## Output

After compilation, show a summary to the user:
- Topics created/updated (with article line counts)
- Topics skipped as unchanged (mtime-based)
- Total sources scanned
- Any files that couldn't be classified
- Any suggested new topics for next run
- If the compiler-change check (incremental-skip step 3) caused every topic to recompile, call it out explicitly: "Compiler updated since last compile (v{old} → v{new}) — every topic was re-evaluated under the new rules."
- If the compiler changed but `--topic <slug>` restricted the run, warn: "Compiler updated, but `--topic` limited the run to `{slug}` — other topics remain on old rules. Run `/wiki-compile` (without `--topic`) to propagate."
- Time taken

## Learning from user feedback

Wiki pages are never edited directly by the user. All editorial influence flows through two channels: (1) changes to source notes, and (2) directives in `.wiki-compiler.yml`. Part of this skill's job is to keep the config in sync with the user's taste.

**When to update the config:**

When the user gives editorial feedback about wiki output in conversation — e.g. "that ablation table should always be in spike-v3," "drop the academic parens style in ai-policy," "lead gradient-routing with the image" — treat it as a config update request. Offer:

```
Want me to add this to .wiki-compiler.yml so it's remembered?
  - Topic-specific:   topics.gradient-routing.notes += "Lead the hub with the spike-v3 ablation image."
  - Or global:        preferences += "Lead hub articles with a representative image when available."
```

Ask which scope (topic-specific vs global) the user intends if it's ambiguous.

**After updating the config:**

1. Append the new directive to the relevant section of `.wiki-compiler.yml`
2. Bump the config's mtime (it happens automatically via the write)
3. Offer to recompile just the affected topic: `/wiki-compile --topic <slug>`
4. If global, offer a full `/wiki-compile --force` but note the token cost

**What to avoid:**

- Don't auto-edit the config without asking — user should approve each directive.
- Don't silently drop old directives. If a new directive contradicts an existing one, flag the conflict and ask the user to resolve.
- Don't use the config for transient debugging directives ("just for this compile, also include X"). Those should be one-off agent instructions, not persisted.

This loop — feedback → config → recompile — is the core UX. Over time, `.wiki-compiler.yml` becomes a living record of editorial preferences, and future compiles reproduce the user's voice without needing to re-explain it.
