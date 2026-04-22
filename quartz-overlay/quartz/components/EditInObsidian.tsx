import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"

interface EditInObsidianOptions {
  vaultName: string
}

const defaultOptions: EditInObsidianOptions = {
  vaultName: "Obsidian Vault",
}

// Build the vault-root-relative path that Obsidian's `obsidian://open?file=`
// expects. Quartz gives us `relativePath` (relative to the `-d` content dir)
// and `filePath` (absolute). When wikiforge serves the compiled wiki via
// `-d $VAULT/wiki`, `relativePath` omits the `wiki/` prefix that the vault
// root needs — detect that case by looking at what `filePath - relativePath`
// ends with, and restore the prefix.
function vaultRootRelative(filePath: string, relativePath: string): string {
  const contentDir = filePath.slice(0, filePath.length - relativePath.length)
  return contentDir.endsWith("/wiki/") ? `wiki/${relativePath}` : relativePath
}

export default ((opts?: Partial<EditInObsidianOptions>) => {
  const options: EditInObsidianOptions = { ...defaultOptions, ...opts }

  function EditInObsidian({ fileData }: QuartzComponentProps) {
    const filePath = fileData.filePath as string | undefined
    const relativePath = fileData.relativePath as string | undefined
    // Tag / folder index pages don't have a backing file — render nothing.
    if (!filePath || !relativePath) return null

    const openPath = vaultRootRelative(filePath, relativePath)
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
