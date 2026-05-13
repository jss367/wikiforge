// Surfaces non-markdown vault files (PDFs, DOCX, HTML) as first-class entries
// in the build pipeline so folder index pages and the Explorer sidebar can
// list them alongside notes. Shared between the FolderPage emitter (renders
// the per-folder listing page) and the ContentIndex emitter (writes the JSON
// the client-side Explorer reads).
import path from "path"
import fs from "fs"
import { FilePath, slugifyFilePath } from "./path"
import { QuartzPluginData } from "../plugins/vfile"
import { BuildCtx } from "./ctx"
import { glob } from "./glob"

// `.html` is included even though `slugifyFilePath` strips the extension —
// Quartz's Assets emitter copies the file to its de-extensioned slug and
// most static servers content-sniff the bytes. A sibling `foo.md` and
// `foo.html` would slug-collide; vaults that mix the two should override
// `assetExtensions` to exclude `.html`.
export const DEFAULT_ASSET_EXTENSIONS = [".pdf", ".docx", ".html"]

export async function findAssetFiles(
  ctx: BuildCtx,
  exts: string[],
): Promise<QuartzPluginData[]> {
  if (exts.length === 0) return []
  const cfg = ctx.cfg.configuration
  const seen = new Set<string>()
  const fps: FilePath[] = []
  for (const rawExt of exts) {
    const ext = rawExt.startsWith(".") ? rawExt : "." + rawExt
    const matches = await glob(`**/*${ext}`, ctx.argv.directory, cfg.ignorePatterns)
    for (const m of matches) {
      if (!seen.has(m)) {
        seen.add(m)
        fps.push(m)
      }
    }
  }

  return fps.map((rel) => {
    const slug = slugifyFilePath(rel)
    const abs = path.join(ctx.argv.directory, rel)
    let createdMs = Date.now()
    let modifiedMs = Date.now()
    try {
      const stat = fs.statSync(abs)
      createdMs = stat.birthtimeMs || stat.ctimeMs
      modifiedMs = stat.mtimeMs
    } catch {
      // best-effort: fall through to "now"
    }
    return {
      slug,
      filePath: rel,
      relativePath: rel,
      frontmatter: {
        title: path.basename(rel),
        tags: [],
      },
      dates: {
        created: new Date(createdMs),
        modified: new Date(modifiedMs),
        published: new Date(createdMs),
      },
    } as QuartzPluginData
  })
}
