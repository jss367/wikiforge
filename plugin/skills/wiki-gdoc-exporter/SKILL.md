---
name: wiki-gdoc-exporter
description: Core algorithm for exporting a folder of markdown notes — overview plus any descendants — as a single Google Doc. Reads every .md file under the folder, resolves images from local vault paths, uploads them to Google Drive, assembles one master markdown string with the overview first and remaining files as top-level sections, then creates the doc via Composio's Google Docs MCP. Returns the doc URL. Called by the /wiki-export-gdoc command.
---

# Wiki → Google Doc Exporter Skill

Turn a folder of markdown notes into one shareable Google Doc. The skill orchestrates Composio MCP tools (Google Docs + Google Drive). It does NOT alter any files in the vault.

## Safety invariants

1. **Read-only against the vault.** Never write to or rename files in the source folder.
2. **One doc per invocation.** This is a one-shot export — no two-way sync, no doc updates. Re-running creates a fresh doc.
3. **Surface failures, don't paper over them.** If an image fails to upload, leave the markdown alt-text in place (don't silently strip the reference); if the Docs API rejects the markdown, report the error verbatim rather than retrying blindly.

## Phase 1: Composio connection check

Before doing any file work, verify Composio has active connections for both toolkits:

1. Call `COMPOSIO_SEARCH_TOOLS` with a simple Google Docs use case to inspect connection status.
2. If `googledocs` shows `has_active_connection: false`, call `COMPOSIO_MANAGE_CONNECTIONS` with `toolkits: [{name: "googledocs", action: "add"}]`. Surface the returned `redirect_url` to the caller as a clickable markdown link and stop. The caller will resume the command once the user has authorized — don't try to "wait and retry" silently.
3. Same check for `googledrive`. Drive is already authorized in most cases, but verify rather than assume.

## Phase 2: File discovery

1. **Validate folder.** Reject if it doesn't exist or isn't a directory.
2. **Glob `**/*.md`** under the folder. Skip any path that matches the vault's typical ignored set (`.obsidian/`, `templates/`, `private/`, files starting with `Untitled`) — these mirror what `quartz.config.ts` ignores so the export reflects what the user actually publishes.
3. **Decide order:**
   - If a file named `index.md` exists at the folder root, it's the overview — comes first.
   - Otherwise, the alphabetically-first `.md` at the folder root is the overview.
   - Remaining files: breadth-first by directory depth, alphabetical within a depth.
4. **Cap.** If the discovered set exceeds 200 files or the combined raw markdown exceeds 500 KB, stop and report the size. Suggest exporting a subfolder instead. (The Docs API can handle more, but the user almost certainly doesn't want a 200-file doc, and a hard cap prevents accidental "export my whole vault" disasters.)

## Phase 3: Image discovery and resolution

For each markdown file, find every image reference and resolve it to a local file path:

1. **Recognise three syntaxes:**
   - `![[name.png]]` — Obsidian wikilink embed
   - `![alt](relative/path.png)` — standard markdown image
   - `<img src="path">` — raw HTML
2. **Resolve wikilinks** (`![[name]]`) against the **vault root**, not the current file's directory or the input folder. Detect the vault root by walking up from the input folder looking for a `.obsidian/` directory; use the deepest ancestor that contains one as the vault root. If no `.obsidian/` is found within 5 levels up, fall back to treating the input folder as the vault root (and log a warning so the user knows shared-attachment lookups won't see folders outside the export). Once the vault root is known, recursively glob the filename from there. Obsidian's default resolution is "shortest path from vault root that uniquely matches the name" — if multiple candidates, prefer one in an `attachments/` or `images/` subfolder; if still ambiguous, log a warning and use the first match. This matters because Obsidian users commonly keep a shared `attachments/` folder at the vault root that sits *outside* any single project — narrowing the glob to the export folder would miss those.
3. **Resolve relative paths** against the markdown file's own directory.
4. **Skip absolute URLs** (`http://`, `https://`, `data:`) — those go into the doc as-is via standard markdown image syntax.
5. **Dedupe by absolute resolved path.** A banner referenced from three files uploads once.
6. **Skip unsupported formats.** Composio's Google Docs export accepts PNG, JPEG, GIF. SVG, WebP, and AVIF are unsupported — replace the reference with the alt text in italics (e.g. `*[image: cover diagram]*`) and log a warning.

## Phase 4: Image upload to Drive

For each unique resolved image path:

1. Call `GOOGLEDRIVE_UPLOAD_FILE` with the file. Upload to a folder named `Wikiforge Export Images` at Drive root — create it on first upload via Drive's standard create-folder flow if it doesn't exist (search by name first). This keeps exports' images grouped rather than littering Drive root.
2. Call `GOOGLEDRIVE_CREATE_PERMISSION` to make the file readable by anyone with the link (`type: "anyone"`, `role: "reader"`). Without this, Google Docs can't fetch the image at insert time.
3. Build a direct-image URL of the form `https://drive.google.com/uc?id=<FILE_ID>&export=view`. This is the canonical "view raw image" URL that Docs' markdown image fetcher accepts.
4. Map: `local absolute path → public Drive URL`.

