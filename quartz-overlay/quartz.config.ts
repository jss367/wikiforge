import { QuartzConfig } from "./quartz/cfg"
import * as Plugin from "./quartz/plugins"
import { AbsoluteInternalLinks } from "./quartz/plugins/transformers/absoluteInternalLinks"
import { StripDuplicateTitle } from "./quartz/plugins/transformers/stripDuplicateTitle"

/**
 * Quartz 4 Configuration
 *
 * See https://quartz.jzhao.xyz/configuration for more information.
 */
const config: QuartzConfig = {
  configuration: {
    pageTitle: "Julius's Wiki",
    pageTitleSuffix: "",
    enableSPA: true,
    enablePopovers: true,
    analytics: null,
    locale: "en-US",
    baseUrl: "localhost:8080",
    ignorePatterns: ["private", "templates", ".obsidian", ".trash", "attachments", "Untitled*"],
    defaultDateType: "created",
    theme: {
      fontOrigin: "googleFonts",
      cdnCaching: true,
      typography: {
        header: "Schibsted Grotesk",
        body: "Source Sans Pro",
        code: "IBM Plex Mono",
      },
      colors: {
        lightMode: {
          light: "#ffffff",
          lightgray: "#e5e5e5",
          gray: "#b8b8b8",
          darkgray: "#4e4e4e",
          dark: "#2b2b2b",
          secondary: "#0645ad",
          tertiary: "#84a59d",
          highlight: "rgba(143, 159, 169, 0.15)",
          textHighlight: "#fff23688",
        },
        darkMode: {
          light: "#161618",
          lightgray: "#393639",
          gray: "#646464",
          darkgray: "#d4d4d4",
          dark: "#ebebec",
          secondary: "#7b97aa",
          tertiary: "#84a59d",
          highlight: "rgba(143, 159, 169, 0.15)",
          textHighlight: "#b3aa0288",
        },
      },
    },
  },
  plugins: {
    transformers: [
      Plugin.FrontMatter(),
      // Runs right after FrontMatter so frontmatter.title is populated, and
      // before TableOfContents / Description so the duplicate H1 doesn't
      // leak into the sidebar TOC or the meta-description.
      StripDuplicateTitle(),
      Plugin.CreatedModifiedDate({
        priority: ["frontmatter", "git", "filesystem"],
      }),
      Plugin.SyntaxHighlighting({
        theme: {
          light: "github-light",
          dark: "github-dark",
        },
        keepBackground: false,
      }),
      Plugin.ObsidianFlavoredMarkdown({ enableInHtmlEmbed: false }),
      Plugin.GitHubFlavoredMarkdown(),
      Plugin.TableOfContents(),
      // "relative" preserves page-relative paths for markdown images and
      // regular markdown links so AbsoluteInternalLinks (below) can resolve
      // them correctly against the current page slug. "shortest" — Quartz's
      // default — tries to match link targets by filename against allSlugs,
      // but image files aren't in allSlugs, so they fall through to a
      // vault-root-relative computation that mangles page-relative paths
      // like `subdir/image.png` into `../../../subdir/image.png`, producing
      // wrong URLs after AbsoluteInternalLinks resolves them. Wikilinks
      // `[[foo]]` and Obsidian embeds `![[foo]]` are handled by the
      // ObsidianFlavoredMarkdown transformer and are unaffected.
      Plugin.CrawlLinks({ markdownLinkResolution: "relative" }),
      // Runs AFTER CrawlLinks so it operates on the post-transform hrefs.
      // Converts internal relative URLs (./… and ../…) emitted by Quartz
      // into root-absolute form (/…). Without this, internal navigation
      // and asset refs break on hub pages served at trailing-slash URLs
      // like /topics/foo/ (which breadcrumbs link to by default).
      AbsoluteInternalLinks(),
      Plugin.Description(),
      Plugin.Latex({ renderEngine: "katex" }),
    ],
    filters: [Plugin.RemoveDrafts()],
    emitters: [
      Plugin.AliasRedirects(),
      Plugin.ComponentResources(),
      Plugin.ContentPage(),
      Plugin.FolderPage(),
      Plugin.TagPage(),
      Plugin.ContentIndex({
        enableSiteMap: false,
        enableRSS: false,
      }),
      Plugin.Assets(),
      Plugin.Static(),
      Plugin.Favicon(),
      Plugin.NotFoundPage(),
    ],
  },
}

export default config
