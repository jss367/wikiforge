import { QuartzTransformerPlugin } from "../types"
import { FullSlug } from "../../util/path"
import { visit } from "unist-util-visit"
import isAbsoluteUrl from "is-absolute-url"
import { Root } from "hast"

// Rewrite internal relative URLs (./…, ../…) to root-absolute (/…) in
// emitted HTML. Fixes the class of bugs where internal links and asset
// references break depending on whether the browser's URL has a trailing
// slash — Quartz emits a standalone `foo.html` AND a `foo/index.html` for
// every hub that has a matching folder, and breadcrumbs on sub-pages link
// back to the hub with a trailing slash (`resolveRelative(…)` returns
// "folder/" for folder-like destinations). A relative href from a page
// served at `/topics/foo/` resolves one level too deep, producing 404s
// for images, links, and other assets that are supposed to resolve from
// the site root.
//
// By converting `.././images/bar.png` to `/images/bar.png` at emit time,
// the resulting HTML is robust to whichever URL the browser ends up on —
// breadcrumb-slashed, bookmarked, typed, whatever.
//
// External links (http://, https://, mailto:, tel:, data:, protocol-relative
// `//…`), fragment-only hrefs (`#foo`), and already-absolute paths are
// left alone.
//
// Runs after Plugin.CrawlLinks so it operates on the post-transform hrefs.

export const AbsoluteInternalLinks: QuartzTransformerPlugin = () => ({
  name: "AbsoluteInternalLinks",
  htmlPlugins() {
    return [
      () => (tree: Root, file) => {
        const slug = file.data.slug as FullSlug | undefined
        if (!slug) return

        // "Directory" of the current page for URL resolution. For slug
        // `topics/foo/bar`, pageDir is `topics/foo/`. For slug `index`
        // (root), pageDir is `""`. The trailing slash matters — it's
        // what tells `new URL()` to treat the base as a directory rather
        // than as a file.
        const segments = slug.split("/")
        segments.pop()
        const pageDir = segments.length > 0 ? segments.join("/") + "/" : ""

        const toRootAbsolute = (href: string): string => {
          if (!href) return href
          if (href.startsWith("#") || href.startsWith("/")) return href
          if (href.startsWith("data:") || href.startsWith("mailto:") || href.startsWith("tel:")) {
            return href
          }
          if (isAbsoluteUrl(href, { httpOnly: false })) return href
          // Protocol-relative `//host/path`
          if (href.startsWith("//")) return href
          // Query-only URLs (`?v=2`, `?raw=1`) refer to the current document,
          // not the current directory. Resolving them against `pageDir` would
          // rewrite `?v=2` on `topics/foo` to `/topics/?v=2` and drop the page.
          // Anchor to the slug instead so the query lands on the same page.
          if (href.startsWith("?")) {
            return (slug === "index" ? "/" : "/" + slug) + href
          }
          try {
            // Use a sentinel host that will never collide with a real base URL.
            // We only care about the `.pathname + .search + .hash` output.
            const resolved = new URL(href, `https://wikiforge.local/${pageDir}`)
            return resolved.pathname + resolved.search + resolved.hash
          } catch {
            return href
          }
        }

        visit(tree, "element", (node) => {
          if (!node.properties) return
          const tag = node.tagName
          if (tag === "a" && typeof node.properties.href === "string") {
            node.properties.href = toRootAbsolute(node.properties.href)
          } else if (
            (tag === "img" || tag === "video" || tag === "audio" || tag === "iframe" || tag === "source") &&
            typeof node.properties.src === "string"
          ) {
            node.properties.src = toRootAbsolute(node.properties.src)
          }
        })
      },
    ]
  },
})
