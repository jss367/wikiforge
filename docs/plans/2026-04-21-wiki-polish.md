# Wiki Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Wikipedia-style polish to the wiki — redlinks, a last-edited footer, a lead-paragraph compile-time convention, a user-facing theme switcher (body font / thin-rules / reading width), and compile-time infoboxes rendered as a right-floated card on article pages.

**Architecture:** Work splits across two layers. The **compiler layer** (`plugin/`) changes what the LLM emits — updated SKILL.md and Markdown templates teach it new article structure (lead paragraph, infobox frontmatter blocks). The **render layer** (`quartz-overlay/`) adds a new Preact component (`Infobox`, `ThemeSwitcher`), an inline script + `localStorage`-backed UI preferences, and SCSS overrides. Raw source notes stay untouched; everything new is generated at compile time or toggled at render time.

**Tech Stack:** Quartz 4 (Preact components + SCSS + inline TypeScript), Claude Code skill markdown (`plugin/skills/wiki-compiler/SKILL.md`), YAML frontmatter for structured data.

**PR split:** Two PRs merged in order. **PR #1 (Phase A)** ships the quick Wikipedia-feel wins — redlinks, last-edited, lead paragraph, thin-rules gate. **PR #2 (Phase B)** ships the theme switcher and infoboxes. Each PR must be buildable and visually verifiable on its own before merge.

**Testing approach:** No unit-test suite exists in this project. Verification is visual — for render changes, re-apply the overlay (`bash scripts/install.sh`) and serve the compiled wiki (`bash scripts/wiki-serve.sh compiled`), then inspect `http://localhost:8081`. For compiler changes, re-read the edited SKILL.md / template files and confirm the instructions read cleanly; true end-to-end verification requires running `/wiki-compile` against the vault (the user will do this).

**Key references:**
- Overlay config: `quartz-overlay/quartz.config.ts`, `quartz-overlay/quartz.layout.ts`
- Existing overlay component: `quartz-overlay/quartz/components/EditInObsidian.tsx` (use as a pattern)
- Existing overlay styles: `quartz-overlay/quartz/styles/custom.scss`
- Compiler skill: `plugin/skills/wiki-compiler/SKILL.md`
- Article templates: `plugin/templates/article-template.md`, `plugin/templates/sub-article-template.md`
- Upstream Quartz broken-link class: stock Quartz emits `<a class="internal broken">...</a>` for unresolved `[[wikilinks]]` (see `~/Documents/wiki-quartz/quartz/plugins/transformers/ofm.ts:287`), styled in `~/Documents/wiki-quartz/quartz/styles/base.scss:94-108`. Our CSS just overrides the `.internal.broken` styling.
- Darkmode pattern for inline script + `localStorage` + `document.documentElement.setAttribute("saved-X", ...)`: `~/Documents/wiki-quartz/quartz/components/Darkmode.tsx` and `~/Documents/wiki-quartz/quartz/components/scripts/darkmode.inline.ts`

---

## Phase A — quick wins (PR #1)

### Task A1: Redlinks for unresolved wikilinks

**Context:** Upstream Quartz already flags broken `[[wikilinks]]` as `<a class="internal broken">...</a>` — the current stock styling fades them to 50% opacity blue. We override to make them Wikipedia-red: solid `#ba0000` in light mode, a lighter red in dark mode for contrast.

**Files:**
- Modify: `quartz-overlay/quartz/styles/custom.scss` (append new rule)

**Step 1: Add the redlink rule.**

Append to `quartz-overlay/quartz/styles/custom.scss`:

```scss
// Wikipedia-style redlinks: unresolved [[wikilinks]] render in red so readers
// can see where the wiki wants a page that doesn't exist yet. Overrides the
// stock Quartz 50%-opacity-secondary styling in base.scss.
:root[saved-theme="light"] {
  --redlink: #ba0000;
}
:root[saved-theme="dark"] {
  --redlink: #ff6b6b;
}

a.internal.broken {
  color: var(--redlink);
  opacity: 1;
  &:hover {
    color: var(--redlink);
    opacity: 0.8;
  }
}
```

**Step 2: Apply overlay and verify.**

```bash
bash scripts/install.sh    # re-copies overlay into ~/Documents/wiki-quartz
bash scripts/wiki-serve.sh compiled
```

Open `http://localhost:8081`. Find an article containing a `[[wikilink]]` to a page that doesn't exist (any topic-hub article likely has one). Expected: red text instead of faded blue. Toggle dark mode; expected: lighter red readable on dark background.

