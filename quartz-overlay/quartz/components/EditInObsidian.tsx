import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"

interface EditInObsidianOptions {
  vaultName: string
}

const defaultOptions: EditInObsidianOptions = {
  vaultName: "Obsidian Vault",
}

// Build the vault-root-relative path that Obsidian's `obsidian://open?file=`
// expects. Quartz gives us `relativePath` (relative to the `-d` content dir)
// and `filePath` (absolute). When Quartz is served from a subfolder of the
// vault (e.g. `-d $VAULT/wiki` or `-d $VAULT/compiled`), `relativePath` omits
// that subfolder prefix — reconstruct it from `filePath - relativePath`.
// Separators are normalized so Windows paths parse the same as POSIX.
function vaultRootRelative(
  filePath: string,
  relativePath: string,
  vaultName: string,
): string {
  const normalizedFilePath = filePath.replace(/\\/g, "/")
  const normalizedRelativePath = relativePath.replace(/\\/g, "/")
  const contentDir = normalizedFilePath.slice(
    0,
    normalizedFilePath.length - normalizedRelativePath.length,
  )
  // Locate the vault root within the content-dir path. Quartz doesn't tell us
  // where the vault is; we rely on the convention that the vault folder on
  // disk is named to match `vaultName`. Everything between the vault folder
  // and the content dir is the full subpath we need to prefix — including
  // nested cases like `-d $VAULT/wiki/compiled`. Use the first occurrence so
  // a same-named inner folder doesn't shadow the true vault root.
  const marker = `/${vaultName}/`
  const markerIdx = contentDir.indexOf(marker)
  if (markerIdx === -1) return normalizedRelativePath
  const subPath = contentDir.slice(markerIdx + marker.length).replace(/\/+$/, "")
  if (!subPath) return normalizedRelativePath
  return `${subPath}/${normalizedRelativePath}`
}

export default ((opts?: Partial<EditInObsidianOptions>) => {
  const options: EditInObsidianOptions = { ...defaultOptions, ...opts }

  function EditInObsidian({ fileData }: QuartzComponentProps) {
    const filePath = fileData.filePath as string | undefined
    const relativePath = fileData.relativePath as string | undefined
    // Tag / folder index pages don't have a backing file — render nothing.
    if (!filePath || !relativePath) return null

    const openPath = vaultRootRelative(filePath, relativePath, options.vaultName)
    const url = `obsidian://open?vault=${encodeURIComponent(options.vaultName)}&file=${encodeURIComponent(openPath)}`

    return (
      <p class="edit-in-obsidian" style="margin: 0.25em 0; font-size: 0.85em;">
        <a href={url} style="text-decoration: none; color: var(--secondary);">
          ✎ Open in Obsidian
        </a>
      </p>
    )
  }

  return EditInObsidian
}) satisfies QuartzComponentConstructor
