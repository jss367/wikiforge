import { QuartzComponentConstructor, QuartzComponentProps } from "./types"

export default (() => {
  function LastEdited({ fileData }: QuartzComponentProps) {
    const modified = fileData.dates?.modified
    if (!modified) return null

    const formatted = modified.toLocaleDateString("en-US", {
      day: "numeric",
      month: "long",
      year: "numeric",
    })
    const time = modified.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })

    return (
      <p
        class="last-edited"
        style="margin-top: 2em; padding-top: 0.5em; border-top: 1px solid var(--lightgray); font-size: 0.8em; color: var(--gray);"
      >
        This page was last edited on {formatted}, at {time}.
      </p>
    )
  }

  return LastEdited
}) satisfies QuartzComponentConstructor