**Step 3: Commit.**

```bash
git add quartz-overlay/quartz/styles/custom.scss
git commit -m "Style unresolved wikilinks as Wikipedia-red redlinks"
```

---

### Task A2: Last-edited footer component

**Context:** Wikipedia prints `This page was last edited on 19 April 2026, at 14:32 (UTC).` at the very bottom of every article. Quartz already has `CreatedModifiedDate` populating `fileData.dates.modified`. We render a small `<p>` at the end of `defaultContentPageLayout.afterBody` that reads that date.

**Files:**
- Create: `quartz-overlay/quartz/components/LastEdited.tsx`
- Modify: `quartz-overlay/quartz.layout.ts` (import + wire into `afterBody`)

**Step 1: Create the component.**

Write `quartz-overlay/quartz/components/LastEdited.tsx`:

```tsx
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
```

**Step 2: Wire into the layout.**

In `quartz-overlay/quartz.layout.ts`:

- Add an import near the top, alongside `EditInObsidian`:
  ```ts
  import LastEdited from "./quartz/components/LastEdited"
  ```
- In `defaultContentPageLayout`, change `afterBody: []` to:
  ```ts
  afterBody: [LastEdited()],
  ```
- Do the same in `defaultListPageLayout`.
- Also add `LastEdited()` to `sharedPageComponents.afterBody` so it appears on tag/folder list pages too — actually, prefer keeping it on per-layout `afterBody` to stay consistent with how other bottom-of-article content is placed. Leave `sharedPageComponents.afterBody` as `[]`.

**Step 3: Apply overlay and verify.**

```bash
bash scripts/install.sh
bash scripts/wiki-serve.sh compiled
```

Open any article on `http://localhost:8081`. Expected: a small gray line at the very bottom reading `This page was last edited on 21 April 2026, at 14:32.` with a thin border above it.

**Step 4: Commit.**

```bash
git add quartz-overlay/quartz/components/LastEdited.tsx quartz-overlay/quartz.layout.ts
git commit -m "Add Wikipedia-style last-edited footer to articles"
```

---

### Task A3: Lead-paragraph convention in the compiler

**Context:** Wikipedia articles open with a one-paragraph lead that names the topic (in bold) and defines it in a single sentence, followed by 1–3 more sentences of scope. The compiler template already gestures at this, but doesn't enforce the **bold-first-mention** rule or cap lead length. Tightening the instruction + template produces more Wikipedia-like leads.

**Files:**
- Modify: `plugin/templates/article-template.md`
- Modify: `plugin/templates/sub-article-template.md`
- Modify: `plugin/skills/wiki-compiler/SKILL.md`

**Step 1: Tighten the article template's lead instructions.**

Edit `plugin/templates/article-template.md`. The existing lead section reads:

```
# {Topic Name}

**{Topic Name}** {is a one-sentence definition of what this topic IS. Wikipedia-style lead: no preamble, no "this note covers...", just the definition.}

{Second paragraph: 2-4 sentences of high-level scope, current state, and why it matters. Use inline wikilinks for named entities (sub-topics, people, concepts, organizations).}

{Optionally a third paragraph if the topic is large. Keep the whole lead under ~150 words.}
```

Replace the lead-only section (keep subsequent sections untouched) with:

```
# {Topic Name}

**{Topic Name}** {is — present tense — a one-sentence definition. The topic name MUST appear in bold on its first mention and MUST be the grammatical subject of the opening sentence. No preamble, no "this note covers…", no hedging. Definition first.}

{Second paragraph: 2-4 sentences of high-level scope and why the topic matters. Use inline wikilinks for every named entity (sub-topics, people, concepts, organizations). Avoid temporal words like "new", "recent", or "current".}

{Optionally a third paragraph if the topic warrants it. HARD CAP: the entire lead (all paragraphs before the first `##` heading) stays under 150 words. If the lead would be longer, move detail into a section.}
```

**Step 2: Apply the same convention to `sub-article-template.md`.**

Replace its lead block similarly — bold first mention, subject of the sentence, definition-first, link back to parent topic in the second paragraph, 150-word cap.

**Step 3: Add a writing rule to the skill file.**

In `plugin/skills/wiki-compiler/SKILL.md`, find the "Writing rules enforced at compile time" section at the bottom of `article-template.md` (it's a comment block). Add this as rule #7 in both templates' rule comments:

```
     7. LEAD PARAGRAPH: The article's first paragraph is the lead. The topic
        name MUST appear in **bold** on its first mention and MUST be the
        subject of the opening sentence. The lead (everything before the
        first `##` heading) MUST stay under 150 words. If content would push
        it longer, move detail into a section and leave a concise summary.
