import { QuartzEmitterPlugin } from "../types"
import { FilePath, FullSlug, joinSegments, slugifyFilePath } from "../../util/path"
import path from "path"
import fs from "fs"

// Mirrors each note's original markdown source into the build output so the
// browser can fetch <slug>.md alongside the rendered <slug>.html. Used by the
// "Jupyter Notebook" export in ExportArticle, which needs the pre-render
// markdown to produce a clean .ipynb — the parsed HTML has already lost the
// original code fences and would round-trip lossily.
async function copyMarkdown(
  srcDir: string,
  outDir: string,
  rel: FilePath,
  slug: FullSlug,
): Promise<FilePath> {
  const src = joinSegments(srcDir, rel) as FilePath
  const dest = joinSegments(outDir, slug + ".md") as FilePath
  await fs.promises.mkdir(path.dirname(dest), { recursive: true })
  await fs.promises.copyFile(src, dest)
  return dest
}

export const RawMarkdown: QuartzEmitterPlugin = () => {
  return {
    name: "RawMarkdown",
    async *emit({ argv }, content) {
      for (const [, file] of content) {
        const rel = file.data.relativePath
        const slug = file.data.slug
        if (!rel || !slug) continue
        yield copyMarkdown(argv.directory, argv.output, rel, slug)
      }
    },
    async *partialEmit({ argv }, _content, _resources, changeEvents) {
      for (const ev of changeEvents) {
        if (path.extname(ev.path) !== ".md") continue
        const slug = (ev.file?.data.slug ?? slugifyFilePath(ev.path)) as FullSlug
        if (ev.type === "add" || ev.type === "change") {
          yield copyMarkdown(argv.directory, argv.output, ev.path, slug)
        } else if (ev.type === "delete") {
          const dest = joinSegments(argv.output, slug + ".md") as FilePath
          // best-effort: the file may already be gone if the build wiped dist
          await fs.promises.unlink(dest).catch(() => {})
        }
      }
    },
  }
}
