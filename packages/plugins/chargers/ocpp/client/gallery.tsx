import type { PluginGallery } from "../../../pluginOptions.ts";
import { PluginFieldInputs } from "../../../hostUi.ts";
import { OCPP_DEFAULTS, OCPP_FIELDS } from "./fields.ts";

export const ocppGallery: PluginGallery = {
  id: "ocpp",
  title: "OCPP charger",
  description:
    "Static configuration fields; no websocket, pairing or network calls.",
  specimens: [{
    label: "Charger settings",
    Component: () => (
      <PluginFieldInputs
        fields={OCPP_FIELDS}
        values={{ ...OCPP_DEFAULTS, ocppChargerId: "example-wallbox" }}
        onChange={() => {}}
      />
    ),
  }],
};
