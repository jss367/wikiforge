import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"
import { toTitleCase } from "../util/title"
import Slugger from "github-slugger"

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
