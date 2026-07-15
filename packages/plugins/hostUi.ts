/**
 * The host UI surface plugins are allowed to consume — the client-side
 * counterpart of `PluginDependencies`. Plugin production code must import
 * main's client code through this barrel only (enforced by the
 * `no-main-trpc` lint plugin); test files may deep-import test helpers.
 *
 * Main can refactor anything in `client/src` freely as long as these
 * exports keep their contracts.
 */

// Typed tRPC client factory — plugins widen it with their own router type.
export { widenTrpc } from "../client/src/trpc.ts";

// Wizard shell integration.
export type { StepProps } from "../client/src/components/Wizard/WizardShell.tsx";
export {
  hintUnlessLoading,
  useWizardNextControl,
} from "../client/src/components/Wizard/wizardNextControl.ts";
export { default as stepStyles } from "../client/src/components/Wizard/steps/steps.module.css";

// Settings page integration.
export { SettingsRow } from "../client/src/components/pages/Settings/SettingsLayout.tsx";
export {
  type PluginConfigField,
  PluginConfigForm,
} from "../client/src/components/pages/Settings/PluginConfigForm.tsx";
export { usePluginSettingsHost } from "../client/src/components/pages/Settings/pluginSettingsHost.ts";
export { useSaveStatus } from "../client/src/hooks/useSectionConfig.ts";

// Shared UI primitives.
export { Spinner } from "../client/src/components/ui/Spinner.tsx";
export { ErrorBanner } from "../client/src/components/ui/ErrorBanner.tsx";
export { default as dialogStyles } from "../client/src/components/ScheduleDialog/ScheduleDialog.module.css";

// Hooks.
export {
  type PhotonResult,
  useAddressAutocomplete,
} from "../client/src/hooks/useAddressAutocomplete.ts";
