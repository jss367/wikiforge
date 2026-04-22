import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"

// Inline client script. Quartz bundles each component's `afterDOMLoaded`
// string and runs it after every SPA navigation, so we re-bind on each
// `nav` event and use `window.addCleanup` to drop the old listener.
const exportScript = `
document.addEventListener("nav", () => {
  const btn = document.querySelector(".export-article-btn")
  if (!btn) return

  async function exportPage(event) {
    event.preventDefault()
    // Quartz puts the title/breadcrumbs in .page-header and the body in
    // <article>, both inside .center. Grab the whole .center so the export
    // contains the H1 and the content together.
    const center = document.querySelector(".center")
    if (!center) return

    btn.setAttribute("disabled", "true")
    const originalText = btn.textContent
    btn.textContent = "⤓ Exporting…"

    try {
      // Collect inline <style> blocks plus the contents of every same-origin
      // stylesheet. Cross-origin sheets (e.g. Google Fonts) are skipped: the
      // browser blocks fetch() for those and we'd hang. Skipping them just
      // means the export falls back to system fonts, which is acceptable for
      // a portable single-file copy.
      const styleParts = []
      document.querySelectorAll("style").forEach((s) => {
        if (s.textContent) styleParts.push(s.textContent)
      })
      const linkEls = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
      const linkContents = await Promise.all(
        linkEls.map((l) => {
          const href = l.href
          if (!href || !href.startsWith(location.origin)) return Promise.resolve("")
          return fetch(href).then((r) => (r.ok ? r.text() : "")).catch(() => "")
        }),
      )
      const css = styleParts.concat(linkContents).join("\\n\\n")

      const titleEl = center.querySelector("h1, .article-title")
      const titleText = (titleEl && titleEl.textContent) || document.title || "page"
      const escapeHtml = (s) =>
        s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

      // Clone so we can rewrite attributes without mutating the live DOM.
      // Relative URLs (e.g. "../images/foo.png", "/topics/bar") resolve
      // against the *file path* of the exported HTML once it's opened from
      // disk, which would 404. Absolutize against the current page so assets
      // and internal links still point back at the live site.
      const clone = center.cloneNode(true)
      const absolutize = (el, attr) => {
        const v = el.getAttribute(attr)
        if (!v || v.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(v)) return
        try {
          el.setAttribute(attr, new URL(v, location.href).href)
        } catch (e) {}
      }
      clone.querySelectorAll("[src]").forEach((el) => absolutize(el, "src"))
      clone.querySelectorAll("[href]").forEach((el) => absolutize(el, "href"))

      // Wrap the article in the same nesting Quartz uses so the page's CSS
      // selectors (.page, .center, .popover-hint, #quartz-body) still match.
      // Without the wrappers the inlined stylesheet has nothing to attach to
      // and the export renders unstyled.
      const html =
        '<!DOCTYPE html>\\n<html lang="en"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>' + escapeHtml(titleText) + '</title>' +
        '<style>' + css + '\\n' +
        // Hide chrome that the .center container doesn't include but that
        // some of the inlined CSS still styles, plus the breadcrumbs and the
        // edit/export utility links — none of those make sense in an exported
        // standalone page.
        '.sidebar,.header,.breadcrumb-container,.export-article,.edit-in-obsidian{display:none!important}' +
        'body{margin:0;padding:2rem 1rem}' +
        '.page,.center{max-width:750px;margin:0 auto}' +
        '</style></head><body><div id="quartz-root"><div id="quartz-body">' +
        '<div class="page">' +
        clone.outerHTML +
        '</div></div></div></body></html>'

      // \\p{L}\\p{N} keeps letters/digits from any script so Cyrillic,
      // Chinese, etc. titles still produce distinct filenames instead of all
      // collapsing to "page". For symbol-only titles with no letter/digit
      // anywhere, fall back to percent-encoding so two such pages don't
      // overwrite each other in the downloads folder.
      const slugify = (s) => {
        const lower = s.trim().toLowerCase()
        const base = lower.replace(/[^\\p{L}\\p{N}]+/gu, "-").replace(/^-+|-+$/g, "")
        return base || encodeURIComponent(lower) || "page"
      }

      const blob = new Blob([html], { type: "text/html;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = slugify(titleText) + ".html"
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } finally {
      btn.removeAttribute("disabled")
      btn.textContent = originalText
    }
  }

  btn.addEventListener("click", exportPage)
  window.addCleanup && window.addCleanup(() => btn.removeEventListener("click", exportPage))
})
`

const ExportArticle: QuartzComponent = ({ fileData }: QuartzComponentProps) => {
  // Same gate EditInObsidian uses: tag/folder index pages have no backing
  // file — there's nothing meaningful to export from them.
  if (!fileData.filePath) return null

  return (
    <p class="export-article" style="margin: 0.25em 0; font-size: 0.85em;">
      <a
        href="#"
        class="export-article-btn"
        role="button"
        style="text-decoration: none; color: var(--secondary); cursor: pointer;"
      >
        ⤓ Export this page
      </a>
    </p>
  )
}

ExportArticle.afterDOMLoaded = exportScript

export default (() => ExportArticle) satisfies QuartzComponentConstructor
