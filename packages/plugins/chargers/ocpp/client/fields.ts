import type { PluginConfigField } from "../../../hostUi.ts";

/** Shown in the Charger ID box and as the stand-in inside the connection
 *  URL, so the two obviously refer to the same value. */
export const CHARGER_ID_PLACEHOLDER = "my-wallbox";

/** The one definition of OCPP's config. Rendered by both the wizard step and
 *  the settings panel, so labels, help and grouping cannot drift apart. */
export const OCPP_FIELDS: PluginConfigField[] = [
  {
    key: "ocppChargerId",
    label: "Charger ID",
    help: "Any name you choose. You must enter this same value in your " +
      "charger as its charge point id. Letters, numbers, dots, dashes and " +
      "underscores only.",
    placeholder: CHARGER_ID_PLACEHOLDER,
    required: true,
    width: 180,
  },
  {
    key: "ocppMaxAmps",
    label: "Max amps",
    help: "The charger's maximum charging current.",
    width: 80,
    advanced: true,
  },
  {
    key: "ocppMinAmps",
    label: "Min amps",
    help: "The charger's minimum charging current (J1772 floor is 6A). " +
      "Charging will not start below this.",
    width: 80,
    advanced: true,
  },
  {
    key: "ocppPhases",
    label: "Phases",
    help: "Used to derive amps from reported watts when the charger does " +
      "not report current.",
    options: [
      { value: "1", label: "Single phase" },
      { value: "3", label: "Three phase" },
    ],
    advanced: true,
  },
  {
    key: "ocppMeterTimeoutSeconds",
    label: "Meter timeout (seconds)",
    help: "Reported state goes stale when no MeterValues arrive within this.",
    width: 80,
    advanced: true,
  },
];

/** Field keys with their defaults, for hosts that hold their own draft. */
export const OCPP_DEFAULTS: Record<string, string> = {
  ocppChargerId: "",
  ocppMaxAmps: "32",
  ocppMinAmps: "6",
  ocppPhases: "1",
  ocppMeterTimeoutSeconds: "300",
};
