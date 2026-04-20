import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"

interface EditInObsidianOptions {
  vaultName: string
}

const defaultOptions: EditInObsidianOptions = {
  vaultName: "Obsidian Vault",
}

export default ((opts?: Partial<EditInObsidianOptions>) => {
  const options: EditInObsidianOptions = { ...defaultOptions, ...opts }

  function EditInObsidian({ fileData }: QuartzComponentProps) {
    const source = fileData.frontmatter?.source as string | undefined
    if (!source) return null

    const url = `obsidian://open?vault=${encodeURIComponent(options.vaultName)}&file=${encodeURIComponent(source)}`

    return (
      <p class="edit-in-obsidian" style="margin: 0.25em 0; font-size: 0.85em;">
        <a href={url} style="text-decoration: none; color: var(--secondary);">
          ✎ Edit source in Obsidian
        </a>
      </p>
    )
  }

  return EditInObsidian
}) satisfies QuartzComponentConstructor
