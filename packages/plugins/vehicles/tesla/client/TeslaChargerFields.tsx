import { Select } from "@radix-ui/themes";
import { linkedChargingPointId } from "@chargeha/shared/chargingPoints";
import { SettingsRow } from "../../../hostUi.ts";
import { trpc } from "./trpc.ts";

const MIN_AMPS_OPTIONS = ["1", "2", "3", "4", "5"];

const MIN_AMPS_HELP =
  "Charging won't start below this. 5A matches the Tesla app. Cars on three " +
  "phase may accept less. This is undocumented.";

export function TeslaChargerFields(
  { vin }: { vin: string },
): JSX.Element | null {
  const chargerRowId = linkedChargingPointId(vin);
  const utils = trpc.useUtils();
  const configQuery = trpc.plugin.vehicle.tesla.charger.getConfig.useQuery({
    chargerRowId,
  });
  const setConfig = trpc.plugin.vehicle.tesla.charger.setConfig.useMutation({
    onSuccess: () =>
      utils.plugin.vehicle.tesla.charger.getConfig.invalidate({ chargerRowId }),
  });

  if (!configQuery.data) return null;

  return (
    <div style={{ marginTop: 4 }}>
      <SettingsRow label="Min amps" help={MIN_AMPS_HELP}>
        <Select.Root
          size="1"
          value={configQuery.data.teslaMinAmps}
          onValueChange={(value) =>
            setConfig.mutate({ chargerRowId, values: { teslaMinAmps: value } })}
        >
          <Select.Trigger aria-label="Min amps" />
          <Select.Content>
            {MIN_AMPS_OPTIONS.map((amps) => (
              <Select.Item key={amps} value={amps}>{amps}A</Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </SettingsRow>
    </div>
  );
}
