import { ArrowDownIcon, ArrowUpIcon } from "@radix-ui/react-icons";
import { Badge, Button, Text } from "@radix-ui/themes";
import { Pencil, Trash2 } from "lucide-react";
import type { ChargerStatus, ChargingPointMode } from "@chargeha/shared";
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

const STATUS_COLORS: Record<ChargerStatus, "green" | "red" | "gray" | "amber"> =
  {
    available: "gray",
    preparing: "amber",
    charging: "green",
    suspended: "amber",
    faulted: "red",
    finishing: "green",
    no_draw: "gray",
  };

const labelFor = (map: Record<string, string>, key: string): string =>
  map[key] ?? key;

export function ChargerRow(
  { charger, reorderable, editable, onEdit, onRemove, onMove }: {
    charger: ChargerWithState;
    reorderable: boolean;
    editable: boolean;
    onEdit: () => void;
    onRemove: () => void;
    onMove: (direction: "up" | "down") => void;
  },
) {
  const smart = isSmartCharger(charger);
  const status = charger.state?.status;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "10px 12px",
        borderBottom: "1px solid var(--gray-a3)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div>
          <Text size="2" weight="bold">{charger.name}</Text>
          <Text size="1" color="gray" style={{ display: "block" }}>
            {smart ? charger.chargerAdapterType : "via vehicle API"}
            {!charger.active && " — inactive"}
          </Text>
        </div>
        {status && (
          <Badge size="1" color={STATUS_COLORS[status as ChargerStatus]}>
            {labelFor(STATUS_LABELS, status)}
          </Badge>
        )}
        <Badge size="1" variant="outline" color="gray">
          {labelFor(MODE_LABELS, charger.mode)}
        </Badge>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
        {editable && (
          <Button size="1" variant="soft" onClick={onEdit}>
            <Pencil size={13} />
            Edit
          </Button>
        )}
        {smart && (
          <Button
            size="1"
            variant="ghost"
            color="red"
            aria-label={`Delete ${charger.name}`}
            onClick={onRemove}
          >
            <Trash2 size={14} />
          </Button>
        )}
      </div>
    </div>
  );
}
