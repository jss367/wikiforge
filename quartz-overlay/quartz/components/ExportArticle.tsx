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

  // ----- shared HTML-builder helpers ---------------------------------------
  // Hoisted out of exportHtml so the PDF and ZIP exporters can build the
  // same standalone document without duplicating CSS collection or escape
  // logic.

  function escapeHtmlText(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  }

  // Relative URLs (e.g. "../images/foo.png", "/topics/bar") resolve
  // against the *file path* of the exported HTML once it's opened from
  // disk, which would 404. Absolutize against the current page so assets
  // and internal links still point back at the live site.
  function absolutizeAttr(el, attr) {
    const v = el.getAttribute(attr)
    if (!v || v.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(v)) return
    try {
      el.setAttribute(attr, new URL(v, location.href).href)
    } catch (e) {}
  }

  // Collect inline <style> blocks plus the contents of every same-origin
  // stylesheet. Cross-origin sheets (e.g. Google Fonts) are skipped: the
  // browser blocks fetch() for those and we'd hang. Skipping them just
  // means the export falls back to system fonts, which is acceptable for
  // a portable single-file copy.
  async function collectCss() {
    const styleParts = []
    document.querySelectorAll("style").forEach((s) => {
      if (s.textContent) styleParts.push(s.textContent)
    })
    const linkEls = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    const linkContents = await Promise.all(
      linkEls.map((l) => {
        // Compare URL.origin rather than \`href.startsWith(location.origin)\`.
        // The prefix form treats \`https://example.com.evil.net/...\` as
        // same-origin against \`https://example.com\`, which is wrong; here the
        // CORS layer would catch it anyway, but the principle is consistent
        // with the ZIP exporter below.
        const href = l.href
        if (!href) return Promise.resolve("")
        let same = false
        try { same = new URL(href).origin === location.origin } catch (e) {}
        if (!same) return Promise.resolve("")
        return fetch(href).then((r) => (r.ok ? r.text() : "")).catch(() => "")
      }),
    )
    return styleParts.concat(linkContents).join("\\n\\n")
  }

  // Wrap the article in the same nesting Quartz uses so the page's CSS
  // selectors (.page, .center, .popover-hint, #quartz-body) still match.
  // \`extraStyle\` lets callers append print-specific or bundle-specific
  // rules (e.g. PDF export hides the print dialog noise via @page).
  function buildStandaloneHtml(clone, css, titleText, extraStyle) {
    return '<!DOCTYPE html>\\n<html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + escapeHtmlText(titleText) + '</title>' +
      '<style>' + css + '\\n' +
      '.sidebar,.header,.breadcrumb-container,.export-article,.edit-in-obsidian{display:none!important}' +
      'body{margin:0;padding:2rem 1rem}' +
      '.page,.center{max-width:750px;margin:0 auto}' +
      (extraStyle || "") +
      '</style></head><body><div id="quartz-root"><div id="quartz-body">' +
      '<div class="page">' +
      clone.outerHTML +
      '</div></div></div></body></html>'
  }

  // ----- HTML export (standalone single-file copy of the rendered page) -----
  async function exportHtml(checked) {
    const center = document.querySelector(".center")
    if (!center) return
    const css = await collectCss()
    const titleEl = center.querySelector("h1, .article-title")
    const titleText = (titleEl && titleEl.textContent) || document.title || "page"
    const clone = center.cloneNode(true)
    clone.querySelectorAll("[src]").forEach((el) => absolutizeAttr(el, "src"))
    clone.querySelectorAll("[href]").forEach((el) => absolutizeAttr(el, "href"))
    filterClonedArticle(clone, checked)
    const html = buildStandaloneHtml(clone, css, titleText)
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

  // ----- shared "fetch the .md source" wrapper ------------------------------
  // Several exporters (Markdown, Plain text, LaTeX, JSON, Jupyter) start the
  // same way: pull the raw markdown for this slug, alert on miss. Centralised
  // so the alert wording stays consistent and a future move (e.g. cached
  // source, pre-fetched bundle) is one edit instead of five.
  async function fetchSourceMd() {
    const slug = root.getAttribute("data-slug")
    if (!slug) return null
    const res = await fetch("/" + slug + ".md")
    if (!res.ok) {
      alert("Could not load markdown source for this page (" + res.status + ").")
      return null
    }
    return await res.text()
  }

  function getTitleText() {
    const titleEl = document.querySelector(".center h1, .center .article-title")
    return (titleEl && titleEl.textContent) || document.title || "page"
  }

  // ----- Markdown export (raw .md, frontmatter stripped) -------------------
  // The source file is already markdown; this exporter just hands it back to
  // the user with frontmatter stripped (otherwise the YAML block re-renders
  // as a "---" thematic break + table on systems without frontmatter
  // support) and the section picker applied.
  async function exportMarkdown(checked) {
    const rawMd = await fetchSourceMd()
    if (rawMd == null) return
    const md = filterMarkdownByHeadings(stripFrontmatter(rawMd), checked)
    triggerDownload(
      new Blob([md], { type: "text/markdown;charset=utf-8" }),
      getTitleText(),
      "md",
    )
  }

  // ----- Plain text export --------------------------------------------------
  // Operates on the markdown source rather than the rendered DOM: the source
  // is closer to "what the author wrote," code fences survive verbatim, and
  // the output is line-stable across rebuilds. The DOM path would inherit
  // theme-specific decorations (line numbers, copy buttons, callout glyphs)
  // that read as garbage in a plain-text file.
  async function exportText(checked) {
    const rawMd = await fetchSourceMd()
    if (rawMd == null) return
    const md = filterMarkdownByHeadings(stripFrontmatter(rawMd), checked)
    const text = mdToText(md, getTitleText())
    triggerDownload(
      new Blob([text], { type: "text/plain;charset=utf-8" }),
      getTitleText(),
      "txt",
    )
  }

  // Strip markdown syntax from prose; pass code blocks through unchanged.
  // Patterns are applied in an order that minimises cross-interference
  // (images before links, fenced code never reached because tokenize keeps
  // it segregated). Inline math \`$x$\` / \`$$x$$\` is NOT special-cased — it
  // stays as \`$x$\` in the output, which is closer to "what the author
  // typed" than a half-stripped LaTeX expression would be.
  function mdToText(md, titleText) {
    let body = md
    if (!/^#\\s/.test(body)) body = "# " + titleText + "\\n\\n" + body
    const segments = tokenize(body)
    const parts = []
    for (const s of segments) {
      if (s.type === "code") {
        parts.push(s.lines.join("\\n"))
        continue
      }
      let txt = s.lines.join("\\n")
      // ATX headings: drop leading #s and any trailing # run.
      txt = txt.replace(/^\\s{0,3}#{1,6}\\s+(.+?)\\s*#*\\s*$/gm, "$1")
      // Setext headings: collapse "Title\\n===" / "Title\\n---" to just Title.
      txt = txt.replace(/^(.+)\\n=+\\s*$/gm, "$1")
      txt = txt.replace(/^(.+)\\n-+\\s*$/gm, "$1")
      // Images first so their alt text survives the link pass below.
      txt = txt.replace(/!\\[([^\\]]*)\\]\\([^)]*\\)/g, "$1")
      // Markdown links: keep visible text, drop URL.
      txt = txt.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, "$1")
      // Wikilinks: \`[[target|alias]]\` → alias, \`[[target]]\` → target.
      txt = txt.replace(/\\[\\[([^\\]|]+)\\|([^\\]]+)\\]\\]/g, "$2")
      txt = txt.replace(/\\[\\[([^\\]]+)\\]\\]/g, "$1")
      // Bold/italic/strike (bold first so its inner * isn't read as italic).
      txt = txt.replace(/(\\*\\*|__)(.+?)\\1/g, "$2")
      txt = txt.replace(/(?:\\*|_)([^*_\\n]+)(?:\\*|_)/g, "$1")
      txt = txt.replace(/~~([^~\\n]+)~~/g, "$1")
      // Inline code.
      txt = txt.replace(/\`([^\`]+)\`/g, "$1")
      // List markers (unordered + ordered).
      txt = txt.replace(/^\\s*[-*+]\\s+/gm, "")
      txt = txt.replace(/^\\s*\\d+[.)]\\s+/gm, "")
      // Blockquote markers.
      txt = txt.replace(/^\\s*>\\s?/gm, "")
      // Horizontal rules.
      txt = txt.replace(/^\\s*[-*_]{3,}\\s*$/gm, "")
      parts.push(txt)
    }
    return parts.join("\\n").replace(/\\n{3,}/g, "\\n\\n").trim() + "\\n"
  }

  // ----- LaTeX export -------------------------------------------------------
  // Best-effort markdown -> LaTeX. Handles the common shapes (headings,
  // paragraphs, bullet/numbered lists, fenced code via listings, links,
  // emphasis, inline + display math passthrough, images via graphicx). Does
  // NOT handle: GFM tables, footnotes, definition lists, callouts. The
  // output is a self-contained .tex skeleton that compiles with stock
  // pdflatex on any document that sticks to those common shapes.
  async function exportLatex(checked) {
    const rawMd = await fetchSourceMd()
    if (rawMd == null) return
    const md = filterMarkdownByHeadings(stripFrontmatter(rawMd), checked)
    const tex = mdToLatex(md, getTitleText())
    triggerDownload(
      new Blob([tex], { type: "application/x-tex;charset=utf-8" }),
      getTitleText(),
      "tex",
    )
  }

  // Escape a plain-text run for LaTeX. Order matters: backslash first
  // (otherwise the replacements below would double-escape their own \\\\),
  // then the simple character substitutions, then ~ and ^ which need
  // command form because LaTeX treats the bare characters specially.
  function escapeLatex(s) {
    return s
      .replace(/\\\\/g, "\\\\textbackslash{}")
      .replace(/([&%$#_{}])/g, "\\\\$1")
      .replace(/~/g, "\\\\textasciitilde{}")
      .replace(/\\^/g, "\\\\textasciicircum{}")
  }

  // Inline transformer: markdown spans inside a single line of prose.
  // We tokenize into "math" runs (passed through verbatim — LaTeX already
  // understands \`$...$\` / \`$$...$$\`) and "text" runs (markdown patterns
  // converted to LaTeX commands). Patterns are converted into placeholders
  // first, the surrounding text is escaped, and the placeholders are
  // expanded last so escapeLatex doesn't mangle the LaTeX commands.
  // Sentinel char \\u0000 is used because it can't appear in a markdown
  // file (the build pipeline strips NULs) so we don't need to worry about
  // it colliding with real content.
  function inlineToLatex(s) {
    const NUL = "\\u0000"
    const out = []
    let i = 0
    while (i < s.length) {
      if (s[i] === "$") {
        // Display math first.
        if (s[i + 1] === "$") {
          const end = s.indexOf("$$", i + 2)
          if (end !== -1) { out.push({ raw: true, v: s.slice(i, end + 2) }); i = end + 2; continue }
        }
        const end = s.indexOf("$", i + 1)
        if (end !== -1) { out.push({ raw: true, v: s.slice(i, end + 1) }); i = end + 1; continue }
        out.push({ raw: false, v: "$" }); i++; continue
      }
      let j = s.indexOf("$", i)
      if (j === -1) j = s.length
      out.push({ raw: false, v: s.slice(i, j) })
      i = j
    }
    return out.map((p) => {
      if (p.raw) return p.v
      let t = p.v
      const slots = []
      const stash = (val) => { slots.push(val); return NUL + (slots.length - 1) + NUL }
      // Inline code first so its content isn't mangled by emphasis below.
      t = t.replace(/\`([^\`]+)\`/g, (_, x) => stash("\\\\texttt{" + escapeLatex(x) + "}"))
      // Images before links (![alt](url) starts with "!" so a naked link
      // pattern would otherwise consume the leading "[alt](url)").
      t = t.replace(/!\\[([^\\]]*)\\]\\(([^)]+)\\)/g, (_, alt, url) =>
        stash("\\\\includegraphics[width=\\\\linewidth]{" + url + "}"))
      t = t.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, (_, text, url) =>
        stash("\\\\href{" + url + "}{" + escapeLatex(text) + "}"))
      // Wikilinks: render alias text only — the target is a vault path
      // that means nothing outside the wiki.
      t = t.replace(/\\[\\[([^\\]|]+)\\|([^\\]]+)\\]\\]/g, (_, _t, alias) => stash(escapeLatex(alias)))
      t = t.replace(/\\[\\[([^\\]]+)\\]\\]/g, (_, target) => stash(escapeLatex(target)))
      // Bold before italic so **x** isn't misread as italic-then-italic.
      t = t.replace(/\\*\\*([^*]+)\\*\\*/g, (_, x) => stash("\\\\textbf{" + escapeLatex(x) + "}"))
      t = t.replace(/__([^_]+)__/g, (_, x) => stash("\\\\textbf{" + escapeLatex(x) + "}"))
      t = t.replace(/\\*([^*\\n]+)\\*/g, (_, x) => stash("\\\\emph{" + escapeLatex(x) + "}"))
      t = t.replace(/(?:^|[^A-Za-z0-9])_([^_\\n]+)_/g, (m, x) => {
        // Underscore italic: only when not surrounded by word chars (so
        // identifiers like \`my_var\` aren't italicised). Preserve the
        // leading boundary char.
        const lead = m.slice(0, m.length - x.length - 2)
        return lead + stash("\\\\emph{" + escapeLatex(x) + "}")
      })
      t = t.replace(/~~([^~\\n]+)~~/g, (_, x) => stash("\\\\sout{" + escapeLatex(x) + "}"))
      // Now escape the rest of the text and re-expand stashed LaTeX.
      t = escapeLatex(t)
      t = t.replace(new RegExp(NUL + "(\\\\d+)" + NUL, "g"), (_, idx) => slots[parseInt(idx)])
      return t
    }).join("")
  }

  // Walk lines of prose and emit LaTeX block constructs. Open/close list
  // and quote environments as we cross their boundaries so nested or
  // adjacent constructs render correctly. Setext headings are folded into
  // their ATX equivalents up front because the rest of the walker only
  // recognises ATX form.
  function proseToLatex(text) {
    let txt = text
      .replace(/^(.+)\\n=+\\s*$/gm, "# $1")
      .replace(/^(.+)\\n-+\\s*$/gm, "## $1")
    const lines = txt.split(/\\r?\\n/)
    const out = []
    let listKind = null  // "ul" | "ol" | null
    let inQuote = false
    const closeList = () => {
      if (listKind === "ul") out.push("\\\\end{itemize}")
      if (listKind === "ol") out.push("\\\\end{enumerate}")
      listKind = null
    }
    const closeQuote = () => {
      if (inQuote) out.push("\\\\end{quote}")
      inQuote = false
    }
    const headingCmd = (level) => {
      // beyond \\subsubsection LaTeX has \\paragraph and \\subparagraph;
      // they render inline rather than as standalone titles, which is
      // closer to what an h5/h6 in a markdown doc usually means.
      if (level === 1) return "\\\\section*"
      if (level === 2) return "\\\\subsection*"
      if (level === 3) return "\\\\subsubsection*"
      if (level === 4) return "\\\\paragraph*"
      return "\\\\subparagraph*"
    }
    for (const line of lines) {
      const hM = line.match(/^\\s{0,3}(#{1,6})\\s+(.+?)\\s*#*\\s*$/)
      if (hM) {
        closeList(); closeQuote()
        out.push(headingCmd(hM[1].length) + "{" + inlineToLatex(hM[2]) + "}")
        continue
      }
      const ulM = line.match(/^\\s*[-*+]\\s+(.*)$/)
      if (ulM) {
        closeQuote()
        if (listKind !== "ul") { closeList(); out.push("\\\\begin{itemize}"); listKind = "ul" }
        out.push("  \\\\item " + inlineToLatex(ulM[1]))
        continue
      }
      const olM = line.match(/^\\s*\\d+[.)]\\s+(.*)$/)
      if (olM) {
        closeQuote()
        if (listKind !== "ol") { closeList(); out.push("\\\\begin{enumerate}"); listKind = "ol" }
        out.push("  \\\\item " + inlineToLatex(olM[1]))
        continue
      }
      const qM = line.match(/^\\s*>\\s?(.*)$/)
      if (qM) {
        closeList()
        if (!inQuote) { out.push("\\\\begin{quote}"); inQuote = true }
        out.push(inlineToLatex(qM[1]))
        continue
      }
      const hrM = line.match(/^\\s*[-*_]{3,}\\s*$/)
      if (hrM) {
        closeList(); closeQuote()
        out.push("\\\\hrule")
        continue
      }
      if (line.trim() === "") {
        closeList(); closeQuote()
        out.push("")
        continue
      }
      // Plain prose line.
      closeList(); closeQuote()
      out.push(inlineToLatex(line))
    }
    closeList(); closeQuote()
    return out.join("\\n")
  }

  function mdToLatex(rawMd, titleText) {
    let md = rawMd.replace(/^(?:[ \\t]*\\r?\\n)+/, "")
    if (!/^#\\s/.test(md)) md = "# " + titleText + "\\n\\n" + md
    const segments = tokenize(md)
    const bodyParts = []
    for (const s of segments) {
      if (s.type === "code") {
        // listings package renders code blocks with optional language
        // highlighting. Unknown languages just render as monospaced
        // blocks; that's strictly better than dropping the fence.
        const lang = (s.lang || "").replace(/[^A-Za-z0-9+#-]/g, "")
        bodyParts.push(
          "\\\\begin{lstlisting}" + (lang ? "[language=" + lang + "]" : "") + "\\n" +
          s.lines.join("\\n") + "\\n\\\\end{lstlisting}"
        )
      } else {
        bodyParts.push(proseToLatex(s.lines.join("\\n")))
      }
    }
    // Document preamble. \`graphicx\` for images, \`hyperref\` for links,
    // \`listings\` for code, \`ulem\` for strikethrough, \`amsmath/amssymb\`
    // for math. \`xurl\` lets long URLs in href targets break across lines
    // instead of overflowing the page width.
    return [
      "\\\\documentclass[11pt]{article}",
      "\\\\usepackage[utf8]{inputenc}",
      "\\\\usepackage[T1]{fontenc}",
      "\\\\usepackage{amsmath, amssymb}",
      "\\\\usepackage{graphicx}",
      "\\\\usepackage{listings}",
      "\\\\usepackage[normalem]{ulem}",
      "\\\\usepackage{hyperref}",
      "\\\\usepackage{xurl}",
      "\\\\setlength{\\\\parskip}{0.5em}",
      "\\\\setlength{\\\\parindent}{0pt}",
      "\\\\title{" + escapeLatex(titleText) + "}",
      "\\\\date{}",
      "\\\\begin{document}",
      "\\\\maketitle",
      "",
      bodyParts.join("\\n\\n"),
      "",
      "\\\\end{document}",
      "",
    ].join("\\n")
  }

  // ----- JSON export --------------------------------------------------------
  // Structured representation: title, slug, intro (text before the first
  // h2/h3), and an array of sections each carrying its heading, level, and
  // body markdown. Useful for piping into other tools (LLMs, search
  // indexers, custom renderers) without re-parsing markdown each time.
  async function exportJson(checked) {
    const slug = root.getAttribute("data-slug")
    if (!slug) return
    const rawMd = await fetchSourceMd()
    if (rawMd == null) return
    const md = filterMarkdownByHeadings(stripFrontmatter(rawMd), checked)
    const split = mdToSections(md)
    const payload = {
      title: getTitleText(),
      slug,
      exported_at: new Date().toISOString(),
      intro: split.intro,
      sections: split.sections,
    }
    triggerDownload(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
      getTitleText(),
      "json",
    )
  }

  // Walk lines, splitting on h2/h3 boundaries (h1 closes any open section
  // but doesn't open a new one — callers want the H1 to stay with the
  // intro). Code-fence tracking mirrors filterMarkdownByHeadings so a
  // "## foo" inside a fence isn't misread as a section split.
  //
  // ATX-only: setext headings ("Title\\n===" / "Title\\n---") are not
  // recognised as section breaks. This matches the rest of this file —
  // the picker, filterMarkdownByHeadings, and countMdHeadings are all
  // ATX-only — so a setext-authored page degrades the same way across
  // all export paths (everything lands in \`intro\`, no sections). Adding
  // setext support requires a coordinated change across all four sites
  // plus disambiguation against thematic breaks; out of scope here.
  function mdToSections(md) {
    const lines = md.split(/\\r?\\n/)
    let inFence = false, fenceChar = "", fenceLen = 0
    const intro = { lines: [] }
    const sections = []
    let cur = intro
    for (const line of lines) {
      if (inFence) {
        cur.lines.push(line)
        if (isFenceCloser(line, fenceChar, fenceLen)) inFence = false
        continue
      }
      const fenceM = line.match(/^(\\s{0,3})([\\\`~]{3,})/)
      if (fenceM) {
        inFence = true
        fenceChar = fenceM[2][0]
        fenceLen = fenceM[2].length
        cur.lines.push(line)
        continue
      }
      const hM = line.match(/^\\s{0,3}(#{1,6})\\s+(.+?)\\s*#*\\s*$/)
      if (hM) {
        const level = hM[1].length
        if (level === 2 || level === 3) {
          cur = { heading: hM[2].trim(), level, lines: [] }
          sections.push(cur)
          continue
        }
        // H1 closes any open section; the H1 line and any prose following it
        // (until the next h2/h3) lands in \`intro\`. Without this reset, a
        // page with a mid-document H1 would silently glue the H1 onto the
        // previous section's body.
        if (level === 1) cur = intro
      }
      cur.lines.push(line)
    }
    const trim = (arr) => arr.join("\\n").replace(/^\\n+|\\n+$/g, "")
    return {
      intro: trim(intro.lines),
      sections: sections.map((s) => ({
        heading: s.heading,
        level: s.level,
        body: trim(s.lines),
      })),
    }
  }

  // ----- PDF export (browser print to PDF via hidden iframe) ----------------
  // No JS-side PDF library: we build the same standalone HTML the .html
  // exporter produces, drop it into a hidden iframe, and call print() on
  // the iframe's window. The user picks "Save as PDF" in the browser's
  // print dialog. This avoids a popup window (which most browsers block by
  // default) and any server-side rendering, at the cost of one extra
  // click compared to a "real" PDF export.
  async function exportPdf(checked) {
    const center = document.querySelector(".center")
    if (!center) return
    const css = await collectCss()
    const titleText = getTitleText()
    const clone = center.cloneNode(true)
    clone.querySelectorAll("[src]").forEach((el) => absolutizeAttr(el, "src"))
    clone.querySelectorAll("[href]").forEach((el) => absolutizeAttr(el, "href"))
    filterClonedArticle(clone, checked)
    // \`@page\` hints the print dialog at sensible margins; \`color-adjust:
    // exact\` keeps code-block backgrounds and callout fills from being
    // washed out under the browser's default print colour adjustment.
    const printStyle =
      "@media print { @page { margin: 1.6cm; } " +
      "html, body { background: white !important; } " +
      "* { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } " +
      "}"
    const html = buildStandaloneHtml(clone, css, titleText, printStyle)

    const iframe = document.createElement("iframe")
    iframe.setAttribute("aria-hidden", "true")
    iframe.style.cssText = "position:fixed; right:0; bottom:0; width:0; height:0; border:0; visibility:hidden;"
    document.body.appendChild(iframe)
    iframe.srcdoc = html
    iframe.addEventListener("load", () => {
      const win = iframe.contentWindow
      if (!win) { iframe.remove(); return }
      // Some browsers (Safari) only fire afterprint reliably; others
      // (Chrome) return synchronously from print(). The 60s fallback
      // guarantees the iframe doesn't leak if neither path triggers.
      let removed = false
      const cleanup = () => { if (!removed) { removed = true; iframe.remove() } }
      win.addEventListener("afterprint", cleanup)
      try { win.focus(); win.print() } catch (e) { cleanup(); return }
      setTimeout(cleanup, 60000)
    }, { once: true })
  }

  // ----- ZIP bundle export (HTML + same-origin images) ---------------------
  // For users who want a real offline archive: the standalone HTML plus
  // every image it references, fetched and rewritten to local paths. Same
  // structure as a saved-page bundle in a browser, but built deterministically
  // (no race against lazy-loaded assets) and without the "page_files/"
  // directory clutter browsers add.
  //
  // The ZIP is written in STORE mode (no compression) so we don't need to
  // pull in a deflate implementation. PNG / JPEG / WebP are already
  // compressed image formats, and the HTML file is small, so the size hit
  // is minor in practice.
  async function exportZip(checked) {
    const center = document.querySelector(".center")
    if (!center) return
    const css = await collectCss()
    const titleText = getTitleText()
    const clone = center.cloneNode(true)
    // Filter first so we don't fetch images that belong to dropped sections.
    filterClonedArticle(clone, checked)
    // Hrefs (text links) absolutize back to the live site — same as the
    // .html export. Images are special-cased below: same-origin ones are
    // fetched and bundled, cross-origin ones are absolutized so they
    // continue to work when the user views the bundled HTML online.
    clone.querySelectorAll("[href]").forEach((el) => absolutizeAttr(el, "href"))

    const usedNames = new Set()
    function pickLocalName(url) {
      let pathname = ""
      try { pathname = new URL(url).pathname } catch (e) { return "images/asset.bin" }
      let base = pathname.split("/").pop() || "asset"
      // Browsers tolerate spaces / unicode in zip filenames but some zip
      // tools don't. Normalize to a conservative subset.
      base = decodeURIComponent(base).replace(/[^A-Za-z0-9._-]+/g, "_")
      if (!base || base === "_") base = "asset"
      if (!base.includes(".")) base += ".bin"
      let name = base
      let i = 1
      while (usedNames.has(name)) {
        const dot = base.lastIndexOf(".")
        name = base.slice(0, dot) + "-" + i + base.slice(dot)
        i++
      }
      usedNames.add(name)
      return "images/" + name
    }

    // Two-pass: collect (img, abs) pairs and the deduped URL set, fetch in
    // parallel, then rewrite \`src\` only for URLs whose fetch actually
    // succeeded. Eager rewriting (the previous shape) left a dead path in
    // \`index.html\` whenever a same-origin fetch returned non-OK — the local
    // file was filtered out before entry creation, so the bundle pointed at
    // a name it never wrote.
    const tasks = []
    const uniqUrls = new Set()
    clone.querySelectorAll("img[src]").forEach((img) => {
      const v = img.getAttribute("src")
      if (!v) return
      let url
      try { url = new URL(v, location.href) } catch (e) { return }
      const abs = url.href
      // Compare \`URL.origin\`, not \`href.startsWith(location.origin)\`. The
      // prefix form misclassifies \`https://example.com.evil.net/foo.png\`
      // as same-origin against \`https://example.com\`.
      if (url.origin !== location.origin) {
        // Cross-origin: leave the absolute URL so the bundled HTML still
        // resolves it from the network when the user views the file.
        img.setAttribute("src", abs)
        return
      }
      tasks.push({ img, abs })
      uniqUrls.add(abs)
    })
    // Same handling for srcset would multiply fetches with marginal value
    // for a static-archive use case; stripping srcset keeps the bundle
    // simple and predictable.
    clone.querySelectorAll("img[srcset]").forEach((img) => img.removeAttribute("srcset"))

    const urls = Array.from(uniqUrls)
    const buffers = await Promise.all(
      urls.map((u) =>
        fetch(u)
          .then((r) => (r.ok ? r.arrayBuffer() : null))
          .catch(() => null),
      ),
    )
    // Reserve local names only for URLs we actually fetched, so a failed
    // fetch doesn't burn a name slot or leave the bundle inconsistent.
    const localByUrl = new Map()
    const fetched = []
    urls.forEach((u, i) => {
      const buf = buffers[i]
      if (!buf) return
      const local = pickLocalName(u)
      localByUrl.set(u, local)
      fetched.push({ local, data: new Uint8Array(buf) })
    })
    for (const t of tasks) {
      const local = localByUrl.get(t.abs)
      // Successful fetch → point at the bundled file. Failure → keep the
      // absolute URL so the image still loads online when the bundle is
      // viewed against the live site, and degrades cleanly to a "broken
      // image" icon offline rather than a 404 inside the archive.
      t.img.setAttribute("src", local || t.abs)
    }

    const html = buildStandaloneHtml(clone, css, titleText)
    const enc = new TextEncoder()
    const entries = [{ name: "index.html", data: enc.encode(html) }]
    for (const f of fetched) entries.push({ name: f.local, data: f.data })

    triggerDownload(buildZip(entries), titleText, "zip")
  }

  // ----- ZIP encoder (STORE mode only, hand-rolled) -------------------------
  // PKZIP format: per-file local headers, a central directory with one
  // entry per file, and an end-of-central-directory record. STORE means
  // compression method 0 (no compression), which keeps us out of needing
  // a deflate implementation. Sizes that would overflow uint32 trigger
  // ZIP64 in the spec; we don't generate that — a single-page bundle
  // shouldn't approach 4 GiB.
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
      t[n] = c >>> 0
    }
    return t
  })()

  function crc32(bytes) {
    let c = 0xffffffff
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }

  function buildZip(entries) {
    const enc = new TextEncoder()
    const parts = []
    const central = []
    let offset = 0
    for (const e of entries) {
      const name = enc.encode(e.name)
      const data = e.data
      const crc = crc32(data)
      const size = data.length
      const lfh = new Uint8Array(30)
      const dvL = new DataView(lfh.buffer)
      dvL.setUint32(0, 0x04034b50, true)
      dvL.setUint16(4, 20, true)
      dvL.setUint16(6, 0, true)
      dvL.setUint16(8, 0, true)
      dvL.setUint16(10, 0, true)
      dvL.setUint16(12, 0x21, true) // dummy date (1980-01-01)
      dvL.setUint32(14, crc, true)
      dvL.setUint32(18, size, true)
      dvL.setUint32(22, size, true)
      dvL.setUint16(26, name.length, true)
      dvL.setUint16(28, 0, true)
      parts.push(lfh, name, data)

      const cdh = new Uint8Array(46)
      const dvC = new DataView(cdh.buffer)
      dvC.setUint32(0, 0x02014b50, true)
      dvC.setUint16(4, 20, true)
      dvC.setUint16(6, 20, true)
      dvC.setUint16(8, 0, true)
      dvC.setUint16(10, 0, true)
      dvC.setUint16(12, 0, true)
      dvC.setUint16(14, 0x21, true)
      dvC.setUint32(16, crc, true)
      dvC.setUint32(20, size, true)
      dvC.setUint32(24, size, true)
      dvC.setUint16(28, name.length, true)
      dvC.setUint16(30, 0, true)
      dvC.setUint16(32, 0, true)
      dvC.setUint16(34, 0, true)
      dvC.setUint16(36, 0, true)
      dvC.setUint32(38, 0, true)
      dvC.setUint32(42, offset, true)
      central.push(cdh, name)

      offset += 30 + name.length + size
    }
    const cdStart = offset
    let cdSize = 0
    for (const p of central) cdSize += p.length
    const eocd = new Uint8Array(22)
    const dvE = new DataView(eocd.buffer)
    dvE.setUint32(0, 0x06054b50, true)
    dvE.setUint16(4, 0, true)
    dvE.setUint16(6, 0, true)
    dvE.setUint16(8, entries.length, true)
    dvE.setUint16(10, entries.length, true)
    dvE.setUint32(12, cdSize, true)
    dvE.setUint32(16, cdStart, true)
    dvE.setUint16(20, 0, true)

    return new Blob([...parts, ...central, eocd], { type: "application/zip" })
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
      else if (fmt === "pdf") await exportPdf(checked)
      else if (fmt === "md") await exportMarkdown(checked)
      else if (fmt === "txt") await exportText(checked)
      else if (fmt === "ipynb") await exportIpynb(checked)
      else if (fmt === "tex") await exportLatex(checked)
      else if (fmt === "json") await exportJson(checked)
      else if (fmt === "zip") await exportZip(checked)
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
            data-fmt="pdf"
            data-router-ignore="true"
            style="display: block; width: 100%; text-align: left; padding: 0.4em 0.8em; background: none; border: none; color: var(--dark); cursor: pointer; font: inherit;"
          >
            PDF
          </button>
          <button
            type="button"
            role="menuitem"
            data-fmt="md"
            data-router-ignore="true"
            style="display: block; width: 100%; text-align: left; padding: 0.4em 0.8em; background: none; border: none; color: var(--dark); cursor: pointer; font: inherit;"
          >
            Markdown
          </button>
          <button
            type="button"
            role="menuitem"
            data-fmt="txt"
            data-router-ignore="true"
            style="display: block; width: 100%; text-align: left; padding: 0.4em 0.8em; background: none; border: none; color: var(--dark); cursor: pointer; font: inherit;"
          >
            Plain text
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
          <button
            type="button"
            role="menuitem"
            data-fmt="tex"
            data-router-ignore="true"
            style="display: block; width: 100%; text-align: left; padding: 0.4em 0.8em; background: none; border: none; color: var(--dark); cursor: pointer; font: inherit;"
          >
            LaTeX
          </button>
          <button
            type="button"
            role="menuitem"
            data-fmt="json"
            data-router-ignore="true"
            style="display: block; width: 100%; text-align: left; padding: 0.4em 0.8em; background: none; border: none; color: var(--dark); cursor: pointer; font: inherit;"
          >
            JSON
          </button>
          <button
            type="button"
            role="menuitem"
            data-fmt="zip"
            data-router-ignore="true"
            style="display: block; width: 100%; text-align: left; padding: 0.4em 0.8em; background: none; border: none; color: var(--dark); cursor: pointer; font: inherit;"
          >
            ZIP (HTML + assets)
          </button>
        </div>
      </div>
    </details>
  )
}

ExportArticle.afterDOMLoaded = exportScript

export default (() => ExportArticle) satisfies QuartzComponentConstructor
