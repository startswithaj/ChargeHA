// The components from core that plugins can use. Plugins must import components via this file.

// Typed tRPC client factory — plugins widen it with their own router type.
export { widenTrpc } from "../client/src/trpc.ts";

// A step declares its Next button by returning it from useStep — no separate registration.
export type {
  PluginStepDef,
  StepBehaviour,
  StepProps,
  WizardNext,
  WizardNextHandler,
} from "../client/src/components/Wizard/flow.ts";
export { advanceOnly } from "../client/src/components/Wizard/flow.ts";
export { default as stepStyles } from "../client/src/components/Wizard/steps/steps.module.css";

// Settings page integration.
export { SettingsRow } from "../client/src/components/pages/Settings/SettingsLayout.tsx";
export {
  type PluginConfigField,
  PluginConfigForm,
  PluginFieldInputs,
  PluginTestRow,
} from "../client/src/components/pages/Settings/PluginConfigForm.tsx";
export { usePluginSettingsHost } from "../client/src/components/pages/Settings/pluginSettingsHost.ts";
export { useSaveStatus } from "../client/src/hooks/useSectionConfig.ts";

// Shared UI primitives.
export { Spinner } from "../client/src/components/ui/Spinner.tsx";
export { ErrorBanner } from "../client/src/components/ui/ErrorBanner.tsx";
export { WaitingBars } from "../client/src/components/ui/WaitingBars.tsx";
export { FormError } from "../client/src/components/ui/FormError.tsx";
export {
  type DiscoveryResult,
  DiscoveryResultList,
  NetworkDeviceSearch,
  type NetworkSearchResult,
  useDefaultSubnet,
} from "./NetworkDeviceSearch.tsx";
export { TestResultBadge, type TestStatus } from "./TestResultBadge.tsx";
export { default as dialogStyles } from "../client/src/components/ScheduleDialog/ScheduleDialog.module.css";

// Hooks.
export {
  type PhotonResult,
  useAddressAutocomplete,
} from "../client/src/hooks/useAddressAutocomplete.ts";
