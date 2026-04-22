# Compile Knowledge Base Wiki

Compile all configured markdown source files into a topic-based wiki.

## Instructions

1. **Read configuration.** Prefer `.wiki-compiler.yml` at the project root. If only `.wiki-compiler.json` exists, migrate it (parse, re-emit as YAML, delete the JSON) — **except in dry-run mode**, where the migration is reported as a pending action but no files are written or deleted. If neither config file exists, tell the user to run `/wiki-init` first.

2. **Validate configuration:**
   - `sources[]` must have at least one entry
   - `output` must be set
   - Source paths must exist

3. **Read schema** from `{output}/schema.md` if it exists. Use it to guide topic/concept classification and naming. If it doesn't exist (first run), it will be generated in Phase 3.7.

4. **Decide compile mode.** If the user passed `--force`, `--topic {slug}`, or `--dry-run` explicitly, use that and skip the question below. Otherwise — including conversational invocations like "compile the wiki" with no specified scope — **ask the user before proceeding**:

   > Incremental or full rebuild?
   > - **Incremental** (default): only recompile topics whose sources changed since the last run. Fast, cheap.
   > - **Full rebuild** (`--force`): recompile every topic. Use this when compiler logic or editorial preferences changed, or when you want all topics re-evaluated under the current rules.

   Wait for the user's answer before invoking the skill. Skip this question only when: (a) `.compile-state.json` doesn't exist (first run is always full), or (b) the current plugin version or skill hash doesn't match any topic's stored values in `.compile-state.json` — in that case proceed directly without asking and tell the user: "The compiler's instructions changed since the last compile; every topic with a mismatched stored version will be re-evaluated under the new rules." (Each topic's own skip decision still decides RECOMPILE vs SKIP, so topics whose stored values already match the new compiler — e.g. from a recent `--topic` run — correctly skip.)

5. **Invoke the `wiki-compiler` skill** to run the compilation:
   - Pass `article_sections`, `preferences`, and per-topic directives (`topics.<slug>.notes`) from config to the skill
   - Phase 1: Scan sources (markdown + image inventory)
   - Phase 2: Classify and discover topics (respecting schema and `topics.<slug>.sources` overrides if present)
   - Phase 2.5 (incremental-skip decision): for each topic, skip if no source is newer than the compiled hub, unless `--force` or `--topic <slug>` is set, config changed since last compile, or the compiler's own version/instructions changed
   - Phase 3: Compile topic hub articles using `article_sections` for structure and `preferences` + topic notes as editorial directives (use parallel agents when possible)
   - Phase 3a: Compile sub-articles under topics/{topic}/ for each natural source cluster
   - Phase 3b: Copy referenced images into wiki/images/{topic-slug}/
   - Phase 3.5: Discover and compile concept articles (cross-cutting patterns)
   - Phase 3.7: Generate or update schema.md
   - Phase 4: Update index.md (includes concepts section)
   - Phase 5: Update state and log

6. **Show completion summary** with topics compiled, topics skipped as unchanged, concepts discovered, source count, and schema changes. If a full rebuild was triggered automatically by a compiler-version change, surface that explicitly in the summary.

## Arguments

- No arguments: ask the user whether they want incremental or full rebuild (unless the compiler version changed since the last compile, in which case a full rebuild runs automatically)
- `--force`: recompile all topics regardless of mtimes (still respects `exclude` rules); skips the incremental-vs-full prompt
- `--topic {slug}`: recompile only the specified topic (bypasses incremental skip); skips the incremental-vs-full prompt
- `--dry-run`: show what would be compiled without writing files; skips the incremental-vs-full prompt
