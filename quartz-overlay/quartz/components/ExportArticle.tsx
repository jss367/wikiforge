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
  const sectionsEl = root.querySelector(".export-sections")
  if (!summary || !menu || !sectionsEl) return

  // Heading list captured at populate time. Each entry is
  // { level: 2|3, text: string }. Indices in this array are the canonical
  // section IDs used by both the DOM slicer and the markdown slicer.
  let headings = []

  const close = () => { if (root.open) root.open = false }
  const onDocClick = (e) => {
    if (!root.contains(e.target)) close()
  }
  // Only react when the menu is open — otherwise an Escape press anywhere
  // (e.g. dismissing a search modal, leaving an input) would steal focus
  // to the export icon on every page.
  const onKey = (e) => {
    if (e.key === "Escape" && root.open) { close(); summary.focus() }
  }
  document.addEventListener("click", onDocClick)
  document.addEventListener("keydown", onKey)

  // ----- HTML export (standalone single-file copy of the rendered page) -----
  async function exportHtml(checked) {
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

    // Apply user's section selection (if the picker was visible).
    filterClonedArticle(clone, checked)

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
  async function exportIpynb(checked) {
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
    const rawMd = await res.text()
    const md = filterMarkdownByHeadings(rawMd, checked)
    const notebook = mdToNotebook(md, titleText)
    const json = JSON.stringify(notebook, null, 1)
    triggerDownload(new Blob([json], { type: "application/x-ipynb+json" }), titleText, "ipynb")
  }

  function stripFrontmatter(md) {
    // YAML frontmatter: "---" on the first line, "---" or "..." on a later
    // line. Anything before the first "---" disqualifies it (keep verbatim).
    // A leading "---" can also be a markdown thematic break that happens to
    // be followed later by another "---" elsewhere in the doc, which would
    // falsely match here and silently drop real content from the notebook.
    // Only strip if the captured body is empty (empty frontmatter) or its
    // first non-blank line looks YAML-shaped: a top-level "key:" entry.
    // Frontmatter that's a YAML list (rare in practice — Obsidian / Quartz
    // expect a mapping) won't match and will be left in the body, which is
    // strictly safer than dropping content.
    if (!md.startsWith("---\\n") && !md.startsWith("---\\r\\n")) return md
    const m = md.match(/^---\\r?\\n([\\s\\S]*?)\\r?\\n(?:---|\\.\\.\\.)\\s*(?:\\r?\\n|$)/)
    if (!m) return md
    const body = m[1]
    const firstNonBlank = body.split(/\\r?\\n/).find((l) => l.trim() !== "")
    if (firstNonBlank !== undefined && !/^[A-Za-z_][\\w-]*\\s*:/.test(firstNonBlank)) return md
    return md.slice(m[0].length)
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
    // Strip only leading *blank lines* (whitespace-only lines), not all
    // leading whitespace — a document that opens with a 4-space-indented
    // code block, a nested list, or a block-quote-aligned first line
    // would otherwise have its first construct silently mangled.
    let md = stripFrontmatter(rawMd).replace(/^(?:[ \\t]*\\r?\\n)+/, "")

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

  // ----- section picker -----------------------------------------------------
  // The picker enumerates top-level h2/h3 of the rendered article. Each
  // checkbox carries a numeric index that's the canonical section ID; the
  // DOM slicer (filterClonedArticle) and the markdown slicer
  // (filterMarkdownByHeadings) walk their inputs in the same order and
  // line up against this index.
  //
  // Cascade rule: an h2 toggle drives all of its child h3s to the same
  // state. h3s toggle independently. The "All" master is tristate:
  // checked when every section is checked, indeterminate when some are.
  //
  // The picker is hidden entirely on pages with fewer than two headings —
  // there's nothing to pick between, so the menu collapses back to its
  // pre-picker layout.
  function getArticleEl() {
    const center = document.querySelector(".center")
    if (!center) return null
    return center.querySelector("article") || center
  }

  function populateSections() {
    sectionsEl.innerHTML = ""
    headings = []
    const article = getArticleEl()
    if (!article) { sectionsEl.style.display = "none"; return }

    article.querySelectorAll(":scope > h2, :scope > h3").forEach((h) => {
      const text = (h.textContent || "").trim()
      if (text) headings.push({ level: parseInt(h.tagName.slice(1)), text })
    })
    if (headings.length < 2) {
      sectionsEl.style.display = "none"
      return
    }
    sectionsEl.style.display = ""

    const header = document.createElement("label")
    header.className = "export-section-row export-section-all"
    header.style.cssText = "display: flex; align-items: center; gap: 0.4em; padding: 0.3em 0.6em 0.3em 0.6em; border-bottom: 1px solid var(--lightgray); cursor: pointer; font-weight: 600; color: var(--dark);"
    const allCb = document.createElement("input")
    allCb.type = "checkbox"
    allCb.checked = true
    allCb.dataset.role = "all"
    allCb.style.margin = "0"
    const allText = document.createElement("span")
    allText.textContent = "All sections"
    header.appendChild(allCb)
    header.appendChild(allText)
    sectionsEl.appendChild(header)

    const list = document.createElement("div")
    list.className = "export-section-list"
    list.style.cssText = "max-height: 30vh; overflow-y: auto; padding: 0.2em 0;"
    sectionsEl.appendChild(list)

    let lastH2 = -1
    headings.forEach((h, idx) => {
      if (h.level === 2) lastH2 = idx
      // Only indent h3s when they actually nest under an h2. On a doc
      // that uses h3 as its top level (no h2s), indenting orphans would
      // be misleading.
      const isOrphanH3 = h.level === 3 && lastH2 === -1
      const indent = h.level === 3 && !isOrphanH3 ? "1.8em" : "0.6em"
      const row = document.createElement("label")
      row.className = "export-section-row"
      row.style.cssText = "display: flex; align-items: center; gap: 0.4em; padding: 0.2em 0.6em 0.2em " + indent + "; cursor: pointer; color: var(--dark);"
      const cb = document.createElement("input")
      cb.type = "checkbox"
      cb.checked = true
      cb.dataset.idx = String(idx)
      cb.dataset.level = String(h.level)
      if (h.level === 3 && !isOrphanH3) cb.dataset.parent = String(lastH2)
      cb.style.margin = "0"
      row.appendChild(cb)
      const span = document.createElement("span")
      span.textContent = h.text
      span.style.cssText = "overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
      if (h.level === 3 && !isOrphanH3) span.style.color = "var(--gray)"
      row.appendChild(span)
      list.appendChild(row)
    })

    function refreshAll() {
      const boxes = list.querySelectorAll('input[type="checkbox"]')
      let checkedCount = 0
      boxes.forEach((b) => { if (b.checked) checkedCount++ })
      if (checkedCount === boxes.length) {
        allCb.checked = true
        allCb.indeterminate = false
      } else if (checkedCount === 0) {
        allCb.checked = false
        allCb.indeterminate = false
      } else {
        allCb.checked = false
        allCb.indeterminate = true
      }
    }

    list.addEventListener("change", (e) => {
      const cb = e.target
      if (!cb || cb.tagName !== "INPUT") return
      if (cb.dataset.level === "2") {
        // Cascade to children
        list.querySelectorAll('input[data-parent="' + cb.dataset.idx + '"]').forEach((child) => {
          child.checked = cb.checked
        })
      }
      refreshAll()
    })

    allCb.addEventListener("change", () => {
      // Click on a tristate sets a definite state — reading allCb.checked
      // post-click gives that state regardless of what the indeterminate
      // visual was beforehand.
      const target = allCb.checked
      list.querySelectorAll('input[type="checkbox"]').forEach((b) => { b.checked = target })
    })
  }

  function getCheckedIndices() {
    // null sentinel means "no picker shown / no filter" — exporters take
    // this as a signal to keep the full document.
    if (sectionsEl.style.display === "none") return null
    const set = new Set()
    sectionsEl.querySelectorAll('input[data-idx]').forEach((cb) => {
      if (cb.checked) set.add(parseInt(cb.dataset.idx))
    })
    return set
  }

  // ----- DOM slicer ---------------------------------------------------------
  // Walks the cloned article's direct children and removes any node that
  // belongs to an unselected section. Sections are defined by h2/h3
  // boundaries; content before the first h2 is treated as the intro and
  // always retained (excluding it would drop the page title and lead-in
  // even when every checkbox is on).
  function filterClonedArticle(clone, checked) {
    if (!checked) return
    const article = clone.querySelector("article") || clone
    let h2 = -1, h3 = -1, pos = 0
    const toRemove = []
    // Each checkbox in the picker is its own filter. A node is included
    // iff the most-specific heading containing it is checked: under an
    // h3 → gate by that h3; otherwise under an h2 → gate by that h2;
    // before any heading → intro, always kept.
    //
    // The h2-cascade UI is a bulk-set convenience, not a hierarchical
    // veto: unchecking an h2 then re-checking one of its h3s means
    // "drop the h2's prose but keep that one subsection," and that's
    // what the slicer must honor.
    function excluded() {
      if (h3 !== -1) return !checked.has(h3)
      if (h2 !== -1) return !checked.has(h2)
      return false
    }
    // Empty-text headings (e.g. \`##\` with no title) are skipped by
    // populateSections, so the slicer must skip them too — otherwise pos
    // drifts and a checkbox toggle removes the wrong section. An H1
    // resets h2/h3 because the picker only tracks h2/h3 sections, so a
    // following H1 must end the current section rather than absorb the
    // next H1's content into the previous selection state.
    Array.from(article.children).forEach((child) => {
      const tag = child.tagName
      const hasText = (tag === "H1" || tag === "H2" || tag === "H3")
        && !!(child.textContent || "").trim()
      if (tag === "H1" && hasText) {
        h2 = -1; h3 = -1
      } else if (tag === "H2" && hasText) {
        h2 = pos; h3 = -1; pos++
      } else if (tag === "H3" && hasText) {
        h3 = pos; pos++
      }
      if (excluded()) toRemove.push(child)
    })
    toRemove.forEach((el) => el.remove())
  }

  // ----- markdown slicer ----------------------------------------------------
  // Same walk as the DOM slicer, but over markdown lines. Fence-state
  // tracking mirrors tokenize() so a "## " inside a code fence isn't
  // misread as a heading.
  //
  // If the heading count in the markdown source doesn't match what the
  // DOM picker enumerated, the index map is wrong — the rendered article
  // and the source have diverged (setext headings, HTML embeds, plugin
  // injection). Bail to the unfiltered source rather than slicing the
  // wrong sections.
  function countMdHeadings(md) {
    const lines = md.split(/\\r?\\n/)
    let inFence = false, fenceChar = "", fenceLen = 0
    let count = 0
    for (const line of lines) {
      if (inFence) {
        if (isFenceCloser(line, fenceChar, fenceLen)) inFence = false
        continue
      }
      const fenceM = line.match(/^(\\s{0,3})([\\\`~]{3,})/)
      if (fenceM) {
        inFence = true
        fenceChar = fenceM[2][0]
        fenceLen = fenceM[2].length
        continue
      }
      // CommonMark allows up to 3 leading spaces before an ATX heading.
      if (/^\\s{0,3}(#{2,3})\\s+\\S/.test(line)) count++
    }
    return count
  }

  function isFenceCloser(line, fenceChar, fenceLen) {
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

  function filterMarkdownByHeadings(md, checked) {
    if (!checked) return md
    if (countMdHeadings(md) !== headings.length) return md

    const lines = md.split(/\\r?\\n/)
    const out = []
    let inFence = false, fenceChar = "", fenceLen = 0
    let h2 = -1, h3 = -1, pos = 0

    function shouldEmit() {
      // Same most-specific-heading rule as filterClonedArticle —
      // independent checkboxes, no parent-h2 veto over a checked h3.
      if (h3 !== -1) return checked.has(h3)
      if (h2 !== -1) return checked.has(h2)
      return true
    }

    for (const line of lines) {
      if (inFence) {
        if (isFenceCloser(line, fenceChar, fenceLen)) inFence = false
        if (shouldEmit()) out.push(line)
        continue
      }
      const fenceM = line.match(/^(\\s{0,3})([\\\`~]{3,})\\s*(\\S*)/)
      if (fenceM) {
        inFence = true
        fenceChar = fenceM[2][0]
        fenceLen = fenceM[2].length
        if (shouldEmit()) out.push(line)
        continue
      }
      const hM = line.match(/^\\s{0,3}(#{1,6})\\s+(.+?)\\s*#*\\s*$/)
      if (hM) {
        const level = hM[1].length
        // H1 isn't tracked by the picker, but it ends any open h2/h3 —
        // otherwise content after a later H1 inherits the previous
        // section's selection state (a real concern for concatenated
        // notes that contain multiple H1s).
        if (level === 1) { h2 = -1; h3 = -1 }
        else if (level === 2) { h2 = pos; h3 = -1; pos++ }
        else if (level === 3) { h3 = pos; pos++ }
        if (shouldEmit()) out.push(line)
        continue
      }
      if (shouldEmit()) out.push(line)
    }
    return out.join("\\n")
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
    // Quartz's SPA router has a window-level click listener that hijacks
    // any same-origin <a> click without data-router-ignore. Blob URLs
    // inherit the page's origin, so the synthetic click would otherwise
    // be intercepted: HTML blobs get morphed into the current page, and
    // ipynb blobs (non-text/html) fall through to window.location.assign,
    // navigating to blob:… instead of triggering the download.
    a.setAttribute("data-router-ignore", "")
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
    const checked = getCheckedIndices()
    // Bail early on an explicit empty selection — exporting a notebook
    // with zero cells (or HTML with only the title) is almost certainly
    // a misclick, and the silent-no-op result is confusing.
    if (checked && checked.size === 0) {
      alert("Select at least one section to export.")
      btn.textContent = orig
      btn.removeAttribute("disabled")
      return
    }
    try {
      if (fmt === "html") await exportHtml(checked)
      else if (fmt === "ipynb") await exportIpynb(checked)
    } finally {
      btn.textContent = orig
      btn.removeAttribute("disabled")
      close()
    }
  }

  populateSections()

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
        style="position: absolute; right: 0; top: 100%; min-width: 14em; max-width: 22em; background: var(--light); border: 1px solid var(--lightgray); border-radius: 4px; box-shadow: 0 2px 6px rgba(0,0,0,0.08); padding: 0.25em 0; z-index: 5; font-size: 0.9rem;"
      >
        <div class="export-sections" data-router-ignore="true" style="display: none;"></div>
        <div class="export-formats">
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
      </div>
    </details>
  )
}

ExportArticle.afterDOMLoaded = exportScript

export default (() => ExportArticle) satisfies QuartzComponentConstructor
