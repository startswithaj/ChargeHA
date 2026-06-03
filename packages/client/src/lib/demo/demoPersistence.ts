// Persists the demo's mutable state to sessionStorage, so edits survive a reload
// but reset when the tab closes. The simulated series is never persisted.

import type { DemoMutable } from "./demoState.ts";

const STORAGE_KEY = "chargeha-demo-state";

/** Load persisted mutable state, or null if absent/unreadable. */
export const loadPersisted = (): DemoMutable | null => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as DemoMutable : null;
  } catch (error) {
    console.warn("Demo: failed to read persisted state, using defaults", error);
    return null;
  }
};

/** Persist mutable state. Storage failures (private mode, quota) are non-fatal. */
export const savePersisted = (mutable: DemoMutable): void => {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(mutable));
  } catch (error) {
    console.warn("Demo: failed to persist state", error);
  }
};

/** Clear persisted state. */
export const clearPersisted = (): void => {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn("Demo: failed to clear persisted state", error);
  }
};
