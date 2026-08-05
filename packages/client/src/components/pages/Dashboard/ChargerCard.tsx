import { Badge, Button, Card, Text } from "@radix-ui/themes";
import { Zap } from "lucide-react";
import type { ChargerState, ChargingPointMode } from "@chargeha/shared";
import { useChargerCommands } from "../../../hooks/useChargers.ts";

const STATUS_LABELS: Record<ChargerState["status"], string> = {
  available: "Available",
  preparing: "Preparing",
  charging: "Charging",
  suspended: "Suspended",
  faulted: "Faulted",
  finishing: "Finishing",
  no_draw: "No draw",
};

const MODES: ChargingPointMode[] = ["stop", "auto", "charge_now"];
const MODE_LABELS: Record<ChargingPointMode, string> = {
  stop: "STOP",
  auto: "AUTO",
  charge_now: "CHARGE NOW",
};

export function NoDrawNotice(
  { statusDetail }: { statusDetail: string | null },
) {
  return (
    <Text size="2" color="gray">
      No draw — vehicle may be absent, finished, or paused
      {statusDetail ? ` (${statusDetail})` : ""}
    </Text>
  );
}

export function ChargerCard(
  { id, name, mode, state, solarW, gridW, controllerDetail }: {
    id: string;
    name: string;
    mode: ChargingPointMode;
    state: ChargerState | null;
    solarW: number;
    gridW: number;
    controllerDetail: string | null;
  },
) {
  const { commandPending, changeMode } = useChargerCommands(id);
  const faulted = state?.status === "faulted";

  return (
    <Card
      style={{
        borderLeft: `3px solid var(${
          faulted ? "--red-a7" : "--color-charging"
        })`,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Zap size={18} style={{ color: "var(--color-charging)" }} />
          <Text size="2" weight="bold" style={{ flex: 1 }}>{name}</Text>
          {state && (
            <Badge size="1" color={faulted ? "red" : "gray"}>
              {STATUS_LABELS[state.status]}
            </Badge>
          )}
          {!state && <Badge size="1" color="gray">Waiting for data</Badge>}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          {MODES.map((m) => (
            <Button
              key={m}
              size="1"
              variant={m === mode ? "solid" : "soft"}
              disabled={commandPending !== false}
              onClick={() => changeMode(m)}
            >
              {MODE_LABELS[m]}
            </Button>
          ))}
        </div>

        {state?.isCharging === true && (
          <Text size="2">
            Charging at {state.chargeAmps ?? 0}A ·{" "}
            {(state.chargePowerKw ?? 0).toFixed(1)} kW
            {solarW + gridW > 0 &&
              ` (solar ${(solarW / 1000).toFixed(1)} kW / grid ${
                (gridW / 1000).toFixed(1)
              } kW)`}
          </Text>
        )}
        {state && state.energyAddedKwh > 0 && (
          <Text size="1" color="gray">
            {state.energyAddedKwh.toFixed(1)} kWh added this session
          </Text>
        )}

        {controllerDetail && (
          <Text size="1" color="gray">{controllerDetail}</Text>
        )}
        {state?.status === "no_draw" && (
          <NoDrawNotice statusDetail={state.statusDetail} />
        )}
        {state && state.status !== "no_draw" && state.statusDetail && (
          <Text size="1" color="gray">{state.statusDetail}</Text>
        )}
      </div>
    </Card>
  );
}
