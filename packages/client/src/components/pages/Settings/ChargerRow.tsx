import { ArrowDownIcon, ArrowUpIcon } from "@radix-ui/react-icons";
import { Badge, IconButton, Text } from "@radix-ui/themes";
import { Pencil, Trash2, X } from "lucide-react";
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
  { charger, reorderable, editable, expanded, onEdit, onRemove, onMove }: {
    charger: ChargerWithState;
    reorderable: boolean;
    editable: boolean;
    expanded: boolean;
    onEdit: () => void;
    onRemove: () => void;
    onMove: (direction: "up" | "down") => void;
  },
) {
  const smart = isSmartCharger(charger);
  const status = charger.state?.status as ChargerStatus | undefined;
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
