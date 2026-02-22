import { useState } from "react";
import { Badge, Button, Text } from "@radix-ui/themes";
import { Pencil } from "lucide-react";
import type { VehicleWithState } from "@chargeha/shared";
import { trpc } from "./trpc.ts";
import { SimulatedVehicleDialog } from "./SimulatedVehicleDialog.tsx";

/** Wrapper that renders one SimulatedVehicleDialog per simulated vehicle. */
export function SimulatedVehicleSettings(): JSX.Element | null {
  const vehiclesQuery = trpc.vehicle.list.useQuery(undefined, {
    select: (data: { vehicles: VehicleWithState[] }) =>
      data.vehicles.filter(
        (v) => v.adapterType === "simulated",
      ),
  });
  const simulateMutation = trpc.simulated.updateState.useMutation({
    onSuccess: () => vehiclesQuery.refetch(),
  });

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const vehicles = vehiclesQuery.data ?? [];
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
      <Text
        size="2"
        weight="medium"
        style={{ display: "block", marginBottom: 8 }}
      >
        Simulated Vehicle Settings
      </Text>
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
                    {v.state.batteryLevel}% /{" "}
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
                      await simulateMutation.mutateAsync({
                        vehicleId: v.id,
                        ...data,
                      });
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
