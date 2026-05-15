const rightPanelStorageKey = "right-panel"
const rightPanelAttr = "saved-right-panel"

const readRightPanelHidden = () => {
  try {
    return localStorage.getItem(rightPanelStorageKey) === "hidden"
  } catch {
    return false
  }
}

const writeRightPanelHidden = (hidden: boolean) => {
  document.documentElement.setAttribute(rightPanelAttr, hidden ? "hidden" : "visible")

  for (const button of document.getElementsByClassName("right-panel-toggle")) {
    button.setAttribute("aria-pressed", hidden ? "true" : "false")
    button.setAttribute(
      "title",
      hidden ? "Show table of contents panel" : "Hide table of contents panel",
    )
    button.setAttribute(
      "aria-label",
      hidden ? "Show table of contents panel" : "Hide table of contents panel",
    )
  }
}

writeRightPanelHidden(readRightPanelHidden())

document.addEventListener("nav", () => {
  const toggleRightPanel = () => {
    const hidden = document.documentElement.getAttribute(rightPanelAttr) !== "hidden"
    writeRightPanelHidden(hidden)
    try {
      localStorage.setItem(rightPanelStorageKey, hidden ? "hidden" : "visible")
    } catch {}
  }

  writeRightPanelHidden(readRightPanelHidden())

  for (const button of document.getElementsByClassName("right-panel-toggle")) {
    button.addEventListener("click", toggleRightPanel)
    window.addCleanup &&
      window.addCleanup(() => button.removeEventListener("click", toggleRightPanel))
  }
})
