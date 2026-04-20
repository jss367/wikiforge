<!-- SUB-ARTICLE TEMPLATE: For pages under topics/{topic-slug}/{sub-slug}.md.
     These are the "detail pages" linked from the hub topic article, Wikipedia-style.
     One sub-article per natural source cluster (an experiment, a decision,
     a track, a concept). Dense with content and images; the hub summarizes. -->

---
topic: {parent topic slug}
sub_page: {sub-slug}
last_compiled: {YYYY-MM-DD}
source: {relative path from vault root to the primary source note}
sources: [{list of all contributing source file paths}]
status: active
---

# {Sub-topic Title}

**{Sub-topic}** {one-sentence lead. What this is, in the context of the parent topic.}

{Second paragraph: purpose / context / current state. Link back to parent with [[topics/{parent-topic}]] somewhere in the lead.}

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

<!-- Same rules as hub articles apply:
     - No coverage tags in headings
     - No academic parentheticals
     - Inline wikilinks for every named entity
     - Images embedded from wiki/images/{parent-topic}/
     - Encyclopedic tone, no temporal words
-->