```

Also add a one-line entry in SKILL.md's "Phase 4: Compile" or wherever the generation prompt is assembled, so the agent loading each topic sees this rule loaded from the template but also reinforced in prose. Grep SKILL.md for "lead" and "bold" to place it naturally.

**Step 4: Sanity-check the edits.**

Re-read all three files. Confirm the rule reads consistently in each. Confirm no broken YAML frontmatter or dangling comment blocks.

**Step 5: Commit.**

```bash
git add plugin/templates/article-template.md plugin/templates/sub-article-template.md plugin/skills/wiki-compiler/SKILL.md
git commit -m "Enforce Wikipedia-style lead paragraph in compiler templates"
```

---

### Task A4: Gate thin-rules styling behind a theme attribute

**Context:** `custom.scss` already draws a thin border under H1 and H2. Phase B will add a theme-switcher toggle for this; in this task we only **gate** the existing rules behind a `saved-rules` attribute so the toggle works as a drop-in later. Default remains "on" — behavior is unchanged until the switcher lands in Phase B.

**Files:**
- Modify: `quartz-overlay/quartz/styles/custom.scss`

**Step 1: Wrap the existing H1/H2 border rules.**

Change the two existing blocks in `custom.scss` from:

```scss
.page-header .article-title {
  border-bottom: 1px solid var(--lightgray);
  padding-bottom: 0.17em;
  margin-bottom: 0.5em;
}

article h2 {
  border-bottom: 1px solid var(--lightgray);
  padding-bottom: 0.17em;
  margin-top: 1em;
}
```

To:

```scss
// Thin rules under H1/H2 — Wikipedia signature. Can be toggled off by the
// theme switcher (see ThemeSwitcher component) which sets saved-rules="off"
// on the root element. Default is "on" (no attribute set).
:root:not([saved-rules="off"]) {
  .page-header .article-title {
    border-bottom: 1px solid var(--lightgray);
    padding-bottom: 0.17em;
    margin-bottom: 0.5em;
  }

  article h2 {
    border-bottom: 1px solid var(--lightgray);
    padding-bottom: 0.17em;
    margin-top: 1em;
  }
}
```

**Step 2: Apply overlay and verify behavior is unchanged.**

```bash
bash scripts/install.sh
bash scripts/wiki-serve.sh compiled
```

Visit any article. Expected: thin line under the title and each `##` heading, same as before. Open devtools, add `saved-rules="off"` to the `<html>` tag manually. Expected: lines disappear. Remove the attribute; lines return.

**Step 3: Commit.**

```bash
git add quartz-overlay/quartz/styles/custom.scss
git commit -m "Gate thin heading-rules behind saved-rules attribute"
```

---

### Task A5: Open Phase A PR

**Step 1: Push and open PR.**

