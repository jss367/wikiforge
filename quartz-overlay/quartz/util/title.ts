// Slug-like titles (no spaces) get transformed to a title-cased display form:
//   - underscore → dot (so `spike-v4_5` → `Spike V4.5`, matching the way users
//     name sub-slugs with underscores to dodge Obsidian/Quartz's reserved-dot
//     issues while still meaning "point-five" semantically)
//   - hyphen → space, then each space-separated word gets its first letter
//     capitalized
// Titles that already have spaces are capitalized in place so authored
// frontmatter titles are preserved.
//
// Shared by ArticleTitle (which renders the displayed title) and
// StripDuplicateTitle (which needs the same value to compute the
// article-title's anchor slug for collision detection).
export function toTitleCase(raw: string): string {
  const hasSpaces = /\s/.test(raw)
  const spaced = hasSpaces ? raw : raw.replace(/_/g, ".").replace(/-/g, " ")
  return spaced
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}
