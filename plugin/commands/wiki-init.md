# Initialize Knowledge Base Wiki

Interactive, conversational setup for a new knowledge base wiki. One question at a time, multiple choice when possible.

**Arguments:**
- (none) — auto-detects whether this is a codebase or knowledge project (see Auto-Detection below)
- `--codebase` — force codebase mode (skip auto-detection)
- `--knowledge` — force knowledge mode (skip auto-detection)

## Instructions

**Important:** Ask ONE question per message. Wait for the user's response before moving to the next question. Never batch multiple questions. Keep the tone conversational — like a knowledgeable colleague setting things up for you.

---

## Auto-Detection (when no flag is provided)

Before asking any questions, scan the project root to determine the mode:

1. **Check for code manifest files:** `package.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`, `requirements.txt`, `Gemfile`, `*.sln`, `Package.swift`, `pom.xml`, `build.gradle`
2. **Check for markdown-heavy directories:** `Knowledge/`, `docs/`, `notes/`, `content/`, `meetings/`, `research/`, or any directory with 10+ `.md` files

**Decision logic:**
- **Manifest found, no markdown directories** → codebase mode
- **Markdown directories found, no manifest** → knowledge mode
- **Both found** → ask the user:
  ```
  I see both code files and markdown knowledge directories here.
  
  A) Codebase wiki — compile a wiki about this codebase's architecture, decisions, and patterns
  B) Knowledge wiki — compile a wiki from your markdown files (meetings, notes, research)
  ```
- **Neither found** → ask the user what they want to compile

Then proceed to the appropriate mode below.

---

## Codebase Mode (`--codebase` or auto-detected)

When codebase mode is selected, use this streamlined flow instead of the standard 10-step process.

### Codebase Step 1: Check for existing config

Same as standard Step 1 — check for `.wiki-compiler.yml` and ask to reconfigure or abort.

### Codebase Step 2: Auto-detect everything

Scan the project root and build a complete picture in one pass:

1. **Detect project type** by looking for manifest files:
   - `package.json` → Node.js/TypeScript
   - `go.mod` → Go
   - `Cargo.toml` → Rust
   - `pyproject.toml` / `requirements.txt` → Python
   - `Gemfile` → Ruby
   - `*.sln` → .NET
   - `Package.swift` → Swift
   - `pom.xml` / `build.gradle` → Java/Kotlin
   - Multiple manifests in subdirectories → Monorepo

2. **Discover topic candidates:**
   - Monorepo: each directory with its own manifest = a topic
   - Single project: major subdirectories under `src/`, `lib/`, `app/`, or root = topics
   - Cross-cutting topics: `infrastructure` (if Docker/CI exists), `testing` (if test dirs exist), `deployment` (if k8s/deploy scripts exist)

3. **Count knowledge files** matching default patterns:
   - `README.md`, `CLAUDE.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md`
   - `*.proto`, `*.graphql`, `openapi.*`
   - `ADR-*.md`, `docs/adr/*.md`
   - `docker-compose.yml`, `Dockerfile`
   - `CHANGELOG.md`, `.env.example`

4. **Auto-detect project name** from `package.json` `name` field, `go.mod` module name, directory name, or git remote.

### Codebase Step 3: One confirmation prompt

Present everything in a single confirmation:

```
📚 I see a {project_type} project with {N} modules and {M} knowledge files.

  Topics: {topic1}, {topic2}, {topic3}, ...
  Sections: Purpose, Architecture, Talks To, API Surface, Data, Key Decisions, Gotchas
  Output: wiki/

A) Looks good — create config and compile now (recommended)
B) Customize — let me adjust topics, sections, or settings
C) Not now
```

If A: create config (Codebase Step 4) and immediately run `/wiki-compile`.
If B: fall through to the standard interactive flow (Step 2 onwards) but with codebase defaults pre-filled.
If C: exit.

### Codebase Step 4: Create configuration

Write `.wiki-compiler.yml`:

```yaml
version: 2
mode: codebase
name: "{auto_detected_name}"
sources:
  - path: "./"
    exclude:
      ["node_modules/", "dist/", ".git/", "wiki/", "vendor/", "__pycache__/",
       ".build/", "target/", ".next/", "coverage/"]
output: wiki/
service_discovery: auto
knowledge_files:
  - "README.md"
  - "CLAUDE.md"
  - "AGENTS.md"
  - "ARCHITECTURE.md"
  - "CONTRIBUTING.md"
  - "*.proto"
  - "*.graphql"
  - "openapi.yaml"
  - "openapi.json"
  - "ADR-*.md"
  - "docs/adr/*.md"
  - "docker-compose.yml"
  - "Dockerfile"
  - ".env.example"
  - "CHANGELOG.md"
deep_scan: false
auto_update: prompt
link_style: markdown
preferences: []
topics: {}
article_sections:
  - name: Purpose
    description: What this module/service does and who depends on it
    required: true
  - name: Architecture
    description: "Key files, structure, entry points"
  - name: Talks To
    description: "Dependencies, communication patterns, inter-service calls"
  - name: API Surface
    description: "Endpoints, exported functions, or interfaces exposed"
  - name: Data
    description: "Tables, collections, queues, caches, state owned"
  - name: Key Decisions
    description: "Why it was built this way, from ADRs and READMEs"
  - name: Gotchas
    description: "Known issues, edge cases, failure modes"
  - name: Sources
    description: Backlinks to all contributing files
    required: true
```

### Codebase Step 5: Create output directory and compile

1. Create `wiki/`, `wiki/topics/`, `wiki/concepts/` directories
2. Create empty `wiki/.compile-state.json`
3. Create empty `wiki/log.md`
4. Run the wiki-compiler skill (all 6 phases including CONTEXT.md generation)
5. Show the first-compile summary with topic tree

### Codebase Step 6: Done

```
📚 Wiki compiled — {N} topics from {M} files

  Topics created:
  ├── {topic1} ({count} sources) — {one-line description}
  ├── {topic2} ({count} sources) — {one-line description}
  └── {topic3} ({count} sources) — {one-line description}

  Concepts discovered:
  └── {concept1} — {description}

  Browse: wiki/index.md
  Navigation guide: wiki/CONTEXT.md

Want me to add a reference to wiki/CONTEXT.md in your CLAUDE.md?
```

---

## Knowledge Mode (`--knowledge` or auto-detected)

### Step 1: Check for existing config

Look for `.wiki-compiler.yml` in the current project root. If it exists:

```
You already have a wiki configured for "{name}" ({topic_count} topics, last compiled {date}).

A) Reconfigure from scratch
B) Keep current setup (abort)
```

If B, exit. If A, continue.

### Step 2: Welcome + auto-detect

Scan the project for markdown-heavy directories. Look for:
- Directories named `Knowledge/`, `docs/`, `notes/`, `content/`, `meetings/`, `research/`
- Any directory containing 10+ `.md` files
- Exclude: `node_modules/`, `.git/`, `wiki/`, `build/`, `dist/`

Present findings conversationally:

```
Welcome to Wikiforge. I'll get you set up in about 5 questions.

I found {count} markdown files across your project:

  {dir1}/  — {count} files
  {dir2}/  — {count} files
  {dir3}/  — {count} files

Which directories should I compile into your wiki?

A) All of the above (recommended)
B) Let me pick — show me the list
C) I'll type the paths myself
```

Wait for response. If B, show checkboxes. If C, ask for paths.

### Step 3: Name

```
Got it, {count} directories selected. What should I call this knowledge base?

A) "{auto_detected_name}" (based on your project name)
B) Let me type a name
```

Wait for response.

### Step 4: Output location

```
Where should the compiled wiki live?

A) {first_source}/wiki/ (recommended — keeps it near your sources)
B) docs/wiki/
C) Let me pick a different path
```

Wait for response.

### Step 5: Sample files and propose article structure

Now read 10-15 representative `.md` files from the confirmed source directories:
- Pick files from different subdirectories for breadth
- Read the first ~500 characters + the title (first `#` heading) of each
- Note what kinds of content you're seeing