```bash
git push -u origin claude/wiki-polish
gh pr create --title "Wiki polish — Phase A: redlinks, last-edited, lead-paragraph, rules gate" --body "$(cat <<'EOF'
## Summary
- Redlinks: unresolved `[[wikilinks]]` render in Wikipedia-red instead of faded blue
- Last-edited footer: Wikipedia-style \"This page was last edited on…\" line at article bottom
- Lead-paragraph rule: compiler templates + skill now enforce bold-first-mention, definition-first, 150-word cap
- Thin-rules CSS now gated behind \`saved-rules\` attribute (default on), setting up Phase B's theme switcher
- Also: \`.worktrees/\` added to .gitignore

## Test plan
- [ ] `bash scripts/install.sh && bash scripts/wiki-serve.sh compiled` — site builds
- [ ] Unresolved `[[wikilinks]]` render red in light mode and in dark mode
- [ ] Article pages show last-edited footer with correct date
- [ ] Manually setting `saved-rules="off"` on `<html>` removes H1/H2 borders
- [ ] Re-reading `plugin/templates/article-template.md` — lead instructions read cleanly

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Step 2: Wait for review / CI, address feedback, merge.** Do NOT start Phase B until Phase A is merged — Phase B builds on the `saved-rules` gate added in A4.

---

## Phase B — theme switcher + infoboxes (PR #2)

> Start this phase on a fresh branch off `main` after Phase A merges:
> ```bash
> cd /Users/julius/conductor/workspaces/wikiforge/dakar
> git worktree add .worktrees/claude/wiki-polish-b -b claude/wiki-polish-b origin/main
> ```

### Task B1: ThemeSwitcher component — font only

**Context:** A single button in the left sidebar next to the dark-mode toggle. Clicking opens a small popover with three font options: Serif (Wikipedia default), Sans (current Source Sans Pro), System. Selection persists in `localStorage` under key `wiki-font` and is applied as `saved-font` attribute on `<html>`. We'll extend this component in B3/B4 to add rules + width toggles.

**Files:**
- Create: `quartz-overlay/quartz/components/ThemeSwitcher.tsx`
- Create: `quartz-overlay/quartz/components/scripts/themeSwitcher.inline.ts`
- Create: `quartz-overlay/quartz/components/styles/themeSwitcher.scss`
- Modify: `quartz-overlay/quartz.layout.ts` (import + add to the left-sidebar `Flex`)

**Step 1: Write the inline script (runs before DOM load, applies persisted pref).**

`quartz-overlay/quartz/components/scripts/themeSwitcher.inline.ts`:

```ts
type FontChoice = "serif" | "sans" | "system"

const savedFont = (localStorage.getItem("wiki-font") as FontChoice | null) ?? "serif"
document.documentElement.setAttribute("saved-font", savedFont)

