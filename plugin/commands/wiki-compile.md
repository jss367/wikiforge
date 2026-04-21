# Compile Knowledge Base Wiki

Compile all configured markdown source files into a topic-based wiki.

## Instructions

1. **Read configuration.** Prefer `.wiki-compiler.yml` at the project root. If only `.wiki-compiler.json` exists, migrate it (parse, re-emit as YAML, delete the JSON) — **except in dry-run mode**, where the migration is reported as a pending action but no files are written or deleted. If neither config file exists, tell the user to run `/wiki-init` first.

2. **Validate configuration:**
   - `sources[]` must have at least one entry
   - `output` must be set
   - Source paths must exist

3. **Read schema** from `{output}/schema.md` if it exists. Use it to guide topic/concept classification and naming. If it doesn't exist (first run), it will be generated in Phase 3.7.

4. **Invoke the `wiki-compiler` skill** to run the compilation:
   - Pass `article_sections`, `preferences`, and per-topic directives (`topics.<slug>.notes`) from config to the skill
   - Phase 1: Scan sources (markdown + image inventory)
   - Phase 2: Classify and discover topics (respecting schema and `topics.<slug>.sources` overrides if present)
   - Phase 2.5 (incremental-skip decision): for each topic, skip if no source is newer than the compiled hub, unless `--force` or `--topic <slug>` is set, or config changed since last compile
   - Phase 3: Compile topic hub articles using `article_sections` for structure and `preferences` + topic notes as editorial directives (use parallel agents when possible)
   - Phase 3a: Compile sub-articles under topics/{topic}/ for each natural source cluster
   - Phase 3b: Copy referenced images into wiki/images/{topic-slug}/
   - Phase 3.5: Discover and compile concept articles (cross-cutting patterns)
   - Phase 3.7: Generate or update schema.md
   - Phase 4: Update index.md (includes concepts section)
   - Phase 5: Update state and log

5. **Show completion summary** with topics compiled, topics skipped as unchanged, concepts discovered, source count, and schema changes.

## Arguments

- No arguments: incremental compilation — recompile topics whose sources changed since last compile
- `--force`: recompile all topics regardless of mtimes (still respects `exclude` rules)
- `--topic {slug}`: recompile only the specified topic (bypasses incremental skip)
- `--dry-run`: show what would be compiled without writing files
