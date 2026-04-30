import { QuartzEmitterPlugin } from "../types"
import { QuartzComponentProps } from "../../components/types"
import HeaderConstructor from "../../components/Header"
import BodyConstructor from "../../components/Body"
import { pageResources, renderPage } from "../../components/renderPage"
import { ProcessedContent, QuartzPluginData, defaultProcessedContent } from "../vfile"
import { FullPageLayout } from "../../cfg"
import path from "path"
import fs from "fs"
import {
  FullSlug,
  FilePath,
  SimpleSlug,
  stripSlashes,
  joinSegments,
  pathToRoot,
  simplifySlug,
  slugifyFilePath,
} from "../../util/path"
import { defaultListPageLayout, sharedPageComponents } from "../../../quartz.layout"
import { FolderContent } from "../../components"
import { write } from "./helpers"
import { i18n, TRANSLATIONS } from "../../i18n"
import { BuildCtx, trieFromAllFiles } from "../../util/ctx"
import { StaticResources } from "../../util/resources"
import { glob } from "../../util/glob"

interface FolderPageOptions extends FullPageLayout {
  sort?: (f1: QuartzPluginData, f2: QuartzPluginData) => number
  // Non-markdown extensions to surface in folder listings. Defaults to PDFs.
  // Each entry includes the leading dot. Set to [] to disable.
  assetExtensions: string[]
}

const DEFAULT_ASSET_EXTENSIONS = [".pdf"]

async function findAssetFiles(
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

async function* processFolderInfo(
  ctx: BuildCtx,
  folderInfo: Record<SimpleSlug, ProcessedContent>,
  allFiles: QuartzPluginData[],
  opts: FullPageLayout,
  resources: StaticResources,
) {
  for (const [folder, folderContent] of Object.entries(folderInfo) as [
    SimpleSlug,
    ProcessedContent,
  ][]) {
    const slug = joinSegments(folder, "index") as FullSlug
    const [tree, file] = folderContent
    const cfg = ctx.cfg.configuration
    const externalResources = pageResources(pathToRoot(slug), resources)
    const componentData: QuartzComponentProps = {
      ctx,
      fileData: file.data,
      externalResources,
      cfg,
      children: [],
      tree,
      allFiles,
    }

    const content = renderPage(cfg, slug, componentData, opts, externalResources)
    yield write({
      ctx,
      content,
      slug,
      ext: ".html",
    })
  }
}

function computeFolderInfo(
  folders: Set<SimpleSlug>,
  content: ProcessedContent[],
  locale: keyof typeof TRANSLATIONS,
): Record<SimpleSlug, ProcessedContent> {
  // Create default folder descriptions
  const folderInfo: Record<SimpleSlug, ProcessedContent> = Object.fromEntries(
    [...folders].map((folder) => [
      folder,
      defaultProcessedContent({
        slug: joinSegments(folder, "index") as FullSlug,
        frontmatter: {
          title: `${i18n(locale).pages.folderContent.folder}: ${folder}`,
          tags: [],
        },
      }),
    ]),
  )

  // Update with actual content if available
  for (const [tree, file] of content) {
    const slug = stripSlashes(simplifySlug(file.data.slug!)) as SimpleSlug
    if (folders.has(slug)) {
      folderInfo[slug] = [tree, file]
    }
  }

  return folderInfo
}

function _getFolders(slug: FullSlug): SimpleSlug[] {
  var folderName = path.dirname(slug ?? "") as SimpleSlug
  const parentFolderNames = [folderName]

  while (folderName !== ".") {
    folderName = path.dirname(folderName ?? "") as SimpleSlug
    parentFolderNames.push(folderName)
  }
  return parentFolderNames
}

export const FolderPage: QuartzEmitterPlugin<Partial<FolderPageOptions>> = (userOpts) => {
  const opts: FullPageLayout = {
    ...sharedPageComponents,
    ...defaultListPageLayout,
    pageBody: FolderContent({ sort: userOpts?.sort }),
    ...userOpts,
  }
  const assetExtensions = userOpts?.assetExtensions ?? DEFAULT_ASSET_EXTENSIONS

  const { head: Head, header, beforeBody, pageBody, afterBody, left, right, footer: Footer } = opts
  const Header = HeaderConstructor()
  const Body = BodyConstructor()

  return {
    name: "FolderPage",
    getQuartzComponents() {
      return [
        Head,
        Header,
        Body,
        ...header,
        ...beforeBody,
        pageBody,
        ...afterBody,
        ...left,
        ...right,
        Footer,
      ]
    },
    async *emit(ctx, content, resources) {
      const assetFiles = await findAssetFiles(ctx, assetExtensions)
      const allFiles = [...content.map((c) => c[1].data), ...assetFiles]
      const cfg = ctx.cfg.configuration

      // Force-set ctx.trie from the augmented file list so FolderContent
      // (which caches via `??=`) sees PDFs as children of their parent
      // folders. Other components that read ctx.trie (e.g. Breadcrumbs)
      // are unaffected — assets only appear as leaves, never as ancestors.
      ctx.trie = trieFromAllFiles(allFiles)

      const folders: Set<SimpleSlug> = new Set(
        allFiles.flatMap((data) => {
          return data.slug
            ? _getFolders(data.slug).filter(
                (folderName) => folderName !== "." && folderName !== "tags",
              )
            : []
        }),
      )

      const folderInfo = computeFolderInfo(folders, content, cfg.locale)
      yield* processFolderInfo(ctx, folderInfo, allFiles, opts, resources)
    },
    async *partialEmit(ctx, content, resources, changeEvents) {
      const cfg = ctx.cfg.configuration

      // Find folders affected by either markdown or asset-file changes.
      // changeEvent.file is set only for markdown; for non-md changes we
      // re-derive the slug from the path.
      const affectedFolders: Set<SimpleSlug> = new Set()
      for (const changeEvent of changeEvents) {
        let slug: FullSlug | undefined
        if (changeEvent.file) {
          slug = changeEvent.file.data.slug
        } else if (
          assetExtensions.some((ext) => {
            const e = ext.startsWith(".") ? ext : "." + ext
            return changeEvent.path.endsWith(e)
          })
        ) {
          slug = slugifyFilePath(changeEvent.path)
        }
        if (!slug) continue

        const folders = _getFolders(slug).filter(
          (folderName) => folderName !== "." && folderName !== "tags",
        )
        folders.forEach((folder) => affectedFolders.add(folder))
      }

      if (affectedFolders.size > 0) {
        const assetFiles = await findAssetFiles(ctx, assetExtensions)
        const allFiles = [...content.map((c) => c[1].data), ...assetFiles]

        // A PDF (or note) being moved/deleted may leave its old folder
        // empty. Re-emitting `index.html` for a folder that no longer has
        // any content would create a phantom listing where none existed
        // before — worse than the stale-page-on-delete behavior we inherit
        // from upstream. Drop folders that aren't in the current file set.
        const existingFolders: Set<SimpleSlug> = new Set(
          allFiles.flatMap((data) =>
            data.slug
              ? _getFolders(data.slug).filter(
                  (folderName) => folderName !== "." && folderName !== "tags",
                )
              : [],
          ),
        )
        const foldersToEmit: Set<SimpleSlug> = new Set(
          [...affectedFolders].filter((f) => existingFolders.has(f)),
        )
        if (foldersToEmit.size === 0) return

        ctx.trie = trieFromAllFiles(allFiles)
        const folderInfo = computeFolderInfo(foldersToEmit, content, cfg.locale)
        yield* processFolderInfo(ctx, folderInfo, allFiles, opts, resources)
      }
    },
  }
}
