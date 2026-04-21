<!-- SUB-ARTICLE TEMPLATE: For pages under topics/{topic-slug}/{sub-slug}.md.
     These are the "detail pages" linked from the hub topic article, Wikipedia-style.
     One sub-article per natural source cluster (an experiment, a decision,
     a track, a concept). Dense with content and images; the hub summarizes. -->

---
title: {Sub-topic Title}
topic: {parent topic slug}
sub_page: {sub-slug}
last_compiled: {YYYY-MM-DD}
source: {relative path from vault root to the primary source note}
sources: [{list of all contributing source file paths}]
status: active
---

**{Sub-topic}** {is — present tense — a one-sentence definition scoped to the parent topic. The sub-topic name MUST appear in bold on its first mention and MUST be the grammatical subject of the opening sentence. No preamble, no "this page covers…", no hedging. Definition first.}

{Second paragraph: 2-4 sentences of purpose, context, and why this sub-topic matters within the parent. Link back to the parent topic via [[topics/{parent-topic}]] in this paragraph, and use inline wikilinks for every other named entity. Avoid temporal words like "new", "recent", or "current". HARD CAP: the entire lead (all paragraphs before the first `##` heading) stays under 150 words. If the lead would be longer, move detail into a section.}

## {Section 1 — natural section from the source material}

{Body. When referring to sibling sub-pages, use `[[topics/{parent}/{sibling-slug}]]`.}

![{alt}](../../images/{parent-topic}/{filename}.png)

{Caption.}

## {Section 2}

{Body. Tables, code blocks, and lists OK when the source material has them.}

| Config | Metric | Value |
|---|---|---|
| ... | ... | ... |

## Results

{For experimental sub-pages: numerical results, with images of plots/samples when available.}

## See also

- [[topics/{parent-topic}]] — parent topic
- [[topics/{parent-topic}/{sibling-slug}]] — related sub-page

## Sources

- [[../../../relative/path/to/source]]

<!-- Writing rules enforced at compile time (same as hub articles):
     1. NO coverage tags like "[coverage: high -- 5 sources]" in section headings.
        Coverage, if tracked, lives in frontmatter metadata only.
     2. NO academic parenthetical citations like "(Cloud et al., arxiv 2410.04332)".
        If citing a paper, link to a paper note: [[papers/gr-moe]] or footnote with
        a clean external URL. Never inline "(Author et al., year)".
     3. Every mention of a named entity that has its own source or sibling sub-page
        MUST be a [[wikilink]], not just prose.
     4. Sub-articles ARE the detail pages: full technical content, tables, code
        blocks, and results are welcome. Unlike hub sections, length is not capped
        here — but the LEAD still is (see rule 7).
     5. Default tone is encyclopedic — descriptive, present tense, no first person,
        no temporal words like "new", "recent", "current", "latest" in headings or
        section titles (these go stale).
     6. Embed images when source material includes relevant figures. Reference them
        at ../../images/{parent-topic}/{filename}.
     7. LEAD PARAGRAPH: The article's first paragraph is the lead. The topic
        name MUST appear in **bold** on its first mention and MUST be the
        subject of the opening sentence. The lead (everything before the
        first `##` heading) MUST stay under 150 words. If content would push
        it longer, move detail into a section and leave a concise summary.
     8. The page title lives in the frontmatter `title:` field only. Do NOT add a
        leading `# {Sub-topic Title}` H1 — the site renderer draws the title from
        frontmatter, so a body-level H1 would appear twice on the page.
-->
