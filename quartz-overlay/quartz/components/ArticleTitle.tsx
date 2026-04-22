import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"

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
    return <h1 class={classNames(displayClass, "article-title")}>{toTitleCase(title)}</h1>
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
