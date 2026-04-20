<!-- CODEBASE TEMPLATE: Used when mode is "codebase" in .wiki-compiler.json.
     Designed for code modules, services, and infrastructure components.
     New codebase projects get custom sections generated during /wiki-init --codebase. -->

---
topic: {Module/Service Name}
type: codebase
last_compiled: {YYYY-MM-DD}
source_count: {number}
status: active
---

# {Module/Service Name}

## Purpose [coverage: {high|medium|low} -- {N} sources]
{What this module/service does in one paragraph.
Written as a briefing -- someone reading just this should understand
what this code is for without reading any source file.
Be specific about what problems it solves and who depends on it.}

## Architecture [coverage: {high|medium|low} -- {N} sources]
{How it's structured internally. Key files, entry points, major classes/functions.
Include the directory layout if it helps understanding.}

Key files:
- `path/to/entry.ts` -- {role}
- `path/to/core.ts` -- {role}

## Talks To [coverage: {high|medium|low} -- {N} sources]
{Dependencies and communication patterns with other modules/services.}
- **{other-module}** ({protocol}: {endpoint/queue/event}) -- {why}

## API Surface [coverage: {high|medium|low} -- {N} sources]
{Key endpoints, exported functions, or interfaces this module exposes.
Focus on what consumers need to know, not exhaustive listings.}

## Data [coverage: {high|medium|low} -- {N} sources]
{What this module owns: database tables, collections, queues, caches, state.
Include schema shape if known from migrations or type definitions.}

## Key Decisions [coverage: {high|medium|low} -- {N} sources]
{Why it was built this way. Sourced from ADRs, READMEs, commit history, comments.}
- **{decision}** -- {rationale}

## Gotchas [coverage: {high|medium|low} -- {N} sources]
{Known issues, edge cases, failure modes, common mistakes.
Only include entries relevant to THIS module.}

## Sources
{List ALL source files that contributed to this article}
- [relative/path/to/source](relative/path/to/source)

---

## Coverage Guide

Coverage indicators help the reader (human or AI) decide whether to trust this section or read raw sources:

- **high** -- 5+ sources, detailed synthesis, recently compiled. Trust this section.
- **medium** -- 2-4 sources, decent coverage but may miss detail. Check raw sources for granular questions.
- **low** -- 1 source or sparse data. Read the raw source files listed in Sources.