Run uploads in modest parallelism (`COMPOSIO_MULTI_EXECUTE_TOOL` with up to ~10 uploads per batch). Sequential uploads of 100 images would take a couple of minutes; batched parallelism keeps it under 30 seconds without overrunning Drive quotas.

On upload failure for any individual image, leave its markdown ref's alt text in place (don't fabricate a broken Drive URL). Log a warning per failure.

## Phase 5: Markdown assembly

Build one master markdown string:

1. **Doc title** (passed to Docs API as `title`, NOT included in the markdown body): `<folder-name> — <YYYY-MM-DD>`. The folder name is the basename of the input path; the date is today in the user's local timezone.

2. **Body assembly:**
   - **Overview file**: strip frontmatter, include its content verbatim as the doc opener. If the file's first line is a `#` H1, keep it — it becomes the doc's first heading. If not, prepend `# <Overview Title>` derived from the filename.
   - **Each subsequent file**: insert a top-level `# <Section Title>` heading derived from the file's frontmatter `title` field if present, otherwise its first H1, otherwise its filename (with `_`/`-` → space, Title Case). Demote the file's internal headings by one level — `# H1` becomes `## H2`, `## H2` becomes `### H3`, etc. — so the file's title isn't repeated and its structure nests cleanly under the section. **Cap demotion at H6**: any existing H6 stays as H6 (`#######` is not a valid ATX heading and renders as plain text, which silently destroys structure). Notes that already use H6 collide with the parent H6 after demotion, but a collision is strictly better than losing the heading entirely.
   - **Page breaks between sections.** Append `---` (markdown horizontal rule) between sections; Google Docs renders this as a thin divider line, which is visually clearer than a bare heading transition.

3. **Image rewriting.** Walk the assembled markdown one more time and replace every recognised image reference with `![<alt>](<public Drive URL>)`. Wikilinks `![[name]]` become standard markdown `![name](url)` (alt text derived from the filename if the wikilink had no alias).

4. **Wikilink resolution** (text links, not images):
   - `[[other-note]]` or `[[other-note|alias]]` where `other-note` resolves to a file in the export set → replace with a placeholder anchor that the caller will not handle (Docs API doesn't expose intra-doc bookmark creation cleanly via the markdown surface). For v1, render as **bold text** of the alias (or note name) — readers can ctrl-F. Document this limitation in the final report.
   - Wikilinks to notes NOT in the export set → render as plain bold text of the alias too. (Resolving to live-site URLs requires knowing the user's deployment URL, which the slash command doesn't have.)

5. **Frontmatter stripping.** YAML frontmatter blocks (`---\n…\n---`) at the top of each file are stripped before assembly. Their content is metadata, not body.

## Phase 6: Doc creation

1. Call `GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN` with:
   - `title`: `<folder-name> — <YYYY-MM-DD>`
   - `markdown_text`: the assembled body

2. **Chunking fallback.** If the call fails with a 400 / validation error (Composio's guidance notes that complex markdown — especially multiple tables — can fail in one shot):
   - Split the markdown at section boundaries (each top-level `#` heading).
   - Create the doc with just the overview section via `GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN`.
   - Append each subsequent section via `GOOGLEDOCS_UPDATE_DOCUMENT_SECTION_MARKDOWN` (omit `start_index` to append). If a chunk is itself >45 KB, split it further at H2 boundaries before appending.

3. **Capture the doc URL** from the create call's response. The response typically includes a `link` or `documentUrl` field; if not, construct as `https://docs.google.com/document/d/<documentId>/edit`.

## Phase 7: Return payload

Return to the caller:

1. **`doc_url`** — the Google Docs URL (string).
2. **`stats`** — a short structured summary:
   - `files_included` (integer)
   - `files_skipped` (integer, with reasons)
   - `images_uploaded` (integer)
   - `images_failed` (integer)
   - `wikilinks_unresolved` (integer)
3. **`warnings`** — a list of short human-readable messages for anything that degraded:
   - "skipped 2 SVG images (Google Docs Markdown doesn't accept SVG)"
   - "3 wikilinks to notes outside the export set rendered as bold text"
   - "uploaded 47 images to Drive folder 'Wikiforge Export Images'"

## Failure modes the caller should know about

- **No Google Docs connection** (Phase 1): caller shows the OAuth link, user clicks, retries the command.
- **Image upload partial failure** (Phase 4): export still produces a doc, but some image refs are alt-text fallbacks.
- **Markdown rejected by Docs API** (Phase 6): chunked retry path engaged; if that also fails, surface the underlying Docs API error verbatim and stop — don't loop.
- **Folder too large** (Phase 2 cap): clean error, suggest exporting a subfolder.
