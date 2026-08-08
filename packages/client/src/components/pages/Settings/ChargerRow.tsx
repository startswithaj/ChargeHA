import { ArrowDownIcon, ArrowUpIcon } from "@radix-ui/react-icons";
import { Badge, IconButton, Select, Text } from "@radix-ui/themes";
import { Pencil, Trash2, X } from "lucide-react";
import type { ChargerStatus, ChargingPointMode } from "@chargeha/shared";
import {
  type ChargerWithState,
  isSmartCharger,
} from "../../../hooks/useChargers.ts";

// The dropdown's "Automatic" option means "clear the assignment" — Radix
// Select can't carry `null` as a value, so it gets its own string sentinel
// translated back to null at the call site. Never stored or sent as "".
const AUTOMATIC = "__automatic__";

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
  unconfigured: "Setup needed",
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
    unconfigured: "red",
  };

const labelFor = (map: Record<string, string>, key: string): string =>
  map[key] ?? key;

function VehicleAssignSelect(
  { chargerName, vehicleId, vehicles, onAssign }: {
    chargerName: string;
    vehicleId: string | null;
    vehicles: { id: string; name: string }[];
    onAssign: (vehicleId: string | null) => void;
  },
) {
  return (
    <Select.Root
      size="1"
      value={vehicleId ?? AUTOMATIC}
      onValueChange={(value) => onAssign(value === AUTOMATIC ? null : value)}
    >
      <Select.Trigger aria-label={`Vehicle for ${chargerName}`} />
      <Select.Content>
        <Select.Item value={AUTOMATIC}>Automatic</Select.Item>
        {vehicles.map((v) => (
          <Select.Item key={v.id} value={v.id}>{v.name}</Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}

export function ChargerRow(
  {
    charger,
    vehicles,
    reorderable,
    editable,
    expanded,
    onEdit,
    onRemove,
    onMove,
    onAssignVehicle,
  }: {
    charger: ChargerWithState;
    vehicles: { id: string; name: string }[];
    reorderable: boolean;
    editable: boolean;
    expanded: boolean;
    onEdit: () => void;
    onRemove: () => void;
    onMove: (direction: "up" | "down") => void;
    onAssignVehicle: (vehicleId: string | null) => void;
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
        padding: "8px 10px",
        opacity: charger.active ? 1 : 0.5,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flex: 1,
          flexWrap: "wrap",
        }}
      >
        <Text size="2" weight="bold" style={{ minWidth: 120 }}>
          {charger.name}
        </Text>
        <Badge variant="outline" size="1" color="gray">
          {smart ? charger.chargerAdapterType : "via vehicle API"}
        </Badge>
        {status && (
          <Badge variant="soft" size="1" color={STATUS_COLORS[status]}>
            {labelFor(STATUS_LABELS, status)}
          </Badge>
        )}
        <Badge variant="outline" size="1">
          {labelFor(MODE_LABELS, charger.mode)}
        </Badge>
        {reorderable && (
          <Text size="1" color="gray">Priority {charger.priority}</Text>
        )}
        {smart && (
          <VehicleAssignSelect
            chargerName={charger.name}
            vehicleId={charger.vehicleId}
            vehicles={vehicles}
            onAssign={onAssignVehicle}
          />
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
        }}
      >
        {reorderable && (
          <>
            <IconButton
              variant="ghost"
              size="1"
              aria-label={`Move ${charger.name} up`}
              onClick={() => onMove("up")}
            >
              <ArrowUpIcon />
            </IconButton>
            <IconButton
              variant="ghost"
              size="1"
              aria-label={`Move ${charger.name} down`}
              onClick={() => onMove("down")}
            >
              <ArrowDownIcon />
            </IconButton>
          </>
        )}
        {editable && (
          <IconButton
            variant="ghost"
            size="1"
            aria-label={expanded
              ? `Close ${charger.name}`
              : `Edit ${charger.name}`}
            onClick={onEdit}
          >
            {expanded ? <X size={14} /> : <Pencil size={14} />}
          </IconButton>
        )}
        {smart && (
          <IconButton
            variant="ghost"
            color="red"
            size="1"
            aria-label={`Delete ${charger.name}`}
            onClick={onRemove}
          >
            <Trash2 size={14} />
          </IconButton>
        )}
      </div>
    </div>
  );
}
