// Persists the demo's mutable state to sessionStorage, so edits survive a reload
// but reset when the tab closes. The simulated series is never persisted.

import type { DemoMutable } from "./demoState.ts";

const STORAGE_KEY = "chargeha-demo-state";

// Shape-check persisted JSON so a stale/corrupt blob falls back to defaults
// rather than crashing downstream with a wrongly-typed cast.
const isDemoMutable = (v: unknown): v is DemoMutable => {
  if (typeof v !== "object" || v === null) return false;
  const m = v as Record<string, unknown>;
  return typeof m.config === "object" && m.config !== null &&
    Array.isArray(m.vehicles) && Array.isArray(m.chargers) &&
    Array.isArray(m.schedules) &&
    Array.isArray(m.tariffs) && typeof m.authenticated === "boolean";
};

export const loadPersisted = (): DemoMutable | null => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (isDemoMutable(parsed)) return parsed;
    console.warn("Demo: persisted state has unexpected shape, using defaults");
    return null;
  } catch (error) {
    console.warn("Demo: failed to read persisted state, using defaults", error);
    return null;
  }
};

// Storage failures (private mode, quota) are non-fatal.
export const savePersisted = (mutable: DemoMutable): void => {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(mutable));
  } catch (error) {
    console.warn("Demo: failed to persist state", error);
  }
};

export const clearPersisted = (): void => {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn("Demo: failed to clear persisted state", error);
  }
};
