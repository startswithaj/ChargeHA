import { ArrowDownIcon, ArrowUpIcon } from "@radix-ui/react-icons";
import { Badge, Button, Select, Text } from "@radix-ui/themes";
import type { ChargerStatus, ChargingPointMode } from "@chargeha/shared";
import { SettingsRow } from "./SettingsLayout.tsx";
import {
  type ChargerWithState,
  isSmartCharger,
} from "../../../hooks/useChargers.ts";

export const MODE_LABELS: Record<ChargingPointMode, string> = {
  auto: "Auto",
  charge_now: "Charge now",
  stop: "Stop",
};

export const STATUS_LABELS: Record<ChargerStatus, string> = {
  available: "Available",
  preparing: "Preparing",
  charging: "Charging",
  suspended: "Paused",
  faulted: "Fault",
  finishing: "Finishing",
  no_draw: "No draw",
};

const labelFor = (map: Record<string, string>, key: string): string =>
  map[key] ?? key;

const NO_VEHICLE = "__none__";

/** A smart charger cannot observe which car is plugged into it, so naming
 *  one here replaces guesswork with a fact. */
function LinkedVehiclePicker(
  { charger, vehicles, onLink }: {
    charger: ChargerWithState;
    vehicles: Array<{ id: string; name: string }>;
    onLink: (vehicleId: string | null) => void;
  },
) {
  if (vehicles.length === 0) return null;
  return (
    <Select.Root
      size="1"
      value={charger.vehicleId ?? NO_VEHICLE}
      onValueChange={(v) => onLink(v === NO_VEHICLE ? null : v)}
    >
      <Select.Trigger placeholder="Vehicle" />
      <Select.Content>
        <Select.Item value={NO_VEHICLE}>No vehicle</Select.Item>
        {vehicles.map((v) => (
          <Select.Item key={v.id} value={v.id}>{v.name}</Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}

export function ChargerRow(
  { charger, reorderable, vehicles, onRemove, onMove, onLink }: {
    charger: ChargerWithState;
    reorderable: boolean;
    vehicles: Array<{ id: string; name: string }>;
    onRemove: () => void;
    onMove: (direction: "up" | "down") => void;
    onLink: (vehicleId: string | null) => void;
  },
) {
  const smart = isSmartCharger(charger);
  return (
    <SettingsRow
      label={smart ? charger.name : `${charger.name} — via vehicle API`}
      help={smart
        ? undefined
        : "Charge control runs through the vehicle's own API."}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {smart && (
          <LinkedVehiclePicker
            charger={charger}
            vehicles={vehicles}
            onLink={onLink}
          />
        )}
        <Badge size="1" color="gray">
          {labelFor(MODE_LABELS, charger.mode)}
        </Badge>
        {charger.state && (
          <Badge size="1">
            {labelFor(STATUS_LABELS, charger.state.status)}
          </Badge>
        )}
        {reorderable && (
          <>
            <Text size="1" color="gray">Priority {charger.priority}</Text>
            <Button
              size="1"
              variant="ghost"
              aria-label={`Move ${charger.name} up`}
              onClick={() => onMove("up")}
            >
              <ArrowUpIcon />
            </Button>
            <Button
              size="1"
              variant="ghost"
              aria-label={`Move ${charger.name} down`}
              onClick={() => onMove("down")}
            >
              <ArrowDownIcon />
            </Button>
          </>
        )}
        {smart && (
          <Button size="1" variant="soft" color="red" onClick={onRemove}>
            Delete
          </Button>
        )}
      </div>
    </SettingsRow>
  );
}
