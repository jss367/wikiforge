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
  // Last non-empty path segment of the content dir. In subfolder mode this is
  // the prefix Obsidian needs; in raw mode (`-d $VAULT`) it's the vault
  // folder itself — assume a convention that the vault folder is named to
  // match `vaultName` and skip the prefix in that case.
  const segments = contentDir.split("/").filter(Boolean)
  const lastSegment = segments[segments.length - 1]
  if (!lastSegment || lastSegment === vaultName) return normalizedRelativePath
  return `${lastSegment}/${normalizedRelativePath}`
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
