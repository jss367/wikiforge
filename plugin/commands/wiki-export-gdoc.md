# Export a Folder of Notes to a Google Doc

Take a folder of markdown notes — an overview plus any number of subfolders — and produce a single Google Doc that reads like a polished writeup. Inlines every note, preserves headings/lists/links/tables, and uploads any embedded images to Drive so they render in the doc.

Best for: turning a "project" folder (overview + experiments + writeups) into one shareable document, without manually copy-pasting each file.

## Arguments

- `<folder>` (required) — path to the folder, relative to CWD or absolute. Every `.md` file under this folder (recursive) is included.

## Instructions

1. **Validate the argument.** If no folder was given, the path doesn't exist, or it's not a directory, print a short error and exit. Example error: "Usage: /wiki-export-gdoc <folder>".

2. **Invoke the `wiki-gdoc-exporter` skill** with the folder path. The skill handles file discovery, image resolution, Composio auth, image uploads, doc creation, and progress reporting.

3. **On success, print the doc URL** on its own line (so it's easy to click). Also print a one-line summary: file count, image count, any pages skipped.

4. **On Composio auth failure** (no active Google Docs connection on first run), the skill surfaces the OAuth redirect URL — show it to the user as a clickable markdown link and wait for them to confirm authorization before retrying.

## What this command does NOT do

- **Image fidelity beyond basic embedding** — images are uploaded to Drive and embedded inline. Sizing/positioning matches the markdown's intent but isn't pixel-perfect.
- **Math, code highlighting, callouts** — these degrade. Code blocks become monospaced paragraphs, math stays as plain LaTeX text, callouts flatten to indented quotes.
- **Two-way sync** — this is a one-shot export. Re-running creates a new doc; it doesn't update an existing one.
- **Multi-doc output** — produces a single Google Doc with everything inlined, not a folder of linked docs. (If you want that shape, file a separate request.)
