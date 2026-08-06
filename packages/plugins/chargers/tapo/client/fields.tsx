import type { PluginConfigField } from "../../../hostUi.ts";
import { TapoDiscoverySection } from "./TapoControls.tsx";

/** The one definition of Tapo's config. Rendered by both the wizard step and
 *  the settings panel, so labels, help and grouping cannot drift apart. */
export const TAPO_FIELDS: PluginConfigField[] = [
  {
    key: "tapoHost",
    label: "Plug IP address",
    help: "Local IP of your Tapo plug. Use Search to auto-detect it.",
    placeholder: "192.168.1.60",
    required: true,
    width: 150,
    after: (setHost) => <TapoDiscoverySection onUse={setHost} />,
  },
  {
    key: "tapoEmail",
    label: "Tapo account email",
    required: true,
    width: 220,
  },
  {
    key: "tapoPassword",
    label: "Tapo account password",
    help: "Stored encrypted. Only used locally to authenticate with the plug.",
    secret: true,
    required: true,
    width: 220,
  },
  {
    key: "tapoFixedDrawAmps",
    label: "EVSE draw (amps)",
    help: "The current your EVSE draws from this socket. The plug's " +
      "continuous rating must be at or above this.",
    width: 80,
  },
  {
    key: "tapoDetectionThresholdW",
    label: "Charging detection threshold (W)",
    help: "Measured draw at or above this counts as charging; below it the " +
      "plug reports no draw.",
    width: 80,
    advanced: true,
  },
  {
    key: "tapoPollIntervalSeconds",
    label: "Poll interval (seconds)",
    help: "How often the plug is polled. Local and free — 10s tracks solar " +
      "closely.",
    width: 80,
    advanced: true,
  },
];

/** Field keys with their defaults, for hosts that hold their own draft. */
export const TAPO_DEFAULTS: Record<string, string> = {
  tapoHost: "",
  tapoEmail: "",
  tapoPassword: "",
  tapoFixedDrawAmps: "10",
  tapoDetectionThresholdW: "100",
  tapoPollIntervalSeconds: "10",
};