document.addEventListener("nav", () => {
  const buttons = document.querySelectorAll<HTMLButtonElement>(".theme-switcher [data-font]")
  const applyFont = (font: FontChoice) => {
    document.documentElement.setAttribute("saved-font", font)
    localStorage.setItem("wiki-font", font)
    buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.font === font)))
  }
  applyFont((localStorage.getItem("wiki-font") as FontChoice | null) ?? "serif")

  buttons.forEach((btn) => {
    const handler = () => applyFont(btn.dataset.font as FontChoice)
    btn.addEventListener("click", handler)
    window.addCleanup(() => btn.removeEventListener("click", handler))
  })

  // Popover toggle
  const toggle = document.querySelector<HTMLButtonElement>(".theme-switcher-toggle")
  const menu = document.querySelector<HTMLDivElement>(".theme-switcher-menu")
  if (toggle && menu) {
    const open = () => menu.classList.toggle("open")
    toggle.addEventListener("click", open)
    window.addCleanup(() => toggle.removeEventListener("click", open))
  }
})
```

**Step 2: Write the SCSS.**

`quartz-overlay/quartz/components/styles/themeSwitcher.scss`:

```scss
.theme-switcher {
  position: relative;

  .theme-switcher-toggle {
    background: transparent;
    border: none;
    color: var(--darkgray);
    cursor: pointer;
    padding: 0.2em 0.4em;
    font-size: 1em;
  }

  .theme-switcher-menu {
    display: none;
    position: absolute;
    top: 100%;
    right: 0;
    background: var(--light);
    border: 1px solid var(--lightgray);
    border-radius: 4px;
    padding: 0.4em;
    z-index: 10;
    min-width: 160px;

    &.open {
      display: block;
    }

    .row {
      display: flex;
      flex-direction: column;
      gap: 0.2em;
      margin-bottom: 0.6em;

      &:last-child { margin-bottom: 0; }

      .label {
        font-size: 0.75em;
        color: var(--gray);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .options {
        display: flex;
        gap: 0.2em;
      }

      button {
        flex: 1;
        background: transparent;
        border: 1px solid var(--lightgray);
        color: var(--dark);
        cursor: pointer;
        padding: 0.2em 0.4em;
        font-size: 0.85em;
        border-radius: 3px;

        &[aria-pressed="true"] {
          background: var(--secondary);
          color: var(--light);
          border-color: var(--secondary);
        }
      }
    }
  }
}

:root[saved-font="serif"] {
  --bodyFont: "Charter", "Source Serif Pro", Georgia, serif;
}
:root[saved-font="sans"] {
  --bodyFont: "Source Sans Pro", sans-serif;
}
:root[saved-font="system"] {
  --bodyFont: system-ui, -apple-system, sans-serif;
}

body, article {
  font-family: var(--bodyFont, "Source Sans Pro", sans-serif);
}
```

Note: verify the actual CSS variable name Quartz uses for body font. If it's different (e.g., `--bodyFont` may not be the real name), read `~/Documents/wiki-quartz/quartz/styles/variables.scss` and adjust. If Quartz sets the font-family directly on `body`, our `body, article { font-family: var(--bodyFont) }` rule wins because it's loaded after `base.scss`.

**Step 3: Write the component.**

`quartz-overlay/quartz/components/ThemeSwitcher.tsx`:

```tsx
// @ts-ignore
import script from "./scripts/themeSwitcher.inline"
import styles from "./styles/themeSwitcher.scss"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"

const ThemeSwitcher: QuartzComponent = ({ displayClass }: QuartzComponentProps) => (
  <div class={classNames(displayClass, "theme-switcher")}>
    <button class="theme-switcher-toggle" aria-label="Display settings">Aa</button>
    <div class="theme-switcher-menu">
      <div class="row">
        <span class="label">Font</span>
        <div class="options">
          <button data-font="serif">Serif</button>
          <button data-font="sans">Sans</button>
          <button data-font="system">System</button>
        </div>
      </div>
    </div>
  </div>
)

ThemeSwitcher.beforeDOMLoaded = script
ThemeSwitcher.css = styles

export default (() => ThemeSwitcher) satisfies QuartzComponentConstructor
```

**Step 4: Wire into the sidebar.**

In `quartz-overlay/quartz.layout.ts`, import the new component and add to the `Flex` row alongside `Darkmode` and `ReaderMode`:

```ts
import ThemeSwitcher from "./quartz/components/ThemeSwitcher"
// ...
Component.Flex({
  components: [
    { Component: Component.Search(), grow: true },
    { Component: Component.Darkmode() },
    { Component: Component.ReaderMode() },
    { Component: ThemeSwitcher() },
  ],
}),
```

Do this in both `defaultContentPageLayout` and `defaultListPageLayout`.

**Step 5: Verify.**

```bash
bash scripts/install.sh
bash scripts/wiki-serve.sh compiled
```

Expected: An `Aa` button appears next to the dark-mode toggle. Clicking opens a menu with three font buttons. Clicking one changes body font immediately and persists across reload. The active button is highlighted.

**Step 6: Commit.**

```bash
git add quartz-overlay/quartz/components/ThemeSwitcher.tsx quartz-overlay/quartz/components/scripts/themeSwitcher.inline.ts quartz-overlay/quartz/components/styles/themeSwitcher.scss quartz-overlay/quartz.layout.ts
git commit -m "Add theme switcher with body-font toggle (serif/sans/system)"
```

---

### Task B2: Add thin-rules toggle to the switcher

**Files:**
- Modify: `quartz-overlay/quartz/components/ThemeSwitcher.tsx`
- Modify: `quartz-overlay/quartz/components/scripts/themeSwitcher.inline.ts`

**Step 1: Extend the inline script.**

In `themeSwitcher.inline.ts`, add alongside the font block:

```ts
type RulesChoice = "on" | "off"
const savedRules = (localStorage.getItem("wiki-rules") as RulesChoice | null) ?? "on"
document.documentElement.setAttribute("saved-rules", savedRules)
```

Add to the `nav` handler:

```ts
const ruleButtons = document.querySelectorAll<HTMLButtonElement>(".theme-switcher [data-rules]")
const applyRules = (rules: RulesChoice) => {
  document.documentElement.setAttribute("saved-rules", rules)
  localStorage.setItem("wiki-rules", rules)
  ruleButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.rules === rules)))
}
applyRules((localStorage.getItem("wiki-rules") as RulesChoice | null) ?? "on")

ruleButtons.forEach((btn) => {
  const handler = () => applyRules(btn.dataset.rules as RulesChoice)
  btn.addEventListener("click", handler)
  window.addCleanup(() => btn.removeEventListener("click", handler))
})
```

**Step 2: Add the row to the popover JSX.**

In `ThemeSwitcher.tsx`, add after the Font row:

```tsx
<div class="row">
  <span class="label">Heading rules</span>
  <div class="options">
    <button data-rules="on">On</button>
    <button data-rules="off">Off</button>
  </div>
