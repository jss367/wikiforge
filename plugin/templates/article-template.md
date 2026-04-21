<!-- DEFAULT TEMPLATE: Used when .wiki-compiler.json has no article_sections field.
     Wikipedia-style hub article. Short lead, sectioned body with inline wikilinks
     and hatnotes to sub-articles. Sub-articles live at topics/{topic}/{sub-slug}.md
     and are compiled per the sub-article template. -->

---
title: {Topic Name}
topic: {Topic Name}
last_compiled: {YYYY-MM-DD}
source_count: {number}
source: {relative path from vault root to the single best "primary" source note — used for the Edit in Obsidian button}
sub_pages: [{list of sub-page slugs created under topics/{topic-slug}/}]
status: active
---

**{Topic Name}** {is a one-sentence definition of what this topic IS. Wikipedia-style lead: no preamble, no "this note covers...", just the definition.}

{Second paragraph: 2-4 sentences of high-level scope, current state, and why it matters. Use inline wikilinks for named entities (sub-topics, people, concepts, organizations).}

{Optionally a third paragraph if the topic is large. Keep the whole lead under ~150 words.}

## {Section 1 — e.g., Background, Motivation, Overview}

{2-4 short paragraphs. When mentioning a sub-topic, experiment, decision, person, paper, or concept that has its own page, use `[[slug|display text]]`. If a sub-article covers a section in full depth, end the section with a hatnote:}

> **Main article:** [[topics/{topic}/{sub-slug}|{Display name}]]

## {Section 2}

{Same pattern: short prose, dense with wikilinks, hatnote to sub-article if one exists.}

{Embed at least one image per article if relevant images exist in source material. Use paths that Quartz can serve, e.g.:}

![{alt text}](../images/{topic-slug}/{filename}.png)

{Caption: 1 sentence explaining what the image shows.}

## {Section 3}

{Continue.}

## See also

- [[topics/{related-topic}]]
- [[concepts/{related-concept}]]

## Sources

{List ALL source files that contributed. Obsidian wikilinks with relative paths from topics/.}
- [[../../relative/path/to/source]]

<!-- Writing rules enforced at compile time:
     1. NO coverage tags like "[coverage: high -- 5 sources]" in section headings.
        Coverage, if tracked, lives in frontmatter metadata only.
     2. NO academic parenthetical citations like "(Cloud et al., arxiv 2410.04332)".
        If citing a paper, link to a paper note: [[papers/gr-moe]] or footnote with
        a clean external URL. Never inline "(Author et al., year)".
     3. Every mention of a named entity that has its own source or sub-page MUST
        be a [[wikilink]], not just prose.
     4. Hub article sections are SHORT (2-4 paragraphs max) and point to sub-articles
        for detail. Do not dump every experimental detail into the hub.
     5. Default tone is encyclopedic — descriptive, present tense, no first person,
        no temporal words like "new", "recent", "current", "latest" in headings or
        section titles (these go stale).
     6. Embed images when source material includes relevant figures. The compiler
        copies them into wiki/images/{topic-slug}/ and the article references that path.
     7. The page title lives in the frontmatter `title:` field only. Do NOT add a
        leading `# {Topic Name}` H1 — the site renderer draws the title from
        frontmatter, so a body-level H1 would appear twice on the page.
-->
