// @ts-ignore
import script from "./scripts/rightpanel.inline"
import styles from "./styles/rightPanelToggle.scss"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"

const RightPanelToggle: QuartzComponent = ({ displayClass }: QuartzComponentProps) => {
  return (
    <button
      type="button"
      class={classNames(displayClass, "right-panel-toggle")}
      aria-label="Toggle table of contents panel"
      aria-pressed="false"
      title="Toggle table of contents panel"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M15 4v16" />
        <path d="M6.5 8h5" />
        <path d="M6.5 12h5" />
        <path d="M6.5 16h3" />
        <path class="panel-off-mark" d="M4 20 20 4" />
      </svg>
    </button>
  )
}

RightPanelToggle.beforeDOMLoaded = script
RightPanelToggle.css = styles

export default (() => RightPanelToggle) satisfies QuartzComponentConstructor
