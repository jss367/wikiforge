# Search the Wiki

Search across all wiki articles for keywords, phrases, or topics.

## Instructions

### Step 1: Validate

- Read `.wiki-compiler.json` from the project root (or nearest parent directory). If not found, tell the user to run `/wiki-init` first.
- Accept a search query as argument (e.g., `/wiki-search retention experiments`)
- If no argument provided, ask: "What are you looking for?"

### Step 2: Search strategy

Use a two-tier search approach:

**Tier 1 — Index scan (fast, try this first):**
- Read `{output}/INDEX.md`
- Check topic names and one-line summaries for keyword matches
- This is usually sufficient for "which topic covers X?" questions

**Tier 2 — Full article search (when Tier 1 isn't enough):**
- Use Grep to search across all files in `{output}/topics/` and `{output}/concepts/` for the search terms
- Return matching sections with context — include the section heading (`##`) and surrounding lines so the user can see the match in context
- Search both topic articles and concept articles

### Step 3: Present results

Format results clearly:

```
Found {N} matches for "{query}":

### Topics
- **{topic-name}** [coverage: {level}] — {matching excerpt}
  → {output}/topics/{slug}.md

### Concepts
- **{concept-name}** — {matching excerpt}
  → {output}/concepts/{slug}.md
```

Include coverage indicators so the user knows whether to trust the wiki excerpt or read raw sources.

If no matches found:
- Suggest related topics that might be relevant
- Recommend `/wiki-query` for synthesis questions that require connecting multiple topics
- Suggest `/wiki-ingest` if the user thinks the knowledge should be in the wiki but isn't

### Step 4: Offer next steps

Based on results:
- "Want me to read the full article on {topic}?"
- "Want to ask a deeper question? Try `/wiki-query {your question}`"
- If search reveals a gap: "This area has low coverage. Want to `/wiki-ingest` a source to improve it?"

## Arguments

- Search query as argument (can be multiple words)
- No arguments: prompts user to specify what they're looking for

## Notes

This is a keyword/grep-based search designed to work at any scale without external dependencies. For large wikis (100+ topics) that need semantic search, consider adding [qmd](https://github.com/jina-ai/qmd) as an MCP server for hybrid BM25/vector search with LLM re-ranking.
