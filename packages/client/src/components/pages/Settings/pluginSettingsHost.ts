import { createContext, useContext } from "react";
import type { SaveStatus } from "../../../hooks/useSectionConfig.ts";

/** Dirty/save state a plugin settings form surfaces up to its host panel. */
export interface PluginSettingsState {
  isDirty: boolean;
  save: () => void;
  saveStatus: SaveStatus;
}

const PluginSettingsHostContext = createContext<
  ((state: PluginSettingsState | null) => void) | null
>(null);

/** Host panels (e.g. My Equipment) wrap plugin settings in this provider so the
 *  panel's header Save + dirty highlight + Saved badge cover the plugin fields. */
export const PluginSettingsHostProvider = PluginSettingsHostContext.Provider;

/** Used by PluginConfigForm to report its state up to the host. */
export const usePluginSettingsHost = () =>
  useContext(PluginSettingsHostContext);

/** Plugin settings components are resolved from a registry and take no props,
 *  so a host that wants the cursor in the first field asks through here. */
const PluginAutoFocusContext = createContext(false);

export const PluginAutoFocusProvider = PluginAutoFocusContext.Provider;

export const usePluginAutoFocus = () => useContext(PluginAutoFocusContext);
