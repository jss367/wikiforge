import { QuartzTransformerPlugin } from "../types"
import { Root } from "mdast"
import { toString } from "mdast-util-to-string"

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
const normalize = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim()

export const StripDuplicateTitle: QuartzTransformerPlugin = () => ({
  name: "StripDuplicateTitle",
  markdownPlugins() {
    return [
      () => (tree: Root, file) => {
        const title = file.data.frontmatter?.title
        if (typeof title !== "string") return
        const normalizedTitle = normalize(title)
        if (!normalizedTitle) return

        const firstHeadingIdx = tree.children.findIndex((n) => n.type === "heading")
        if (firstHeadingIdx === -1) return

        const first = tree.children[firstHeadingIdx]
        if (first.type !== "heading" || first.depth !== 1) return
        if (normalize(toString(first)) !== normalizedTitle) return

        tree.children.splice(firstHeadingIdx, 1)
      },
    ]
  },
})
