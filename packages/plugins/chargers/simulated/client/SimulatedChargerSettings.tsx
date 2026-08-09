import { useState } from "react";
import { Badge, Switch, TextField } from "@radix-ui/themes";
import { SettingsRow } from "../../../hostUi.ts";
import { trpc } from "./trpc.ts";

const clampAmps = (value: string): number =>
  Math.min(48, Math.max(0, Number(value) || 0));

/** Dev controls for the simulated charger: plugged-in state and the fake
 *  car's appetite, plus a live readout of the adapter's reported state. */
export function SimulatedChargerSettings(): JSX.Element | null {
  const statusQuery = trpc.plugin.charger.simulated_charger.status.useQuery(
    undefined,
    { refetchInterval: 3000 },
  );
  const updateMutation = trpc.plugin.charger.simulated_charger.updateState
    .useMutation({
      onSuccess: () => statusQuery.refetch(),
    });

  const [carMaxAmps, setCarMaxAmps] = useState("16");

  const status = statusQuery.data?.[0];
  if (!status) return null;

  return (
    <>
      <SettingsRow label="Plugged in">
        <Switch
          size="2"
          checked={status.pluggedIn}
          onCheckedChange={(pluggedIn) => updateMutation.mutate({ pluggedIn })}
        />
      </SettingsRow>
      <SettingsRow
        label="Vehicle appetite (A)"
        help="The simulated vehicle's max draw. 0 = plugged in but not drawing."
      >
        <TextField.Root
          size="2"
          type="number"
          min="0"
          max="48"
          value={carMaxAmps}
          onChange={(e: { target: { value: string } }) =>
            setCarMaxAmps(e.target.value)}
          onBlur={() =>
            updateMutation.mutate({ carMaxAmps: clampAmps(carMaxAmps) })}
          style={{ width: 80 }}
        />
      </SettingsRow>
      <SettingsRow label="Reported state">
        <Badge size="1" variant="soft" color={status.on ? "green" : "gray"}>
          {status.on
            ? `Energized at ${status.commandedAmps}A, drawing ${status.drawAmps}A`
            : "Off"}
        </Badge>
      </SettingsRow>
    </>
  );
}
