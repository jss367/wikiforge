import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"
import Slugger from "github-slugger"

// Slug-like titles (no spaces) get transformed to a title-cased display form:
//   - underscore → dot (so `spike-v4_5` → `Spike V4.5`, matching the way users
//     name sub-slugs with underscores to dodge Obsidian/Quartz's reserved-dot
//     issues while still meaning "point-five" semantically)
//   - hyphen → space, then each space-separated word gets its first letter
//     capitalized
// Titles that already have spaces are capitalized in place so authored
// frontmatter titles are preserved.
function toTitleCase(raw: string): string {
  const hasSpaces = /\s/.test(raw)
  const spaced = hasSpaces ? raw : raw.replace(/_/g, ".").replace(/-/g, " ")
  return spaced
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

const ArticleTitle: QuartzComponent = ({ fileData, displayClass }: QuartzComponentProps) => {
  const title = fileData.frontmatter?.title
  if (title) {
    const displayed = toTitleCase(title)
    // Only claim the slug anchor when StripDuplicateTitle actually removed
    // the matching body H1. In the rarer case where a body heading matching
    // the title survives (intro prose preceding `# Title`), assigning the
    // same id here would create duplicate DOM ids and hijack `#slug` links
    // so they target the top of the page instead of the intended section.
    const id = fileData.strippedDuplicateTitle ? new Slugger().slug(displayed) : undefined
    return <h1 id={id} class={classNames(displayClass, "article-title")}>{displayed}</h1>
  } else {
    return null
  }
}

ArticleTitle.css = `
.article-title {
  margin: 2rem 0 0 0;
}
`

export default (() => ArticleTitle) satisfies QuartzComponentConstructor
