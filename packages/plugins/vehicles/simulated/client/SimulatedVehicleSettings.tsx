import { useState } from "react";
import { Badge, IconButton, Text } from "@radix-ui/themes";
import { FlaskConical, Pencil, X } from "lucide-react";
import type { VehicleWithState } from "@chargeha/shared";
import { trpc } from "./trpc.ts";
import { SimulatedVehicleDialog } from "./SimulatedVehicleDialog.tsx";

export interface SimulateUpdate {
  vehicleId: string;
  [key: string]: unknown;
}

// Wrapper that renders one SimulatedVehicleDialog per simulated vehicle.
export function SimulatedVehicleSettings(): JSX.Element | null {
  const vehiclesQuery = trpc.plugin.vehicle.simulated.listVehicles.useQuery(
    undefined,
    {
      select: (data: { vehicles: VehicleWithState[] }) => data.vehicles,
    },
  );
  const simulateMutation = trpc.plugin.vehicle.simulated.updateState
    .useMutation({
      onSuccess: () => vehiclesQuery.refetch(),
    });
  return (
    <SimulatedVehicleList
      title="Simulated Vehicle Settings"
      vehicles={vehiclesQuery.data ?? []}
      onSimulate={(update) => simulateMutation.mutateAsync(update)}
    />
  );
}

function SimulatedVehicleRow(
  { vehicle, expanded, onToggle, onSimulate }: {
    vehicle: VehicleWithState;
    expanded: boolean;
    onToggle: () => void;
    onSimulate: (update: SimulateUpdate) => Promise<unknown>;
  },
) {
  return (
    <div style={{ borderRadius: 6, background: "var(--gray-a2)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 10px",
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
            {vehicle.name}
          </Text>
          {vehicle.state && (
            <>
              <Badge variant="outline" size="1" color="gray">
                {vehicle.state.batteryLevel.toFixed(0)}%
              </Badge>
              <Badge
                variant="soft"
                size="1"
                color={vehicle.state.isPluggedIn ? "green" : "gray"}
              >
                {vehicle.state.isPluggedIn ? "Plugged in" : "Unplugged"}
              </Badge>
            </>
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
          <IconButton
            variant="ghost"
            size="1"
            aria-label={expanded
              ? `Close ${vehicle.name}`
              : `Edit ${vehicle.name}`}
            onClick={onToggle}
          >
            {expanded ? <X size={14} /> : <Pencil size={14} />}
          </IconButton>
        </div>
      </div>
      {expanded && (
        <SimulatedVehicleDialog
          vehicleState={vehicle.state}
          lastLocation={vehicle.lastLocation ?? null}
          onSave={async (data) => {
            try {
              await onSimulate({ vehicleId: vehicle.id, ...data });
              return null;
            } catch (e) {
              return e instanceof Error ? e.message : "Save failed";
            }
          }}
          onCancel={onToggle}
        />
      )}
    </div>
  );
}

function SimulatedVehicleList({ title, vehicles, onSimulate }: {
  title: string;
  vehicles: VehicleWithState[];
  onSimulate: (update: SimulateUpdate) => Promise<unknown>;
}): JSX.Element | null {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (vehicles.length === 0) return null;

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div
      style={{
        marginTop: 4,
        paddingTop: 12,
        borderTop: "1px solid var(--gray-a4)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <FlaskConical size={14} />
        <Text size="2" weight="bold">{title}</Text>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {vehicles.map((v) => (
          <SimulatedVehicleRow
            key={v.id}
            vehicle={v}
            expanded={expanded.has(v.id)}
            onToggle={() => toggleExpanded(v.id)}
            onSimulate={onSimulate}
          />
        ))}
      </div>
    </div>
  );
}
