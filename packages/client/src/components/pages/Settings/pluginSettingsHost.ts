import { createContext, useContext } from "react";
import type { SaveStatus } from "../../../hooks/useSectionConfig.ts";

// Surfaced by a plugin settings form up to its host panel.
export interface PluginSettingsState {
  isDirty: boolean;
  save: () => void;
  saveStatus: SaveStatus;
}

const PluginSettingsHostContext = createContext<
  ((state: PluginSettingsState | null) => void) | null
>(null);

// Host panels (e.g. My Equipment) wrap plugin settings in this provider so
// the panel's header Save + dirty highlight + Saved badge cover the fields.
export const PluginSettingsHostProvider = PluginSettingsHostContext.Provider;

export const usePluginSettingsHost = () =>
  useContext(PluginSettingsHostContext);

// The registry fixes what props a plugin settings panel receives, so a host
// wanting the cursor in the first field asks through here rather than
// through a prop every panel must forward.
const PluginAutoFocusContext = createContext(false);

export const PluginAutoFocusProvider = PluginAutoFocusContext.Provider;

export const usePluginAutoFocus = () => useContext(PluginAutoFocusContext);
