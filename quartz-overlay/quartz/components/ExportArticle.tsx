import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import style from "./styles/exportArticle.scss"

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
      // Sidebars are hidden in the export, so the Quartz 750px column would leave
      // huge empty margins. Widen it for the standalone document.
      '.page,.center{max-width:1100px;margin:0 auto}' +
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
  //
  // Images are embedded as **code-cell display_data outputs**, not as
  // markdown-cell content. We tried two markdown-cell paths first:
  //   - \`data:\` URIs in markdown cells — stripped by GitHub's notebook
  //     renderer and ReviewNB (CSP excludes \`data:\` image sources).
  //   - \`attachment:NAME\` refs against cell.attachments — supported by
  //     JupyterLab/VS Code, but ReviewNB (despite their 2022 fix) was
  //     still showing the raw markdown text instead of rendering the
  //     image for our exports.
  // Code-cell outputs are the canonical "ran-the-notebook" image path:
  // every renderer that handles executed notebooks renders them. We
  // produce a synthetic \`display_data\` output per source image and split
  // the surrounding prose into markdown cells around each image. The
  // resulting .ipynb looks like one that was executed end-to-end.
  async function exportIpynb(checked) {
    const rawMd = await fetchSourceMd()
    if (rawMd == null) return
    const titleText = getTitleText()
    // Strip frontmatter before image resolution so a cover-image field
    // like \`cover: ![[banner.png]]\` doesn't get counted as a source ref
    // (the DOM doesn't render frontmatter, so the count would mismatch
    // and the fallback would skip image inlining entirely).
    // \`mdToNotebook\` strips frontmatter again internally — that's idempotent.
    const md = filterMarkdownByHeadings(stripFrontmatter(rawMd), checked)

    // Pair source image refs with rendered <img> URLs and resolve to
    // base64 + mime. \`resolveMdImageTargets\` returns null if there are no
    // images at all or the source-vs-DOM counts disagree; in either case
    // \`mdToNotebook\` ships the unmodified markdown.
    const resolved = await resolveMdImageTargets(md, checked, "raw")

    const notebook = mdToNotebook(md, titleText)
    if (resolved && resolved.imageData.length > 0) {
      notebook.cells = splitImagesIntoCodeCells(notebook.cells, resolved.imageData)
    }

    const json = JSON.stringify(notebook, null, 1)
    triggerDownload(new Blob([json], { type: "application/x-ipynb+json" }), titleText, "ipynb")
  }

  // ----- Jupyter Notebook export (zip-bundled with sibling images/) ---------
  // Sibling-folder variant for the GitHub-PR / ReviewNB review path. The
  // .ipynb keeps standard \`![alt](images/NAME)\` markdown image refs that
  // resolve against repo files once the user extracts the zip and commits
  // both pieces. That side-steps every CSP / sanitizer constraint the
  // single-file variant has to dance around: ReviewNB and GitHub diff
  // render relative-path image refs in \`.ipynb\` markdown cells the same
  // way they render \`.md\`, so inline images in tables/lists/blockquotes
  // (which the single-file variant has to fall back to \`data:\` URIs for)
  // render correctly here too.
  //
  // Trade-off vs the single-file Jupyter tile: not portable as a single
  // artifact — the user must keep the .ipynb and the \`images/\` folder
  // together. For the review-on-GitHub workflow this is the right shape;
  // for the drop-into-a-notebook-folder workflow, the single-file tile
  // remains the better pick.
  async function exportIpynbZip(checked) {
    const rawMd = await fetchSourceMd()
    if (rawMd == null) return
    const titleText = getTitleText()
    const md = filterMarkdownByHeadings(stripFrontmatter(rawMd), checked)

    // Reuse the Markdown-zip resolver: \`local\` mode rewrites image refs
    // to \`images/NAME\` and returns parallel zip entries. Same fallback
    // semantics as the markdown bundlers — count mismatch / no images
    // ships an unmodified single .ipynb.
    const resolved = await resolveMdImageTargets(md, checked, "local")
    let finalMd = md
    let imageEntries = []
    if (resolved) {
      const rewritten = rewriteMdImages(md, resolved.refs, resolved.targets)
      if (rewritten != null) {
        finalMd = rewritten
        imageEntries = resolved.entries
      }
    }

    const notebook = mdToNotebook(finalMd, titleText)
    const json = JSON.stringify(notebook, null, 1)

    // No images bundled (no source images, count mismatch, or every image
    // was cross-origin/failed) → ship a plain .ipynb. A zip wrapping a
    // single file is a worse artifact than just the file.
    if (imageEntries.length === 0) {
      triggerDownload(new Blob([json], { type: "application/x-ipynb+json" }), titleText, "ipynb")
      return
    }

    const enc = new TextEncoder()
    const entries = [
      { name: slugify(titleText) + ".ipynb", data: enc.encode(json) },
      ...imageEntries,
    ]
    triggerDownload(buildZip(entries), titleText, "zip")
  }

  // ----- Jupyter Notebook export (force every image into its own code cell) -
  // Empirical finding: ReviewNB does not render image refs in markdown
  // cells — not relative paths, not data URIs, not cell.attachments. The
  // only image-rendering path it honours reliably is \`cell.outputs[]\`
  // \`display_data\` entries on code cells (the canonical "ran-the-notebook"
  // form). The single-file Jupyter tile uses code-cell outputs only for
  // block-level images and falls back to inline \`data:\` URIs for images
  // sitting inside tables / lists / blockquotes — which means table-cell
  // images don't render in ReviewNB.
  //
  // This tile trades markdown structure for image-rendering coverage:
  // every image becomes a code cell with a \`display_data\` output, even
  // ones that were inline in a block construct. The surrounding table /
  // list will fragment around the extracted image (the markdown cells
  // that wrap each image become independent), but every image renders.
  // For PR review in ReviewNB this is the right trade.
  async function exportIpynbForReview(checked) {
    const rawMd = await fetchSourceMd()
    if (rawMd == null) return
    const titleText = getTitleText()
    const md = filterMarkdownByHeadings(stripFrontmatter(rawMd), checked)

    const resolved = await resolveMdImageTargets(md, checked, "raw")

    const notebook = mdToNotebook(md, titleText)
    if (resolved && resolved.imageData.length > 0) {
      notebook.cells = splitAllImagesIntoCodeCells(notebook.cells, resolved.imageData)
    }

    const json = JSON.stringify(notebook, null, 1)
    triggerDownload(new Blob([json], { type: "application/x-ipynb+json" }), titleText, "ipynb")
  }

  // Aggressive variant of \`splitImagesIntoCodeCells\`: every image — block
  // or inline — gets split into its own \`display_data\` code cell. The
  // surrounding markdown gets fragmented around the extraction (e.g. a
  // single table row \`| 20000 | ![](x.png) |\` becomes a markdown cell
  // with \`| 20000 | \`, a code cell with the image, and a markdown cell
  // with \` |\`). That fragmentation is intentional: rendering every image
  // is the whole point of this variant, and ReviewNB only renders code-
  // cell outputs.
  function splitAllImagesIntoCodeCells(cells, imageData) {
    const out = []
    let dataIdx = 0
    for (const cell of cells) {
      if (cell.cell_type !== "markdown") {
        out.push(cell)
        continue
      }
      const source = cell.source.join("")
      const refs = findMdImageRefs(source)
      if (refs.length === 0) {
        out.push(cell)
        continue
      }
      let cursor = 0
      for (const ref of refs) {
        const data = imageData[dataIdx++]
        const before = source.slice(cursor, ref.start)
        if (before.trim()) {
          out.push(makeMarkdownCell(before.replace(/^\\n+|\\n+$/g, "")))
        }
        if (data && data.embedded) {
          out.push(makeImageCodeCell(data.mime, data.base64))
        } else if (data && data.url) {
          // Cross-origin / failed fetch: no bytes to put in a code-cell
          // output. Emit a standalone markdown cell with normalized
          // CommonMark syntax — the same fallback the block-level branch
          // of splitImagesIntoCodeCells uses. Won't render in ReviewNB
          // but will resolve from the network elsewhere.
          out.push(makeMarkdownCell("![" + escapeMdAlt(ref.alt) + "](" + data.url + ")"))
        } else {
          out.push(makeMarkdownCell(source.slice(ref.start, ref.end)))
        }
        cursor = ref.end
      }
      const after = source.slice(cursor)
      if (after.trim()) {
        out.push(makeMarkdownCell(after.replace(/^\\n+|\\n+$/g, "")))
      }
    }
    return out
  }

  // Walk the cells emitted by \`mdToNotebook\` and replace each markdown
  // image reference with a synthetic code cell carrying the image as a
  // \`display_data\` output. \`imageData\` is a per-ref parallel array (in
  // document order); we walk it forward as we encounter image refs in
  // each markdown cell, since cells were emitted in document order too.
  //
  // Cross-origin / failed-fetch images keep their \`![](url)\` form in
  // the surrounding markdown cell — they'll resolve from the network
  // when the .ipynb is opened against a connected viewer, same as the
  // markdown bundlers' fallback.
  function splitImagesIntoCodeCells(cells, imageData) {
    const out = []
    let dataIdx = 0
    for (const cell of cells) {
      if (cell.cell_type !== "markdown") {
        out.push(cell)
        continue
      }
      const source = cell.source.join("")
      const refs = findMdImageRefs(source)
      if (refs.length === 0) {
        out.push(cell)
        continue
      }
      // Two ref categories:
      //   - block-level: image is the sole content of its line (preceded
      //     and followed only by whitespace on that line). Splits the cell:
      //     prose-before goes to a markdown cell, image becomes a code
      //     cell with display_data output, prose-after continues.
      //   - inline: image sits inside a list item, table row, blockquote,
      //     paragraph, etc. Splitting would fracture the surrounding block
      //     construct (notably table rows, which our reports use), so we
      //     rewrite the ref in place to \`![alt](data:...)\` and keep the
      //     line intact. Renderers that don't honour data URIs (ReviewNB,
      //     GitHub) won't show the inline image — preserving the table is
      //     a strictly better trade than turning one row into three cells.
      let cursor = 0
      let pending = ""
      for (const ref of refs) {
        const data = imageData[dataIdx++]
        const lineStart = source.lastIndexOf("\\n", ref.start - 1) + 1
        const lineEndIdx = source.indexOf("\\n", ref.end)
        const lineEnd = lineEndIdx === -1 ? source.length : lineEndIdx
        const beforeRef = source.slice(lineStart, ref.start)
        const afterRef = source.slice(ref.end, lineEnd)
        const isBlock = !beforeRef.trim() && !afterRef.trim()

        if (isBlock) {
          // Flush prose accumulated up to (but not including) this ref's
          // containing line, then emit the image cell.
          pending += source.slice(cursor, lineStart)
          if (pending.trim()) {
            out.push(makeMarkdownCell(pending.replace(/^\\n+|\\n+$/g, "")))
          }
          pending = ""
          if (data && data.embedded) {
            out.push(makeImageCodeCell(data.mime, data.base64))
          } else if (data && data.url) {
            // Cross-origin / failed fetch on a block-level ref: emit a
            // standalone markdown cell with normalized CommonMark syntax
            // rather than the original wikilink/HTML form, so renderers
            // that don't speak Obsidian wikilinks can still resolve the
            // image from the network.
            out.push(makeMarkdownCell("![" + escapeMdAlt(ref.alt) + "](" + data.url + ")"))
          } else {
            // Truly unresolvable (malformed src): preserve the original.
            out.push(makeMarkdownCell(source.slice(ref.start, ref.end)))
          }
          // Skip past the ref's full line, including its trailing newline.
          cursor = lineEnd + (lineEndIdx === -1 ? 0 : 1)
        } else {
          // Inline ref: rewrite in place so the surrounding block stays
          // intact. Embedded images become \`data:\` URIs (renders in
          // JupyterLab, VS Code, nbviewer; not in ReviewNB or GitHub
          // diff — but the alternative is breaking the table row, which
          // is worse than a missing inline image). Cross-origin / failed
          // fetches normalize to \`![alt](url)\`.
          pending += source.slice(cursor, ref.start)
          let target = null
          if (data && data.embedded) {
            target = "data:" + data.mime + ";base64," + data.base64
          } else if (data && data.url) {
            target = data.url
          }
          if (target != null) {
            pending += "![" + escapeMdAlt(ref.alt) + "](" + target + ")"
          } else {
            pending += source.slice(ref.start, ref.end)
          }
          cursor = ref.end
        }
      }
      pending += source.slice(cursor)
      if (pending.trim()) {
        out.push(makeMarkdownCell(pending.replace(/^\\n+|\\n+$/g, "")))
      }
    }
    return out
  }

  function makeMarkdownCell(text) {
    return { cell_type: "markdown", id: makeCellId(), metadata: {}, source: lineify(text) }
  }

  // Synthetic image-bearing code cell. \`source_hidden\` keeps the empty
  // input area collapsed in JupyterLab so the cell visually reads as
  // "image only"; renderers that don't honour it (ReviewNB, GitHub diff)
  // simply show an empty input region above the image, which still
  // renders the image correctly. \`execution_count: null\` marks the cell
  // as not-yet-run, which is the closest truthful state for a cell whose
  // output we baked rather than executed.
  function makeImageCodeCell(mime, base64) {
    return {
      cell_type: "code",
      id: makeCellId(),
      metadata: { jupyter: { source_hidden: true } },
      execution_count: null,
      source: [],
      outputs: [{
        output_type: "display_data",
        data: { [mime]: base64 },
        metadata: {},
      }],
    }
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

  // ----- Markdown export (zip-bundled with images, default) ---------------
  // The source file is already markdown; the only thing this exporter has to
  // resolve is image references. Source-markdown image syntax (\`![alt](url)\`,
  // \`![[wiki]]\`, \`<img>\`) and rendered \`<img>\` tags appear in the same
  // document order, so the i'th source ref pairs with the i'th DOM image.
  // If counts diverge — a plugin injected an extra image, a wikilink failed
  // to resolve, etc. — we ship the raw markdown unchanged rather than risk
  // pairing references with the wrong assets.
  //
  // Same-origin images get fetched and bundled into an \`images/\` folder.
  // Cross-origin images stay as absolute URLs so they load against the
  // network when the user views the file online.
  async function exportMarkdownZip(checked) {
    const rawMd = await fetchSourceMd()
    if (rawMd == null) return
    const md = filterMarkdownByHeadings(stripFrontmatter(rawMd), checked)
    const titleText = getTitleText()

    const targets = await resolveMdImageTargets(md, checked, "local")
    if (!targets) {
      // No DOM available, count mismatch, or no images at all. The first two
      // are recoverable failures; the third doesn't need a zip wrapper. All
      // three land here and ship the unmodified markdown.
      triggerDownload(new Blob([md], { type: "text/markdown;charset=utf-8" }), titleText, "md")
      return
    }
    const newMd = rewriteMdImages(md, targets.refs, targets.targets)
    if (newMd == null || targets.entries.length === 0) {
      // rewriteMdImages returns null only on a count mismatch, which
      // shouldn't reach here (resolveMdImageTargets filters that case).
      // Empty entries means every image was cross-origin or failed to
      // fetch — skip the zip wrapper, the rewritten markdown still loads
      // images against the network when viewed online.
      triggerDownload(
        new Blob([newMd || md], { type: "text/markdown;charset=utf-8" }),
        titleText,
        "md",
      )
      return
    }

    const enc = new TextEncoder()
    const entries = [
      { name: slugify(titleText) + ".md", data: enc.encode(newMd) },
      ...targets.entries,
    ]
    triggerDownload(buildZip(entries), titleText, "zip")
  }

  // ----- Markdown export (single .md, base64-inlined images) --------------
  // Same pairing logic as the zip variant; same-origin images are fetched
  // and inlined as \`data:<mime>;base64,<...>\` URIs. Output is a single
  // self-contained .md file, at the cost of ~33 % size inflation per image.
  // Cross-origin images keep their absolute URL so they continue to render
  // against the network.
  async function exportMarkdownInline(checked) {
    const rawMd = await fetchSourceMd()
    if (rawMd == null) return
    const md = filterMarkdownByHeadings(stripFrontmatter(rawMd), checked)
    const titleText = getTitleText()

    const targets = await resolveMdImageTargets(md, checked, "data")
    if (!targets) {
      triggerDownload(new Blob([md], { type: "text/markdown;charset=utf-8" }), titleText, "md")
      return
    }
    const newMd = rewriteMdImages(md, targets.refs, targets.targets) || md
    triggerDownload(new Blob([newMd], { type: "text/markdown;charset=utf-8" }), titleText, "md")
  }

  // Pair markdown image references with DOM-resolved image URLs and produce
  // the per-reference rewrite targets. \`mode\` selects the encoding:
  //   "local" — fetch same-origin images, return zip-relative paths plus a
  //             list of zip entries to write
  //   "data"  — fetch same-origin images, return base64 data URIs (no zip
  //             entries; the caller writes a single .md)
  // Returns null when the export should fall back to raw markdown:
  //   - the article DOM isn't available
  //   - the source has no images and the DOM has none either
  //   - the count of source references and DOM images doesn't match
  // Cross-origin URLs and fetch failures pass through as absolute URLs in
  // both modes.
  async function resolveMdImageTargets(md, checked, mode) {
    const center = document.querySelector(".center")
    if (!center) return null
    const clone = center.cloneNode(true)
    filterClonedArticle(clone, checked)

    const urls = collectArticleImageUrls(clone)
    const refs = findMdImageRefs(md)
    if (urls.length === 0 && refs.length === 0) return null
    if (urls.length !== refs.length) return null

    const buffers = await Promise.all(
      urls.map((u) => {
        if (!u || u.origin !== location.origin) return Promise.resolve(null)
        return fetch(u.href).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null)
      }),
    )

    const usedNames = new Set()
    const entries = []
    // For the Jupyter "raw" mode we return a per-ref parallel array
    // (\`imageData[i]\` pairs with \`refs[i]\`) carrying the embedded base64
    // and mime type, or the absolute URL for cross-origin / failed
    // fetches. The notebook exporter splits prose at each ref and emits a
    // synthetic code cell with that data as a \`display_data\` output.
    const imageData = []
    const targets = urls.map((u, i) => {
      if (!u) {
        imageData.push(null)
        return null
      }
      const buf = buffers[i]
      if (!buf) {
        imageData.push({ embedded: false, url: u.href })
        return u.href
      }
      if (mode === "local") {
        const local = pickLocalName(u.href, usedNames)
        entries.push({ name: local, data: new Uint8Array(buf) })
        imageData.push(null) // unused for this mode
        return local
      }
      if (mode === "raw") {
        const mime = mimeFromName(u.pathname)
        imageData.push({ embedded: true, mime, base64: bytesToBase64(new Uint8Array(buf)) })
        return null // raw mode doesn't rewrite the source — targets unused
      }
      // mode === "data"
      const mime = mimeFromName(u.pathname)
      imageData.push(null) // unused for this mode
      return "data:" + mime + ";base64," + bytesToBase64(new Uint8Array(buf))
    })

    return { refs, targets, entries, imageData }
  }

  // nbformat 4.5 requires every cell to have an \`id\` field (string of
  // 1–64 chars from [a-zA-Z0-9_-], unique within the notebook). JupyterLab
  // auto-fills IDs on load/save, but stricter consumers (nbformat schema
  // validators, GitHub's notebook diff, ReviewNB's renderer) treat a 4.5
  // notebook with missing IDs as out-of-spec and degrade rendering. 12
  // alphanumeric chars from Math.random — collision-free at notebook scale.
  function makeCellId() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    let id = ""
    for (let i = 0; i < 12; i++) id += chars[Math.floor(Math.random() * chars.length)]
    return id
  }

  // ----- shared image-bundling helpers -------------------------------------
  // Lifted out of exportZip so the markdown bundlers can reuse the same
  // local-name picker. \`usedNames\` is passed in (rather than closure-
  // captured) because each export call needs its own deduplication scope.
  function pickLocalName(url, usedNames) {
    let pathname = ""
    try { pathname = new URL(url).pathname } catch (e) { return "images/asset.bin" }
    let base = pathname.split("/").pop() || "asset"
    try { base = decodeURIComponent(base) } catch (e) {}
    base = base.replace(/[^A-Za-z0-9._-]+/g, "_")
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

  // Markdown renderers (Jupyter, GitHub, VS Code) sniff the type prefix of a
  // \`data:\` URI to decide whether to inline the asset. Without an image/*
  // type the embed silently degrades to a placeholder, so we map the file
  // extension to a MIME type explicitly.
  function mimeFromName(name) {
    const ext = (name.match(/\\.([A-Za-z0-9]+)$/) || ["", ""])[1].toLowerCase()
    const map = {
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
      gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
      avif: "image/avif", bmp: "image/bmp", ico: "image/x-icon",
    }
    return map[ext] || "application/octet-stream"
  }

  // \`btoa\` only takes a binary string, so we have to reconstruct one from
  // the byte array. \`String.fromCharCode.apply\` blows past its argument
  // limit (~65 k on most engines) for any image larger than that, so feed
  // it 32 KiB at a time.
  function bytesToBase64(bytes) {
    let bin = ""
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
    }
    return btoa(bin)
  }

  // Find image references in markdown source in document order. Each entry
  // carries the absolute character offset (start/end), kind, and resolved
  // alt text. Recognises three forms:
  //   ![[target|alias]]     — Obsidian wikilink embed
  //   ![alt](url "title")   — CommonMark image (optional title)
  //   <img src="...">       — raw HTML
  // Fenced code blocks are skipped so a literal \`![](x)\` inside a fence
  // isn't mistaken for a real reference.
  function findMdImageRefs(md) {
    const refs = []
    let inFence = false, fenceChar = "", fenceLen = 0
    // CommonMark allows unbracketed image URLs to contain *balanced* parens
    // (e.g. \`![cap](Screenshot (1).png)\` — common when Obsidian users paste
    // copy-suffixed filenames as standard markdown). \`[^\\s>)]+\` matched
    // only up to the first \`)\` and rewriteMdImages would then splice the
    // truncated slice, leaving \`.png)\` as garbage. We accept one level of
    // balanced parens, plus the angle-bracketed form \`<...>\` for URLs that
    // contain spaces or deeper nesting.
    const re = /!\\[\\[([^\\]|\\r\\n]+)(?:\\|([^\\]\\r\\n]+))?\\]\\]|!\\[([^\\]\\r\\n]*)\\]\\(\\s*(?:<[^>\\r\\n]*>|[^\\s()<>]+(?:\\([^\\s()<>]*\\)[^\\s()<>]*)*)\\s*(?:"[^"]*")?\\s*\\)|<img\\b[^>]*\\bsrc\\s*=\\s*["']([^"']+)["'][^>]*>/g
    // Walk md preserving each line's terminator so character offsets stay
    // correct under CRLF as well as LF. The split-on-/\\r?\\n/ form would
    // collapse \\r\\n to a single advance, drifting offsets on Windows-
    // authored sources and leaving rewriteMdImages to splice the wrong
    // slices.
    const lineRe = /[^\\r\\n]*(?:\\r\\n|\\r|\\n|$)/g
    let lm
    while ((lm = lineRe.exec(md)) !== null) {
      if (lm[0].length === 0) break
      const lineStart = lm.index
      const line = lm[0].replace(/(?:\\r\\n|\\r|\\n)$/, "")
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
      re.lastIndex = 0
      let m
      while ((m = re.exec(line)) !== null) {
        let alt = ""
        if (m[1] !== undefined) {
          if (m[2]) alt = m[2]
          else {
            const base = m[1].split("/").pop() || ""
            alt = base.replace(/\\.[^.]+$/, "")
          }
        } else if (m[3] !== undefined) {
          alt = m[3]
        } else if (m[4] !== undefined) {
          // HTML <img>: the regex only captures \`src\`; pull \`alt\` out
          // separately so we don't drop the descriptive text when rewriting
          // \`<img alt="foo" src="bar">\` as \`![alt](url)\`.
          const altM = /\\balt\\s*=\\s*["']([^"']*)["']/i.exec(m[0])
          if (altM) alt = altM[1]
        }
        refs.push({
          start: lineStart + m.index,
          end: lineStart + m.index + m[0].length,
          alt,
        })
      }
    }
    return refs
  }

  // Markdown alt text inside \`![...]\` can't carry unescaped brackets; if a
  // wikilink's alias contained \`[\` or \`]\` we'd otherwise produce broken
  // syntax once it's rewritten as \`![alt](url)\`.
  function escapeMdAlt(s) {
    return s.replace(/[\\[\\]]/g, "\\\\$&")
  }

  function collectArticleImageUrls(clone) {
    const article = clone.querySelector("article") || clone
    const out = []
    article.querySelectorAll("img[src]").forEach((img) => {
      const v = img.getAttribute("src")
      if (!v) { out.push(null); return }
      try { out.push(new URL(v, location.href)) }
      catch (e) { out.push(null) }
    })
    return out
  }

  // Splice each ref's slice with \`![alt](target)\`. Walking refs in reverse
  // keeps the absolute offsets in earlier refs valid as we mutate. \`null\`
  // targets pass through unchanged (caller couldn't resolve a URL for that
  // slot, e.g. malformed src).
  function rewriteMdImages(md, refs, targets) {
    if (refs.length !== targets.length) return null
    let out = md
    for (let i = refs.length - 1; i >= 0; i--) {
      const ref = refs[i]
      const target = targets[i]
      if (target == null) continue
      const replacement = "![" + escapeMdAlt(ref.alt) + "](" + target + ")"
      out = out.slice(0, ref.start) + replacement + out.slice(ref.end)
    }
    return out
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
    // Detect both ATX (\`# Title\`) and setext (\`Title\\n===\`) H1 forms so a
    // setext-authored document doesn't get a synthetic title prepended on
    // top of the one already in the file.
    const hasH1 = /^#\\s/.test(body) || /^[^\\n]+\\r?\\n=+[ \\t]*(?:\\r?\\n|$)/.test(body)
    if (!hasH1) body = "# " + titleText + "\\n\\n" + body
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
      // Underscore italic uses CommonMark's intraword rule so identifiers
      // like \`foo_bar_baz\` aren't collapsed to \`foobarbaz\`.
      txt = txt.replace(/(\\*\\*|__)(.+?)\\1/g, "$2")
      txt = txt.replace(/\\*([^*\\n]+)\\*/g, "$1")
      txt = txt.replace(/(^|[^A-Za-z0-9_])_([^_\\n]+)_(?![A-Za-z0-9_])/g, "$1$2")
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

  // Escape a plain-text run for LaTeX. Single pass so the braces emitted
  // by \`\\textbackslash{}\` aren't re-escaped into \`\\textbackslash\\{\\}\`,
  // and so we don't have to reason about the order of N sequential passes.
  function escapeLatex(s) {
    return s.replace(/[\\\\{}&%$#_~^]/g, (c) => {
      if (c === "\\\\") return "\\\\textbackslash{}"
      if (c === "~") return "\\\\textasciitilde{}"
      if (c === "^") return "\\\\textasciicircum{}"
      return "\\\\" + c
    })
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
      t = t.replace(/(?:^|[^A-Za-z0-9_])_([^_\\n]+)_(?![A-Za-z0-9_])/g, (m, x) => {
        // Underscore italic: CommonMark intraword rule — both ends must
        // sit at a non-word-char boundary so identifiers like \`my_var\` or
        // \`foo_bar_baz\` aren't italicised. Preserve the leading boundary
        // char (the trailing lookahead doesn't consume).
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
    // Detect both ATX and setext H1 so a setext-authored document doesn't
    // get \`\\maketitle\` PLUS a synthetic ATX H1 stacked on top of its
    // existing setext title.
    const hasH1 = /^#\\s/.test(md) || /^[^\\n]+\\r?\\n=+[ \\t]*(?:\\r?\\n|$)/.test(md)
    if (!hasH1) md = "# " + titleText + "\\n\\n" + md
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
      const local = pickLocalName(u, usedNames)
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

  // ----- Folder/project export (multi-file HTML zip) ------------------------
  // Bundles the current page + every descendant page (by slug prefix) into a
  // single zip. Each page becomes a standalone .html file mirroring the
  // site's URL structure; internal links between bundled pages are rewritten
  // to relative paths so they work straight from \`file://\`; links to pages
  // outside the bundle absolutize back to the live site; images are fetched
  // once and shared from a single \`images/\` folder at the zip root.
  //
  // Source of truth for "which pages": the rendered explorer sidebar. Every
  // page Quartz includes in navigation has an \`<a>\` there, so a CSS query
  // for slug-prefixed hrefs gives us the project page set without needing
  // a server-side manifest.
  async function exportFolderZip() {
    const rootSlug = root.getAttribute("data-slug") || ""
    const explorer = document.querySelector(".explorer")
    if (!explorer) {
      alert("Could not find the page list — folder export needs the sidebar explorer.")
      return
    }

    // 1. Discover pages whose slug is rootSlug or starts with rootSlug + "/".
    const pageSlugs = new Set()
    pageSlugs.add(rootSlug)
    explorer.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href")
      if (!href || href.startsWith("#")) return
      let url
      try { url = new URL(href, location.href) } catch (e) { return }
      if (url.origin !== location.origin) return
      const slug = url.pathname.replace(/^\\/+|\\/+$/g, "")
      if (slug === rootSlug) { pageSlugs.add(slug); return }
      if (rootSlug && slug.startsWith(rootSlug + "/")) { pageSlugs.add(slug); return }
      if (!rootSlug && slug) pageSlugs.add(slug)
    })

    // Root first; then depth-first by slug depth, lexical within a depth.
    // The order doesn't affect correctness but the zip's central directory
    // becomes nicer to read.
    const slugs = Array.from(pageSlugs).sort((a, b) => {
      if (a === rootSlug) return -1
      if (b === rootSlug) return 1
      const da = a.split("/").length, db = b.split("/").length
      return da - db || a.localeCompare(b)
    })

    // 2. Fetch every page's rendered HTML in parallel. Quartz serves pages
    // at the slug path with a trailing slash; pulling the served HTML lets
    // us reuse the live-site CSS/markup without a server-side render.
    const fetched = await Promise.all(slugs.map(async (slug) => {
      try {
        const res = await fetch("/" + slug + (slug ? "/" : ""))
        if (!res.ok) return null
        return { slug, doc: new DOMParser().parseFromString(await res.text(), "text/html") }
      } catch (e) { return null }
    }))
    const pages = fetched.filter((p) => p !== null)
    if (pages.length === 0) {
      alert("Could not fetch any pages for the folder export.")
      return
    }

    // Slug → zip path. Root becomes index.html; descendants mirror their
    // path below the root with an explicit .html extension (browsers won't
    // auto-resolve "index.html" inside a folder when opened over file://,
    // so we ship .html files rather than directory-style URLs).
    function slugToZipPath(slug) {
      if (slug === rootSlug) return "index.html"
      const rel = rootSlug ? slug.slice(rootSlug.length + 1) : slug
      return rel + ".html"
    }
    // Relative path between two zip entries treated as posix paths.
    function relZipPath(fromPath, toPath) {
      const fromDir = fromPath.split("/").slice(0, -1)
      const toParts = toPath.split("/")
      let i = 0
      while (i < fromDir.length && i < toParts.length - 1 && fromDir[i] === toParts[i]) i++
      const up = fromDir.slice(i).map(() => "..")
      const out = up.concat(toParts.slice(i)).join("/")
      return out || toParts[toParts.length - 1]
    }
    const slugToPath = new Map(pages.map((p) => [p.slug, slugToZipPath(p.slug)]))

    // 3. CSS is the same for every page (single Quartz build), so collect
    // it once from the current document and inline it into every standalone
    // page in the zip.
    const css = await collectCss()
    const usedImageNames = new Set()
    const imageLocalByUrl = new Map() // absolute URL → "images/foo.png"
    const imageTaskUrls = new Set()

    // 4. Per-page DOM pass: extract .center, rewrite hrefs, and record image
    // fetch tasks. Image rewrites are deferred until fetches complete so we
    // can fall back to absolute URLs on failures.
    const processed = []
    for (const page of pages) {
      const fromPath = slugToPath.get(page.slug)
      const center = page.doc.querySelector(".center")
      if (!center) continue
      // Resolve hrefs/src against the page's own URL so "../sibling/" inside
      // \`experiments/foo/\` resolves to \`experiments/sibling/\` correctly.
      const baseUrl = location.origin + "/" + page.slug + (page.slug ? "/" : "")

      center.querySelectorAll("a[href]").forEach((a) => {
        const v = a.getAttribute("href")
        if (!v || v.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(v)) return
        let abs
        try { abs = new URL(v, baseUrl) } catch (e) { return }
        const targetSlug = abs.pathname.replace(/^\\/+|\\/+$/g, "")
        const anchor = abs.hash || ""
        if (slugToPath.has(targetSlug)) {
          a.setAttribute("href", relZipPath(fromPath, slugToPath.get(targetSlug)) + anchor)
        } else {
          // Outside the bundle: keep an absolute URL pointing at the live
          // site so clicking through still works when the zip is opened
          // online. Offline, the link will fail to resolve — there's no
          // better option without including the entire site.
          a.setAttribute("href", abs.href)
        }
      })

      const imgTasks = []
      center.querySelectorAll("img[src]").forEach((img) => {
        const v = img.getAttribute("src")
        if (!v) return
        let url
        try { url = new URL(v, baseUrl) } catch (e) { return }
        if (url.origin !== location.origin) {
          img.setAttribute("src", url.href)
          return
        }
        const abs = url.href
        if (!imageLocalByUrl.has(abs)) {
          imageLocalByUrl.set(abs, pickLocalName(abs, usedImageNames))
          imageTaskUrls.add(abs)
        }
        imgTasks.push({ img, abs })
      })
      // Strip srcset for the same reason exportZip does — multiplying fetches
      // per image isn't worth it for a static archive.
      center.querySelectorAll("img[srcset]").forEach((img) => img.removeAttribute("srcset"))
      // Other [src] (audio/video/etc.) → absolutize to the live site rather
      // than try to bundle non-image media.
      center.querySelectorAll("[src]").forEach((el) => {
        if (el.tagName === "IMG") return
        const v = el.getAttribute("src")
        if (!v || /^[a-z][a-z0-9+.-]*:/i.test(v)) return
        try { el.setAttribute("src", new URL(v, baseUrl).href) } catch (e) {}
      })

      processed.push({ slug: page.slug, doc: page.doc, center, fromPath, imgTasks })
    }

    // 5. Fetch all unique images in parallel. \`null\` bytes signal failure
    // (cross-origin shouldn't reach here — same-origin only — but a 404 or
    // network error still lands here and falls back to the absolute URL).
    const imageBytesByUrl = new Map()
    await Promise.all(Array.from(imageTaskUrls).map(async (abs) => {
      try {
        const r = await fetch(abs)
        imageBytesByUrl.set(abs, r.ok ? new Uint8Array(await r.arrayBuffer()) : null)
      } catch (e) { imageBytesByUrl.set(abs, null) }
    }))

    // 6. Rewrite image src now that we know which fetches succeeded.
    for (const p of processed) {
      for (const t of p.imgTasks) {
        const bytes = imageBytesByUrl.get(t.abs)
        const local = imageLocalByUrl.get(t.abs)
        t.img.setAttribute("src", (bytes && local) ? relZipPath(p.fromPath, local) : t.abs)
      }
    }

    // 7. Build the zip: per-page HTML + bundled images.
    const enc = new TextEncoder()
    const entries = []
    for (const p of processed) {
      const titleEl = p.center.querySelector("h1, .article-title") || p.doc.querySelector("title")
      const titleText = (titleEl && titleEl.textContent && titleEl.textContent.trim())
        || p.slug || "page"
      const html = buildStandaloneHtml(p.center, css, titleText)
      entries.push({ name: p.fromPath, data: enc.encode(html) })
    }
    for (const [abs, bytes] of imageBytesByUrl) {
      if (!bytes) continue
      const local = imageLocalByUrl.get(abs)
      if (local) entries.push({ name: local, data: bytes })
    }

    const rootTitleEl = document.querySelector(".center h1, .center .article-title")
    const rootTitle = (rootTitleEl && rootTitleEl.textContent && rootTitleEl.textContent.trim())
      || rootSlug || "folder"
    triggerDownload(buildZip(entries), rootTitle, "zip")
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
        cells.push({ cell_type: "markdown", id: makeCellId(), metadata: {}, source: lineify(txt) })
      } else {
        const codeLang = (s.lang || "").toLowerCase()
        const body = s.lines.join("\\n")
        if (kernelLang && codeLang === kernelLang) {
          cells.push({
            cell_type: "code",
            id: makeCellId(),
            metadata: {},
            execution_count: null,
            outputs: [],
            source: lineify(body),
          })
        } else {
          // Preserve the fence so the markdown cell still renders as a
          // code block (with its language tag, when one was given).
          const wrapped = "\`\`\`" + (s.lang || "") + "\\n" + body + "\\n\`\`\`"
          cells.push({ cell_type: "markdown", id: makeCellId(), metadata: {}, source: lineify(wrapped) })
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

    const title = document.createElement("div")
    title.className = "export-col-title"
    title.textContent = "Include sections"
    sectionsEl.appendChild(title)

    const header = document.createElement("label")
    header.className = "export-section-row export-section-all"
    const allCb = document.createElement("input")
    allCb.type = "checkbox"
    allCb.checked = true
    allCb.dataset.role = "all"
    const allText = document.createElement("span")
    allText.textContent = "All sections"
    header.appendChild(allCb)
    header.appendChild(allText)
    sectionsEl.appendChild(header)

    const list = document.createElement("div")
    list.className = "export-section-list"
    sectionsEl.appendChild(list)

    let lastH2 = -1
    headings.forEach((h, idx) => {
      if (h.level === 2) lastH2 = idx
      // Only indent h3s when they actually nest under an h2. On a doc
      // that uses h3 as its top level (no h2s), indenting orphans would
      // be misleading — drop the .is-h3 indent class for those.
      const isOrphanH3 = h.level === 3 && lastH2 === -1
      const row = document.createElement("label")
      row.className = "export-section-row" + (h.level === 3 && !isOrphanH3 ? " is-h3" : "")
      const cb = document.createElement("input")
      cb.type = "checkbox"
      cb.checked = true
      cb.dataset.idx = String(idx)
      cb.dataset.level = String(h.level)
      if (h.level === 3 && !isOrphanH3) cb.dataset.parent = String(lastH2)
      row.appendChild(cb)
      const span = document.createElement("span")
      span.textContent = h.text
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
    // Save innerHTML, not textContent: format tiles contain nested
    // <span>s for the name/extension lines, and a textContent round-trip
    // would collapse them into a single text node — permanently flattening
    // the styling on the first export.
    const orig = btn.innerHTML
    btn.textContent = "Exporting…"
    const checked = getCheckedIndices()
    // Bail early on an explicit empty selection — exporting a notebook
    // with zero cells (or HTML with only the title) is almost certainly
    // a misclick, and the silent-no-op result is confusing. Folder export
    // ignores the section filter entirely (it spans many pages), so the
    // bail wouldn't make sense there.
    if (checked && checked.size === 0 && fmt !== "folder-zip") {
      alert("Select at least one section to export.")
      btn.innerHTML = orig
      btn.removeAttribute("disabled")
      return
    }
    try {
      if (fmt === "html") await exportHtml(checked)
      else if (fmt === "pdf") await exportPdf(checked)
      else if (fmt === "md-zip") await exportMarkdownZip(checked)
      else if (fmt === "md-inline") await exportMarkdownInline(checked)
      else if (fmt === "txt") await exportText(checked)
      else if (fmt === "ipynb") await exportIpynb(checked)
      else if (fmt === "ipynb-zip") await exportIpynbZip(checked)
      else if (fmt === "ipynb-review") await exportIpynbForReview(checked)
      else if (fmt === "tex") await exportLatex(checked)
      else if (fmt === "json") await exportJson(checked)
      else if (fmt === "zip") await exportZip(checked)
      else if (fmt === "folder-zip") await exportFolderZip()
    } finally {
      btn.innerHTML = orig
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

// `includeFolderExport` lights up the multi-page "Folder (HTML)" tile.
// Off by default — only the list/folder layout passes it, since exporting
// "this project" from a leaf note has ambiguous scope.
interface ExportArticleOpts {
  includeFolderExport?: boolean
}

function makeExportArticle(opts?: ExportArticleOpts): QuartzComponent {
  const includeFolderExport = !!(opts && opts.includeFolderExport)

  const ExportArticle: QuartzComponent = ({ fileData }: QuartzComponentProps) => {
  // Same gate EditInObsidian uses: tag/folder index pages have no backing
  // file — there's nothing meaningful to export from them.
  if (!fileData.filePath || !fileData.slug) return null

  // <details>/<summary> gives us native click-toggle and keyboard support
  // (Enter/Space on the summary). data-router-ignore stops Quartz's SPA
  // router from intercepting clicks inside this widget. All styling lives
  // in styles/exportArticle.scss.
  return (
    <details class="export-article" data-slug={fileData.slug} data-router-ignore="true">
      <summary
        class="export-article-btn"
        role="button"
        aria-label="Export this page"
        title="Export this page"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M12 4v12" />
          <path d="m6 12 6 6 6-6" />
          <path d="M5 21h14" />
        </svg>
      </summary>
      <div class="export-menu" role="menu">
        <div class="export-sections" data-router-ignore="true" style="display: none;"></div>
        <div class="export-formats">
          <div class="export-col-title">Download as</div>
          <div class="export-formats-grid">
            <button type="button" role="menuitem" data-fmt="html" data-router-ignore="true">
              <span class="export-fmt-name">HTML</span>
              <span class="export-fmt-ext">.html</span>
            </button>
            <button type="button" role="menuitem" data-fmt="pdf" data-router-ignore="true">
              <span class="export-fmt-name">PDF</span>
              <span class="export-fmt-ext">.pdf</span>
            </button>
            <button
              type="button"
              role="menuitem"
              data-fmt="md-zip"
              data-router-ignore="true"
              title="Markdown with images bundled into a zip archive"
            >
              <span class="export-fmt-name">Markdown</span>
              <span class="export-fmt-ext">.zip</span>
            </button>
            <button
              type="button"
              role="menuitem"
              data-fmt="md-inline"
              data-router-ignore="true"
              title="Single .md with images base64-inlined"
            >
              <span class="export-fmt-name">Markdown (inline)</span>
              <span class="export-fmt-ext">.md</span>
            </button>
            <button type="button" role="menuitem" data-fmt="txt" data-router-ignore="true">
              <span class="export-fmt-name">Plain text</span>
              <span class="export-fmt-ext">.txt</span>
            </button>
            <button
              type="button"
              role="menuitem"
              data-fmt="ipynb"
              data-router-ignore="true"
              title="Single .ipynb with images embedded as code-cell outputs"
            >
              <span class="export-fmt-name">Jupyter</span>
              <span class="export-fmt-ext">.ipynb</span>
            </button>
            <button
              type="button"
              role="menuitem"
              data-fmt="ipynb-zip"
              data-router-ignore="true"
              title="Notebook + images/ folder bundled as a zip — sibling-folder image refs render in JupyterLab and GitHub-native blob view"
            >
              <span class="export-fmt-name">Jupyter (zip)</span>
              <span class="export-fmt-ext">.zip</span>
            </button>
            <button
              type="button"
              role="menuitem"
              data-fmt="ipynb-review"
              data-router-ignore="true"
              title="Single .ipynb where every image — including ones inside tables/lists — is a code-cell display_data output. Surrounding markdown structure fragments around each image, but every image renders in ReviewNB."
            >
              <span class="export-fmt-name">Jupyter (ReviewNB)</span>
              <span class="export-fmt-ext">.ipynb</span>
            </button>
            <button type="button" role="menuitem" data-fmt="tex" data-router-ignore="true">
              <span class="export-fmt-name">LaTeX</span>
              <span class="export-fmt-ext">.tex</span>
            </button>
            <button type="button" role="menuitem" data-fmt="json" data-router-ignore="true">
              <span class="export-fmt-name">JSON</span>
              <span class="export-fmt-ext">.json</span>
            </button>
            <button type="button" role="menuitem" data-fmt="zip" data-router-ignore="true">
              <span class="export-fmt-name">ZIP archive</span>
              <span class="export-fmt-ext">.zip</span>
            </button>
            {includeFolderExport && (
              <button
                type="button"
                role="menuitem"
                data-fmt="folder-zip"
                data-router-ignore="true"
                title="This folder + every page beneath it, bundled as a multi-file HTML zip. Internal links are rewritten to relative paths so navigation works straight from disk."
              >
                <span class="export-fmt-name">Folder (HTML)</span>
                <span class="export-fmt-ext">.zip</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </details>
  )
  }

  ExportArticle.afterDOMLoaded = exportScript
  ExportArticle.css = style
  return ExportArticle
}

export default ((opts?: ExportArticleOpts) =>
  makeExportArticle(opts)) satisfies QuartzComponentConstructor
