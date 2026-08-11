// Lives here so the section that renders the id and the cards that link to
// it cannot drift apart.
export const CHARGERS_ANCHOR_ID = "settings-chargers";

// The rAF waits for React to commit the new page — the element does not
// exist yet when the click handler runs. `scrollIntoView` is guarded
// because jsdom does not implement it.
export function revealSettingsSection(id: string): void {
  requestAnimationFrame(() => {
    document.getElementById(id)?.scrollIntoView?.({
      behavior: "smooth",
      block: "start",
    });
  });
}
