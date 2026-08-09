/** Anchor for the Settings → Chargers section. Lives here so the section that
 *  renders the id and the cards that link to it cannot drift apart. */
export const CHARGERS_ANCHOR_ID = "settings-chargers";

/** Scroll a settings section into view after navigating to it. Settings is a
 *  long page, so landing at the top leaves the user hunting for the control
 *  the link promised.
 *
 *  The rAF waits for React to commit the new page — the element does not exist
 *  yet when the click handler runs. `scrollIntoView` is guarded because jsdom
 *  does not implement it. */
export function revealSettingsSection(id: string): void {
  requestAnimationFrame(() => {
    document.getElementById(id)?.scrollIntoView?.({
      behavior: "smooth",
      block: "start",
    });
  });
}
