# Compile Knowledge Base Wiki

Compile all configured markdown source files into a topic-based wiki.

## Instructions

1. **Read configuration** from `.wiki-compiler.yml` at the project root. If the file doesn't exist, offer to run `/wiki-init` now; only bail if the user declines. If they accept, run init inline, then continue with the compile — **unless init already compiled** (codebase mode Step 3 option A, in `plugin/commands/wiki-init.md`, creates the config and runs `/wiki-compile` as part of its own flow). In that case, surface init's compile summary and stop here rather than re-running the same compile.

2. **Validate configuration:**
   - `sources[]` must have at least one entry
   - `output` must be set
   - Source paths must exist

3. **Read schema** from `{output}/schema.md` if it exists. Use it to guide topic/concept classification and naming. If it doesn't exist (first run), it will be generated in Phase 3.7.

4. **Decide compile mode.** If the user passed `--force`, `--topic {slug}`, or `--dry-run` explicitly, use that and skip the question below. Otherwise — including conversational invocations like "compile the wiki" with no specified scope — **ask the user before proceeding**:

   > Incremental or full rebuild?
   > - **Incremental** (default): only recompile topics whose sources changed since the last run. Fast, cheap.
   > - **Full rebuild** (`--force`): recompile every topic. Use this when compiler logic or editorial preferences changed, or when you want all topics re-evaluated under the current rules.

   Wait for the user's answer before invoking the skill. Skip this question only when:
   - (a) **No prior compile.** Either `.compile-state.json` doesn't exist, or it exists but has no `topics` entries (`/wiki-init` creates the file in this empty state). Proceed directly — the first compile is always full, and there's nothing meaningful for "incremental" to compare against. Don't frame it as a compiler-update either; just run it.
   - (b) **Compiler updated since the last compile.** At least one topic in `.compile-state.json` has a stored `compiler_hash` that differs from the current value (or is missing — older state from before the `compiler_hash` field was introduced). Proceed without asking and tell the user: "The compiler's instructions changed since the last compile; every topic with a mismatched stored hash will be re-evaluated under the new rules." (Each topic's own skip decision still decides RECOMPILE vs SKIP, so topics whose stored hash already matches the new compiler — e.g. from a recent `--topic` run — correctly skip.)

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