</div>
```

**Step 3: Verify + commit.**

```bash
bash scripts/install.sh && bash scripts/wiki-serve.sh compiled
```

Toggle rules on/off — borders under H1/H2 should appear/disappear and persist.

```bash
git add quartz-overlay/quartz/components/ThemeSwitcher.tsx quartz-overlay/quartz/components/scripts/themeSwitcher.inline.ts
git commit -m "Add heading-rules toggle to theme switcher"
```

---

### Task B3: Add reading-width toggle

**Files:**
- Modify: `quartz-overlay/quartz/components/ThemeSwitcher.tsx`
- Modify: `quartz-overlay/quartz/components/scripts/themeSwitcher.inline.ts`
- Modify: `quartz-overlay/quartz/components/styles/themeSwitcher.scss`

**Step 1: Extend the script (same pattern as rules toggle).**

`type WidthChoice = "narrow" | "wide"`, localStorage key `wiki-width`, default `"narrow"` (Wikipedia feel), attribute `saved-width`. Mirror the pattern from B2.

**Step 2: Add the popover row.**

```tsx
<div class="row">
  <span class="label">Width</span>
  <div class="options">
    <button data-width="narrow">Narrow</button>
    <button data-width="wide">Wide</button>
  </div>
</div>
```

**Step 3: Add the width CSS.**

Append to `themeSwitcher.scss`:

```scss
:root[saved-width="narrow"] {
  .page > #quartz-body .center {
    max-width: 48em;
  }
}
// "wide" = no override, Quartz default width applies.
```

Note: `48em` is ~768px at default font size — close to Wikipedia's content column. Verify by inspecting in devtools and adjust if too narrow/too wide.

**Step 4: Verify + commit.**

```bash
bash scripts/install.sh && bash scripts/wiki-serve.sh compiled
```

Toggle narrow/wide — content column should tighten and widen.

```bash
git add quartz-overlay/quartz/components/ThemeSwitcher.tsx quartz-overlay/quartz/components/scripts/themeSwitcher.inline.ts quartz-overlay/quartz/components/styles/themeSwitcher.scss
git commit -m "Add reading-width toggle (narrow/wide) to theme switcher"
```

---

### Task B4: Infobox component

**Context:** The compiler emits an `infobox:` block in each article's YAML frontmatter. The component reads it, renders a right-floated card with an optional image + caption + ordered key/value rows. If frontmatter has no `infobox`, renders nothing.

Schema (agreed in design):

```yaml
infobox:
  title: "Nora Belrose"              # optional override — defaults to article title
  image: "../images/topic-slug/belrose.jpg"
  caption: "Nora Belrose, 2024."
  fields:
    - label: "Born"
      value: "1995"
    - label: "Field"
      value: "AI safety"             # plain text or HTML — LLM may emit <a href="/ai-safety">AI safety</a>
```

All fields are optional. A frontmatter block with only `image` + `caption` is valid; so is one with only `fields`.

**Files:**
- Create: `quartz-overlay/quartz/components/Infobox.tsx`
- Create: `quartz-overlay/quartz/components/styles/infobox.scss`
- Modify: `quartz-overlay/quartz.layout.ts` (import + add to `beforeBody`)

**Step 1: Write the SCSS.**

`quartz-overlay/quartz/components/styles/infobox.scss`:

```scss
.infobox {
  float: right;
  width: 22em;
  max-width: 100%;
  margin: 0 0 1em 1.5em;
  padding: 0.75em;
  background: var(--light);
  border: 1px solid var(--lightgray);
  font-size: 0.88em;

  .infobox-title {
    font-weight: bold;
    text-align: center;
    padding-bottom: 0.5em;
    border-bottom: 1px solid var(--lightgray);
    margin-bottom: 0.5em;
  }

  .infobox-image {
    text-align: center;
    margin-bottom: 0.5em;

    img {
      max-width: 100%;
      height: auto;
    }
  }

  .infobox-caption {
    font-size: 0.9em;
    color: var(--darkgray);
    text-align: center;
    margin-top: 0.25em;
    margin-bottom: 0.5em;
  }

  .infobox-fields {
    margin: 0;
    padding: 0;

    .infobox-row {
      display: grid;
      grid-template-columns: minmax(6em, 1fr) 2fr;
      gap: 0.5em;
      padding: 0.25em 0;
      border-bottom: 1px solid var(--lightgray);

      &:last-child { border-bottom: none; }
    }

    .infobox-label {
      font-weight: bold;
    }
  }
}

@media (max-width: 640px) {
  .infobox {
    float: none;
    width: 100%;
    margin: 0 0 1em 0;
  }
}
```

**Step 2: Write the component.**

`quartz-overlay/quartz/components/Infobox.tsx`:

```tsx
import styles from "./styles/infobox.scss"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"

