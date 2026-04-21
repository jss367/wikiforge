import { PageLayout, SharedLayout } from "./quartz/cfg"
import * as Component from "./quartz/components"
import EditInObsidian from "./quartz/components/EditInObsidian"

// Title-cases Explorer node display names. Inlined because Quartz serializes
// this with .toString() and runs it in the browser — it cannot close over
// anything in this file.
const titleCaseExplorer = (node: { displayName: string }) => {
  const raw = node.displayName
  const hasSpaces = /\s/.test(raw)
  const spaced = hasSpaces ? raw : raw.replace(/[-_]+/g, " ")
  node.displayName = spaced
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

// components shared across all pages
export const sharedPageComponents: SharedLayout = {
  head: Component.Head(),
  header: [],
  afterBody: [],
  footer: Component.Footer({
    links: {},
  }),
}

// components for pages that display a single page (e.g. a single note)
export const defaultContentPageLayout: PageLayout = {
  beforeBody: [
    Component.ConditionalRender({
      component: Component.Breadcrumbs(),
      condition: (page) => page.fileData.slug !== "index",
    }),
    Component.ArticleTitle(),
    Component.ContentMeta(),
    Component.TagList(),
    EditInObsidian(),
  ],
  left: [
    Component.PageTitle(),
    Component.MobileOnly(Component.Spacer()),
    Component.Flex({
      components: [
        {
          Component: Component.Search(),
          grow: true,
        },
        { Component: Component.Darkmode() },
        { Component: Component.ReaderMode() },
      ],
    }),
    Component.Explorer({ mapFn: titleCaseExplorer }),
  ],
  // Wikipedia-style: no right sidebar. TOC and backlinks removed for a
  // simpler article-centric layout. If you miss the graph/backlinks, move
  // them to `left:` or restore selective components here.
  right: [],
}

// components for pages that display lists of pages  (e.g. tags or folders)
// Quartz uses this layout when a content file has a matching directory —
// e.g. `topics/gradient-routing.md` is rendered with this layout because
// the folder `topics/gradient-routing/` also exists. So our topic hubs
// render here, not in defaultContentPageLayout. EditInObsidian is included
// to cover that case; on tag/folder index pages without a `source`
// frontmatter field, the component returns null and renders nothing.
export const defaultListPageLayout: PageLayout = {
  beforeBody: [
    Component.Breadcrumbs(),
    Component.ArticleTitle(),
    Component.ContentMeta(),
    EditInObsidian(),
  ],
  left: [
    Component.PageTitle(),
    Component.MobileOnly(Component.Spacer()),
    Component.Flex({
      components: [
        {
          Component: Component.Search(),
          grow: true,
        },
        { Component: Component.Darkmode() },
      ],
    }),
    Component.Explorer({ mapFn: titleCaseExplorer }),
  ],
  right: [],
}