Based on what you found, generate 5-8 article sections that fit the domain. Then present:

```
I sampled {N} of your files. Looks like you have {description of content types}.

Here's the article structure I'd suggest for your wiki:

  1. Summary — standalone briefing of the topic
  2. {section} — {description}
  3. {section} — {description}
  4. {section} — {description}
  5. {section} — {description}
  6. Sources — backlinks to all contributing files

A) Looks good, use this (recommended)
B) I want to add or remove sections
C) Regenerate — try a different structure
```

If B, ask which sections to add/remove/rename. If C, regenerate with different emphasis.

Rules for section generation:
- **Always include `Summary` first and `Sources` last** — these are universal
- Middle sections are domain-specific — match the actual content patterns observed
- Examples of what the LLM might propose by domain:
  - **Product/growth:** Timeline, Current State, Key Decisions, Experiments & Results, Gotchas, Open Questions
  - **Research:** Key Findings, Methodology, Evidence, Gaps & Contradictions, Open Questions
  - **Personal journal:** Themes & Patterns, Progress, Reflections, Action Items
  - **Book notes:** Characters, Themes, Plot Threads, Connections, Quotes
  - **Technical docs:** Architecture, API Surface, Dependencies, Known Issues, Migration Notes
  - **Business/team:** Stakeholders, Decisions, Action Items, Meeting History, Open Threads

### Step 6: Wiki mode

```
Almost done. How should the wiki integrate with your workflow?

A) Staging — wiki supplements your existing setup, no changes needed (recommended for first-time)
B) Recommended — Claude reads wiki before raw files
C) Primary — wiki is the main knowledge source, raw files only for detail

You can change this anytime in .wiki-compiler.yml.
```

Wait for response.

### Step 7: Stale detection

```
Last question. Want me to warn you when your wiki is out of date?

If source files change after a compile, the plugin can flag it at session start:
"Wiki may be stale — 12 files changed. Run /wiki-compile to update."

A) Yes, warn me (recommended)
B) No thanks, I'll compile manually
```

If A, set `auto_update` to `"prompt"`. If B, set to `"off"`.

### Step 8: Create configuration

Write `.wiki-compiler.yml` to the project root:

```yaml
version: 2
name: "{name}"
mode: "{selected_mode}"
sources:
  - path: "{path1}/"
    exclude: ["wiki/"]
  - path: "{path2}/"
output: "{output_path}/"
auto_update: "{selected_auto_update}"
link_style: obsidian
topic_hints: []
# Global editorial preferences applied to every topic compile. Populate as
# you build up editorial taste; empty is fine on first init.
preferences: []
# Per-topic overrides and directives. Populate as you notice editorial
# patterns you want the compiler to remember. Example:
#   topics:
#     gradient-routing:
#       sources: ["Gradient Routing/**"]
#       exclude: ["Untitled*.md"]
#       notes:
#         - Keep the ablation table in spike-v3 prominent.
topics: {}
article_sections:
  - name: Summary
    description: "{description}"
    required: true
  - name: "{section2}"
    description: "{description}"
  - name: "{section3}"
    description: "{description}"
  - name: "{section4}"
    description: "{description}"
  - name: "{section5}"
    description: "{description}"
  - name: Sources
    description: "backlinks to all contributing source files"
    required: true
```

### Step 9: Create output directory

Create:
- `{output}/` directory
- `{output}/topics/` directory
- `{output}/.compile-state.json` with initial empty state
- `{output}/compile-log.md` with initial empty log

### Step 10: Done

```
Wiki initialized for "{name}"

  Sources:    {count} directories, ~{file_count} markdown files
  Output:     {output_path}
  Structure:  {section_count} sections ({section names})
  Mode:       {mode}
  Stale warnings: {on/off}

Next steps:
  1. Run /wiki-compile to build your first compilation (5-10 min)
  2. Open {output_path}/index.md in Obsidian to browse
  3. After compiling, run /wiki-migrate to switch your AGENTS.md to wiki-first

Edit .wiki-compiler.yml anytime to adjust settings.
```
