import { ArrowDownIcon, ArrowUpIcon } from "@radix-ui/react-icons";
import { Badge, Button, Text } from "@radix-ui/themes";
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

export function ChargerRow(
  { charger, reorderable, onRemove, onMove }: {
    charger: ChargerWithState;
    reorderable: boolean;
    onRemove: () => void;
    onMove: (direction: "up" | "down") => void;
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
