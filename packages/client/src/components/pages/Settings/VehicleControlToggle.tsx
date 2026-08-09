import { Switch, Text, Tooltip } from "@radix-ui/themes";
import { trpc } from "../../../trpc.ts";
import { isSmartCharger, useChargers } from "../../../hooks/useChargers.ts";

/** Whether this car is driven by its own API or by whichever smart charger
 *  it is plugged into. Only meaningful once a smart charger exists — with no
 *  alternative controller there is nothing to switch to, so the control is
 *  hidden rather than shown disabled. */
export function VehicleControlToggle({ vehicleId }: { vehicleId: string }) {
  const { chargers } = useChargers();
  const utils = trpc.useUtils();
  const mutation = trpc.charger.setVehicleControl.useMutation({
    onSuccess: () => utils.charger.list.invalidate(),
  });

  const point = chargers.find((c) =>
    !isSmartCharger(c) && c.vehicleId === vehicleId
  );
  if (!point || !chargers.some(isSmartCharger)) return null;

  return (
    <Tooltip content="Off: the smart charger controls this vehicle. On: charge control runs through the vehicle's own API.">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Text size="1" color="gray">API control</Text>
        <Switch
          size="1"
          checked={point.active}
          disabled={mutation.isPending}
          onCheckedChange={(active) => mutation.mutate({ vehicleId, active })}
        />
      </div>
    </Tooltip>
  );
}
