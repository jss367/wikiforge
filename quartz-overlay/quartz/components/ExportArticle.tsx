import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"

// Inline client script. Quartz bundles each component's `afterDOMLoaded`
// string and runs it after every SPA navigation, so we re-bind on each
// `nav` event and use `window.addCleanup` to drop old listeners.
const exportScript = `
document.addEventListener("nav", () => {
  const root = document.querySelector(".export-article")
  if (!root) return
  const summary = root.querySelector("summary")
  const menu = root.querySelector(".export-menu")
  if (!summary || !menu) return

  const close = () => { if (root.open) root.open = false }
  const onDocClick = (e) => {
    if (!root.contains(e.target)) close()
  }
  const onKey = (e) => {
    if (e.key === "Escape") { close(); summary.focus() }
  }
  document.addEventListener("click", onDocClick)
  document.addEventListener("keydown", onKey)

  // ----- HTML export (standalone single-file copy of the rendered page) -----
  async function exportHtml() {
    const center = document.querySelector(".center")
    if (!center) return

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
    const html =
      '<!DOCTYPE html>\\n<html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + escapeHtml(titleText) + '</title>' +
      '<style>' + css + '\\n' +
      '.sidebar,.header,.breadcrumb-container,.export-article,.edit-in-obsidian{display:none!important}' +
      'body{margin:0;padding:2rem 1rem}' +
      '.page,.center{max-width:750px;margin:0 auto}' +
      '</style></head><body><div id="quartz-root"><div id="quartz-body">' +
      '<div class="page">' +
      clone.outerHTML +
      '</div></div></div></body></html>'

    triggerDownload(new Blob([html], { type: "text/html;charset=utf-8" }), titleText, "html")
  }

  // ----- Jupyter Notebook export (markdown -> .ipynb) ------------------------
  // We fetch the original .md from the build (mirrored by the RawMarkdown
  // emitter as <slug>.md) rather than reading the rendered DOM: the parsed
  // HTML has already lost the original code fences, and round-tripping
  // HTML -> markdown is lossy (tables, callouts, math).
  async function exportIpynb() {
    const slug = root.getAttribute("data-slug")
    if (!slug) return
    const titleEl = document.querySelector(".center h1, .center .article-title")
    const titleText = (titleEl && titleEl.textContent) || document.title || "page"

    const mdUrl = "/" + slug + ".md"
    const res = await fetch(mdUrl)
    if (!res.ok) {
      alert("Could not load markdown source for this page (" + res.status + ").")
      return
    }
    const md = await res.text()
    const notebook = mdToNotebook(md, titleText)
    const json = JSON.stringify(notebook, null, 1)
    triggerDownload(new Blob([json], { type: "application/x-ipynb+json" }), titleText, "ipynb")
  }

  function stripFrontmatter(md) {
    // YAML frontmatter: "---" on the first line, "---" or "..." on a later
    // line. Anything before the first "---" disqualifies it (keep verbatim).
    if (!md.startsWith("---\\n") && !md.startsWith("---\\r\\n")) return md
    const m = md.match(/^---\\r?\\n[\\s\\S]*?\\r?\\n(?:---|\\.\\.\\.)\\s*(?:\\r?\\n|$)/)
    return m ? md.slice(m[0].length) : md
  }

  // Walk lines, splitting on fenced code blocks. Fence opener: 3+ "\`" or
  // "~" chars, optional info string. Fence closer: a line of the same
  // marker char with at least the same length and no info string. Anything
  // outside a fence is "prose"; anything inside is "code" with the info
  // string's first token as the language. We compare characters directly
  // rather than building a closer regex from the fence char — backtick
  // inside a template-literal-encoded source is fiddly to escape and easy
  // to get wrong.
  function tokenize(md) {
    const lines = md.split(/\\r?\\n/)
    const segments = []
    let cur = { type: "prose", lines: [] }
    let inFence = false
    let fenceChar = ""
    let fenceLen = 0

    function isCloser(line) {
      let i = 0
      while (i < line.length && i < 3 && line[i] === " ") i++
      let n = 0
      while (i < line.length && line[i] === fenceChar) { i++; n++ }
      if (n < fenceLen) return false
      while (i < line.length) {
        if (line[i] !== " " && line[i] !== "\\t") return false
        i++
      }
      return true
    }

    for (const line of lines) {
      if (!inFence) {
        const m = line.match(/^(\\s{0,3})([\\\`~]{3,})\\s*(\\S*)/)
        if (m) {
          if (cur.lines.length) segments.push(cur)
          inFence = true
          fenceChar = m[2][0]
          fenceLen = m[2].length
          cur = { type: "code", lang: (m[3] || "").trim(), lines: [] }
          continue
        }
        cur.lines.push(line)
      } else {
        if (isCloser(line)) {
          segments.push(cur)
          cur = { type: "prose", lines: [] }
          inFence = false
          continue
        }
        cur.lines.push(line)
      }
    }
    // Unterminated fence: flush as code anyway so content isn't dropped.
    if (cur.lines.length || (inFence && cur.type === "code")) segments.push(cur)
    return segments
  }

  // Jupyter convention: cell.source is an array of lines, each terminated
  // by "\\n" except the last. An empty source becomes an empty array.
  function lineify(s) {
    if (!s) return []
    const parts = s.split("\\n")
    return parts.map((p, i) => (i < parts.length - 1 ? p + "\\n" : p)).filter((p, i, a) => !(i === a.length - 1 && p === ""))
  }

  // Common kernel metadata. The notebook still opens fine with a missing
  // kernel — Jupyter just prompts the user to pick one — but supplying a
  // sensible kernelspec means the notebook lights up immediately for users
  // who do have the matching kernel installed.
  function kernelMeta(lang) {
    const k = (lang || "").toLowerCase()
    const map = {
      python: { name: "python3", display_name: "Python 3", language: "python" },
      py:     { name: "python3", display_name: "Python 3", language: "python" },
      bash:   { name: "bash",    display_name: "Bash",     language: "bash" },
      sh:     { name: "bash",    display_name: "Bash",     language: "bash" },
      shell:  { name: "bash",    display_name: "Bash",     language: "bash" },
      javascript: { name: "javascript", display_name: "JavaScript", language: "javascript" },
      js:     { name: "javascript", display_name: "JavaScript", language: "javascript" },
      typescript: { name: "typescript", display_name: "TypeScript", language: "typescript" },
      ts:     { name: "typescript", display_name: "TypeScript", language: "typescript" },
      r:      { name: "ir",      display_name: "R",        language: "R" },
      julia:  { name: "julia",   display_name: "Julia",    language: "julia" },
      ruby:   { name: "ruby",    display_name: "Ruby",     language: "ruby" },
      rb:     { name: "ruby",    display_name: "Ruby",     language: "ruby" },
    }
    const spec = map[k] || { name: "python3", display_name: "Python 3", language: "python" }
    return {
      kernelspec: spec,
      language_info: { name: spec.language },
    }
  }

  function mdToNotebook(rawMd, titleText) {
    let md = stripFrontmatter(rawMd).replace(/^\\s+/, "")

    // If the markdown doesn't open with an H1, prepend the page title so the
    // notebook has a clear heading. Obsidian users frequently rely on the
    // filename for titling and never write an in-body H1.
    if (!/^#\\s/.test(md)) {
      md = "# " + titleText + "\\n\\n" + md
    }

    const segments = tokenize(md)

    // Pick the dominant language across fenced code blocks as the notebook
    // kernel. Code blocks matching that language become code cells; blocks
    // in other languages stay as markdown cells with their fences preserved
    // (Jupyter renders them with syntax highlighting via the markdown
    // renderer — strictly worse than a real code cell, but better than
    // forcing an alien kernel).
    const counts = Object.create(null)
    for (const s of segments) {
      if (s.type === "code" && s.lang) counts[s.lang.toLowerCase()] = (counts[s.lang.toLowerCase()] || 0) + 1
    }
    let kernelLang = ""
    let best = 0
    for (const k in counts) {
      if (counts[k] > best) { best = counts[k]; kernelLang = k }
    }

    const cells = []
    for (const s of segments) {
      if (s.type === "prose") {
        const txt = s.lines.join("\\n").replace(/^\\n+|\\n+$/g, "")
        if (!txt) continue
        cells.push({ cell_type: "markdown", metadata: {}, source: lineify(txt) })
      } else {
        const codeLang = (s.lang || "").toLowerCase()
        const body = s.lines.join("\\n")
        if (kernelLang && codeLang === kernelLang) {
          cells.push({
            cell_type: "code",
            metadata: {},
            execution_count: null,
            outputs: [],
            source: lineify(body),
          })
        } else {
          // Preserve the fence so the markdown cell still renders as a
          // code block (with its language tag, when one was given).
          const wrapped = "\`\`\`" + (s.lang || "") + "\\n" + body + "\\n\`\`\`"
          cells.push({ cell_type: "markdown", metadata: {}, source: lineify(wrapped) })
        }
      }
    }

    return {
      cells,
      metadata: kernelMeta(kernelLang || "python"),
      nbformat: 4,
      nbformat_minor: 5,
    }
  }

  // ----- shared download helper ---------------------------------------------
  // \\p{L}\\p{N} keeps letters/digits from any script so Cyrillic, Chinese,
  // etc. titles still produce distinct filenames. For symbol-only titles,
  // fall back to percent-encoding so two such pages don't overwrite each
  // other in the downloads folder.
  function slugify(s) {
    const lower = s.trim().toLowerCase()
    const base = lower.replace(/[^\\p{L}\\p{N}]+/gu, "-").replace(/^-+|-+$/g, "")
    return base || encodeURIComponent(lower) || "page"
  }

  function triggerDownload(blob, titleText, ext) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = slugify(titleText) + "." + ext
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // ----- menu wiring --------------------------------------------------------
  async function runFormat(fmt, btn) {
    btn.setAttribute("disabled", "true")
    const orig = btn.textContent
    btn.textContent = "Exporting…"
    try {
      if (fmt === "html") await exportHtml()
      else if (fmt === "ipynb") await exportIpynb()
    } finally {
      btn.textContent = orig
      btn.removeAttribute("disabled")
      close()
    }
  }

  const onItemClick = (e) => {
    const btn = e.target.closest("button[data-fmt]")
    if (!btn) return
    e.preventDefault()
    runFormat(btn.getAttribute("data-fmt"), btn)
  }
  menu.addEventListener("click", onItemClick)

  window.addCleanup && window.addCleanup(() => {
    document.removeEventListener("click", onDocClick)
    document.removeEventListener("keydown", onKey)
    menu.removeEventListener("click", onItemClick)
  })
})
`

