import { useState } from "react";
import { Badge, Button, Text } from "@radix-ui/themes";
import { FlaskConical, Pencil } from "lucide-react";
import type { VehicleWithState } from "@chargeha/shared";
import { trpc } from "./trpc.ts";
import { trpcDataOnly } from "./trpcDataOnly.ts";
import { SimulatedVehicleDialog } from "./SimulatedVehicleDialog.tsx";

export interface SimulateUpdate {
  vehicleId: string;
  [key: string]: unknown;
}

/** Wrapper that renders one SimulatedVehicleDialog per simulated vehicle. */
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

export function SimulatedDataOnlySettings(): JSX.Element | null {
  const vehiclesQuery = trpcDataOnly.plugin.vehicle.simulated_dataonly
    .listVehicles.useQuery(undefined, {
      select: (data: { vehicles: VehicleWithState[] }) => data.vehicles,
    });
  const simulateMutation = trpcDataOnly.plugin.vehicle.simulated_dataonly
    .updateState.useMutation({
      onSuccess: () => vehiclesQuery.refetch(),
    });
  return (
    <SimulatedVehicleList
      title="Simulated Vehicle (data only) Settings"
      vehicles={vehiclesQuery.data ?? []}
      onSimulate={(update) => simulateMutation.mutateAsync(update)}
    />
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
        marginTop: 8,
        paddingTop: 8,
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
        <Text size="2" weight="medium">{title}</Text>
      </div>
      {vehicles.map((v) => {
        const isExpanded = expanded.has(v.id);
        return (
          <div key={v.id}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 10px",
                borderBottom: "1px solid var(--gray-a3)",
                borderRadius: 6,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Text size="2" weight="bold">{v.name}</Text>
                {v.state && (
                  <Badge size="1" variant="soft" color="gray">
                    {v.state.batteryLevel.toFixed(2)}% /{" "}
                    {v.state.isPluggedIn ? "Plugged in" : "Unplugged"}
                  </Badge>
                )}
              </div>
              <Button
                variant="soft"
                size="1"
                onClick={() => toggleExpanded(v.id)}
              >
                <Pencil size={12} />
                {isExpanded ? "Close" : "Edit"}
              </Button>
            </div>
            {isExpanded && (
              <div style={{ marginTop: 4 }}>
                <SimulatedVehicleDialog
                  vehicleState={v.state}
                  lastLocation={v.lastLocation ?? null}
                  onSave={async (data) => {
                    try {
                      await onSimulate({ vehicleId: v.id, ...data });
                      return null;
                    } catch (e) {
                      return e instanceof Error ? e.message : "Save failed";
                    }
                  }}
                  onCancel={() => toggleExpanded(v.id)}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