interface InfoboxField {
  label: string
  value: string
}

interface InfoboxData {
  title?: string
  image?: string
  caption?: string
  fields?: InfoboxField[]
}

const Infobox: QuartzComponent = ({ fileData }: QuartzComponentProps) => {
  const data = fileData.frontmatter?.infobox as InfoboxData | undefined
  if (!data) return null

  const title = data.title ?? (fileData.frontmatter?.title as string | undefined)

  return (
    <aside class="infobox">
      {title && <div class="infobox-title">{title}</div>}
      {data.image && (
        <div class="infobox-image">
          <img src={data.image} alt={data.caption ?? title ?? ""} />
          {data.caption && <div class="infobox-caption">{data.caption}</div>}
        </div>
      )}
      {data.fields && data.fields.length > 0 && (
        <dl class="infobox-fields">
          {data.fields.map((f) => (
            <div class="infobox-row">
              <dt class="infobox-label">{f.label}</dt>
              <dd class="infobox-value" dangerouslySetInnerHTML={{ __html: f.value }} />
            </div>
          ))}
        </dl>
      )}
    </aside>
  )
}

Infobox.css = styles

export default (() => Infobox) satisfies QuartzComponentConstructor
```

Note: `dangerouslySetInnerHTML` on the value lets the LLM emit `<a href="/slug">link</a>` inside field values. This is safe because all content is author-generated at compile time, not user input. Document this decision in a comment in the component.

**Step 3: Wire into the layout.**

In `quartz-overlay/quartz.layout.ts`, import and add to `defaultContentPageLayout.beforeBody` — it must render BEFORE the article body so the float takes effect:

```ts
import Infobox from "./quartz/components/Infobox"
// ...
beforeBody: [
  Component.ConditionalRender({
    component: Component.Breadcrumbs(),
    condition: (page) => page.fileData.slug !== "index",
  }),
  Component.ArticleTitle(),
  Component.ContentMeta(),
  Component.TagList(),
  EditInObsidian(),
  Infobox(),
],
```

Also add `Infobox()` to `defaultListPageLayout.beforeBody` — some topic hubs are rendered there.

**Step 4: Temporary end-to-end verify.**

Find any article in `~/Documents/Obsidian Vault/wiki/` and hand-edit its frontmatter to add a test infobox:

```yaml
infobox:
  title: Test Infobox
  caption: "Testing render"
  fields:
    - label: "Field one"
      value: "Value one"
    - label: "Field two"
      value: "Another value"
```

Run `bash scripts/install.sh && bash scripts/wiki-serve.sh compiled`. Expected: a floated card on the right of that article with the title, two rows, and Wikipedia-like border. Revert the hand-edit after verifying.

**Step 5: Commit.**

```bash
git add quartz-overlay/quartz/components/Infobox.tsx quartz-overlay/quartz/components/styles/infobox.scss quartz-overlay/quartz.layout.ts
git commit -m "Add Infobox component rendering frontmatter-driven summary card"
```

---

### Task B5: Teach the compiler to emit infoboxes

**Context:** Now that the renderer can display infoboxes, the compiler needs to generate them. We add schema guidance to the SKILL.md and example frontmatter blocks to the templates. The LLM decides whether a given article warrants an infobox — hub articles and bio-like notes usually do; short concept pages may not.

**Files:**
- Modify: `plugin/skills/wiki-compiler/SKILL.md`
- Modify: `plugin/templates/article-template.md`
- Modify: `plugin/templates/sub-article-template.md`

**Step 1: Add an "Infoboxes" subsection to SKILL.md.**

Find the phase that covers article generation (likely "Phase 4" or the compilation prompt assembly). Insert after existing writing-rules guidance:

```markdown
### Infoboxes

Where an article can meaningfully be summarized by a small set of facts + an optional image, emit an `infobox:` block in the article's YAML frontmatter. The Quartz renderer converts this into a right-floated summary card on the article page.

Emit an infobox when the topic has **at least three** concrete, stable attributes you can assert from the source material. Skip it if the article is short (<300 words), abstract, or you'd be inventing fields to fill rows.

**Schema:**

```yaml
infobox:
  title: "Display title"                         # optional — defaults to article H1
  image: "../images/{topic-slug}/{filename}"     # optional, relative to the article file
  caption: "One-line caption"                    # optional
  fields:                                        # list, order preserved
    - label: "Field label"
      value: "Plain text or <a href=\"/slug\">inline HTML link</a>"
```

