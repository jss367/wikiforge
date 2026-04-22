import { QuartzTransformerPlugin } from "../types"
import { Root } from "mdast"
import { toString } from "mdast-util-to-string"
import Slugger from "github-slugger"
import { toTitleCase } from "../../util/title"

// Quartz's ArticleTitle component renders an <h1> from frontmatter.title on
// every content page. If the source markdown *also* starts with a body H1
// that says the same thing (a common shape for authored notes and for
// articles compiled before the frontmatter-only template rule existed), the
// rendered page shows the title twice — once as the site-rendered title,
// once as the first body heading.
//
// Strip that duplicate at the AST level, so the fix applies uniformly to:
//   - legacy content that predates the template change
//   - hand-authored notes that naturally lead with `# Topic`
//   - compiler slips where an H1 sneaks back in
//
// We only remove the *first* heading, and only when it's an H1 whose text
// (normalized) matches the frontmatter title. A mid-article heading that
// happens to repeat the title is left alone — that's almost certainly a
// deliberate section header, not a duplicated page title.
//
// Normalization mirrors the slug→display transform in ArticleTitle.toTitleCase
// so that a slug-style frontmatter title (`alignment-team`, `spike-v4_5`) is
// recognized as a duplicate of the spelled-out body H1 (`# Alignment Team`,
// `# Spike V4.5`). Without this, the renderer would title-case the slug for
// display while the matcher kept comparing against the raw slug — and the
// duplicate would slip through unnoticed.
const normalize = (s: string): string => {
  const lowered = s.toLowerCase().trim()
  const spaced = /\s/.test(lowered) ? lowered : lowered.replace(/_/g, ".").replace(/-/g, " ")
  return spaced.replace(/\s+/g, " ").trim()
}

export const StripDuplicateTitle: QuartzTransformerPlugin = () => ({
  name: "StripDuplicateTitle",
  markdownPlugins() {
    return [
      () => (tree: Root, file) => {
        const title = file.data.frontmatter?.title
        if (typeof title !== "string") return
        const normalizedTitle = normalize(title)
        if (!normalizedTitle) return

        // Only strip when the H1 is the *first* content block. If prose or
        // anything else precedes it, the `# Title` is acting as a real
        // section header, not a duplicated page title.
        //
        // Skip past leading frontmatter metadata nodes that Quartz's
        // FrontMatter plugin leaves in the tree (`yaml`, `toml`) — those
        // don't render, so the H1 that follows them is still "first".
        let idx = 0
        while (
          idx < tree.children.length &&
          (tree.children[idx].type === "yaml" || tree.children[idx].type === "toml")
        ) {
          idx++
        }
        const first = tree.children[idx]
        if (!first || first.type !== "heading" || first.depth !== 1) return
        if (normalize(toString(first)) !== normalizedTitle) return

        tree.children.splice(idx, 1)

        // Signal to ArticleTitle that it can safely claim the anchor slug
        // for the title — but only if no surviving heading would slug to
        // the same id under heading-id generation. Otherwise we'd ship
        // duplicate DOM ids and `#slug` would target the title instead of
        // the section the user actually meant.
        const titleSlug = new Slugger().slug(toTitleCase(title))
        const collides = tree.children.some(
          (n) => n.type === "heading" && new Slugger().slug(toString(n)) === titleSlug,
        )
        if (!collides) {
          file.data.strippedDuplicateTitle = true
        }
      },
    ]
  },
})

declare module "vfile" {
  interface DataMap {
    strippedDuplicateTitle: boolean
  }
}
