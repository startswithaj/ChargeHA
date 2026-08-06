import { Code, Text } from "@radix-ui/themes";
import { SettingsRow } from "../../../hostUi.ts";

/** Base URL the charger connects to. The charge point id is a separate field
 *  on most chargers, so it is shown separately rather than only baked into a
 *  combined URL. */
export function ocppServerUrl(): string {
  const port = globalThis.location.port ? `:${globalThis.location.port}` : "";
  return `ws://${globalThis.location.hostname}${port}/api/charger/ocpp`;
}

/** Shown identically in the wizard step and the settings panel. */
export function OcppConnectionDetails(
  { chargerId }: { chargerId: string },
) {
  const base = ocppServerUrl();
  const id = chargerId || "<charger-id>";
  return (
    <>
      <Text size="2">
        In your charger's OCPP settings (its own app or web portal) enter{" "}
        <Text size="2" weight="bold">both</Text>{" "}
        of these, then wait — the charger connects to ChargeHA over your LAN.
      </Text>
      <SettingsRow
        label="OCPP server URL"
        help="Sometimes called the central system or backend URL."
      >
        <Code size="2">{base}</Code>
      </SettingsRow>
      <SettingsRow
        label="Charge point ID"
        help="Must match the Charger ID above exactly."
      >
        <Code size="2">{id}</Code>
      </SettingsRow>
      <Text size="1" color="gray">
        If your charger only has one URL field, enter{" "}
        <Code size="1">{`${base}/${id}`}</Code>{" "}
        instead — some chargers append the charge point id for you, others
        expect it in the URL.
      </Text>
    </>
  );
}