**Rules:**
1. Every field must be sourced — do NOT guess. Skip fields the sources don't support.
2. For `value`, prefer plain text. Use `<a href="/slug">display</a>` HTML for cross-references where `/slug` matches another article's slug. Do not use `[[wikilinks]]` in `value` — frontmatter does not run through the markdown pipeline.
3. Keep labels short (1–3 words), title case.
4. Order fields most-important first. Typical orderings by article kind are below.
5. Images must already exist under `wiki/images/{topic-slug}/`.

**Common article kinds (guidance, not a hard taxonomy):**

- **Person:** Born, Died, Nationality, Known for, Field, Affiliation
- **Concept:** Field, Introduced by, Year, Related to
- **Organization:** Founded, Founders, Headquarters, Type, Field
- **Work (paper/book):** Authors, Year, Venue, Topic
- **Event:** Date, Location, Participants, Outcome
- **Place:** Location, Established, Coordinates

If none of these fit, emit a generic infobox with whatever 3+ stable attributes the sources support.
```

**Step 2: Add an example block to `article-template.md`.**

Insert in the frontmatter section, showing it as optional:

```markdown
---
topic: {Topic Name}
last_compiled: {YYYY-MM-DD}
source_count: {number}
source: {primary source path}
sub_pages: [{list}]
status: active

# Optional: summary card rendered as a right-floated infobox.
# Emit this when the topic can be meaningfully summarized by 3+ concrete facts.
# See SKILL.md → "Infoboxes" for the full schema and guidance.
infobox:
  title: "{Topic Name}"
  image: "../images/{topic-slug}/{main-image}.png"
  caption: "{One-line caption.}"
  fields:
    - label: "{Label 1}"
      value: "{Value 1}"
    - label: "{Label 2}"
      value: "{Value 2}"
---
```

**Step 3: Add the same example to `sub-article-template.md`.**

Same optional block, same schema, same "when to emit" guidance referencing SKILL.md.

**Step 4: Sanity-check.**

Re-read SKILL.md and both templates end-to-end. Confirm:
- YAML frontmatter examples are valid YAML
- Rule numbers in the writing-rules comment blocks are still sequential
- The infobox "kind" guidance in SKILL.md is reachable from the article-generation phase (cross-reference present)

**Step 5: Commit.**

```bash
git add plugin/skills/wiki-compiler/SKILL.md plugin/templates/article-template.md plugin/templates/sub-article-template.md
git commit -m "Teach compiler to emit infobox frontmatter blocks"
```

---

### Task B6: Open Phase B PR

```bash
git push -u origin claude/wiki-polish-b
gh pr create --title "Wiki polish — Phase B: theme switcher + compile-time infoboxes" --body "$(cat <<'EOF'
## Summary
- Theme switcher popover (sidebar): body font (Serif/Sans/System), heading rules on/off, reading width narrow/wide — all persisted to localStorage
- Infobox component: renders a right-floated summary card from `infobox:` frontmatter blocks (title, image, caption, ordered field rows)
- Compiler SKILL.md + templates now guide the LLM to emit `infobox:` frontmatter for articles with 3+ stable attributes

## Test plan
- [ ] `bash scripts/install.sh && bash scripts/wiki-serve.sh compiled` — site builds
- [ ] Theme switcher button appears next to Darkmode; popover opens/closes
- [ ] Font toggle applies immediately and persists across reload
- [ ] Rules toggle shows/hides H1/H2 borders; persists
- [ ] Width toggle narrows/widens content column; persists
- [ ] Hand-adding an `infobox:` frontmatter block to a test article renders the card correctly (title, image, caption, field rows, mobile-stacked at <640px)
- [ ] Run `/wiki-compile` against a representative topic; LLM emits `infobox:` blocks following the schema

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Out of scope for this plan (explicitly noted)

- Hatnotes, references section, figure/caption helpers, open-graph meta, print stylesheet — discussed in the brainstorming phase but deferred. Can become follow-up plans.
- Cross-site font loading changes (the existing `fontOrigin: "googleFonts"` in `quartz.config.ts` may or may not ship "Charter" — if Charter isn't reliably available, fall back to Georgia or self-host. Not addressed here; CSS stack degrades gracefully.)
- Migrating any existing compiled wiki articles to add infoboxes — that's a user-triggered recompile, not a plan task.
