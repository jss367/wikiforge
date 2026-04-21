import { QuartzComponentConstructor, QuartzComponentProps } from "./types"

export default (() => {
  function LastEdited({ fileData }: QuartzComponentProps) {
    const modified = fileData.dates?.modified
    if (!modified) return null

    // Pin to UTC so the rendered footer is identical regardless of where the
    // site is built (local laptop vs CI, different developer timezones). The
    // HTML is static, so whichever TZ the build machine uses gets baked in —
    // without this, the same commit built in two places can show different
    // dates around midnight.
    const formatted = modified.toLocaleDateString("en-US", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    })
    const time = modified.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    })

    return (
      <p
        class="last-edited"
        style="margin-top: 2em; padding-top: 0.5em; border-top: 1px solid var(--lightgray); font-size: 0.8em; color: var(--gray);"
      >
        This page was last edited on {formatted}, at {time} (UTC).
      </p>
    )
  }

  return LastEdited
}) satisfies QuartzComponentConstructor