const ExportArticle: QuartzComponent = ({ fileData }: QuartzComponentProps) => {
  // Same gate EditInObsidian uses: tag/folder index pages have no backing
  // file — there's nothing meaningful to export from them.
  if (!fileData.filePath || !fileData.slug) return null

  // <details>/<summary> gives us native click-toggle and keyboard support
  // (Enter/Space on the summary). data-router-ignore stops Quartz's SPA
  // router from intercepting clicks inside this widget.
  //
  // Hide the default disclosure marker on the summary. `list-style: none`
  // covers Firefox / Chrome 89+; the ::-webkit-details-marker rule covers
  // older Safari. Kept inline so the widget stays self-contained — no
  // separate stylesheet needed.
  return (
    <details
      class="export-article"
      data-slug={fileData.slug}
      data-router-ignore="true"
      style="float: right; margin: 0; font-size: 1.1em; line-height: 1; position: relative;"
    >
      <style>{`.export-article > summary { list-style: none; }
.export-article > summary::-webkit-details-marker { display: none; }
.export-article > summary::marker { content: ""; }`}</style>
      <summary
        class="export-article-btn"
        role="button"
        aria-label="Export this page"
        title="Export this page"
        style="cursor: pointer; color: var(--secondary); padding: 0.25em 0.4em;"
      >
        ⤓
      </summary>
      <div
        class="export-menu"
        role="menu"
        style="position: absolute; right: 0; top: 100%; min-width: 12em; background: var(--light); border: 1px solid var(--lightgray); border-radius: 4px; box-shadow: 0 2px 6px rgba(0,0,0,0.08); padding: 0.25em 0; z-index: 5; font-size: 0.9rem;"
      >
        <button
          type="button"
          role="menuitem"
          data-fmt="html"
          data-router-ignore="true"
          style="display: block; width: 100%; text-align: left; padding: 0.4em 0.8em; background: none; border: none; color: var(--dark); cursor: pointer; font: inherit;"
        >
          HTML
        </button>
        <button
          type="button"
          role="menuitem"
          data-fmt="ipynb"
          data-router-ignore="true"
          style="display: block; width: 100%; text-align: left; padding: 0.4em 0.8em; background: none; border: none; color: var(--dark); cursor: pointer; font: inherit;"
        >
          Jupyter Notebook
        </button>
      </div>
    </details>
  )
}

ExportArticle.afterDOMLoaded = exportScript

export default (() => ExportArticle) satisfies QuartzComponentConstructor
