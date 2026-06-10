import { useMemo } from "react";
import type {
  EnergyData,
  VehicleChargeState,
  VehicleWithState,
} from "@chargeha/shared";
import { calculateSolarAttribution } from "@chargeha/shared/solarAttribution";
import type { ChargingVehicleFlow } from "../../EnergyFlowDiagram/EnergyFlowDiagram.tsx";

/** Format minutes until a future time as a human-readable string (e.g., "2h 15m", "45m"). */
export function formatTimeUntil(isoString: string): string {
  const diffMs = new Date(isoString).getTime() - Date.now();
  const diffMin = Math.max(0, Math.round(diffMs / 60_000));
  if (diffMin < 60) return `${diffMin}m`;
  const hours = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/** Per-vehicle { solarW, gridW } map for currently-charging vehicles. */
export function useVehicleSolarGrid(
  realtime: EnergyData | null,
  vehicles: VehicleWithState[],
): Record<string, { solarW: number; gridW: number }> {
  return useMemo(() => {
    if (!realtime) return {};

    const chargingVehicles = vehicles.filter(
      (v): v is VehicleWithState & { state: VehicleChargeState } =>
        !!v.state?.isCharging && v.state.chargePowerKw > 0,
    );
    const totalChargePowerW = chargingVehicles.reduce(
      (sum, v) => sum + (v.state.chargePowerKw * 1000),
      0,
    );

    return Object.fromEntries(
      chargingVehicles.map((v) => [
        v.id,
        calculateSolarAttribution(
          v.state.chargePowerKw * 1000,
          totalChargePowerW,
          realtime.solarProductionW,
          realtime.homeConsumptionW,
        ),
      ]),
    );
  }, [realtime, vehicles]);
}

/**
 * Compute solar vs grid split per charging vehicle and build the
 * ChargingVehicleFlow[] list for the energy flow diagram.
 */
export function useChargingVehicleFlows(
  realtime: EnergyData | null,
  vehicles: VehicleWithState[],
): ChargingVehicleFlow[] {
  const vehicleSolarGrid = useVehicleSolarGrid(realtime, vehicles);

  // Build charging vehicles list for the energy flow diagram
  return useMemo(() => {
    return vehicles
      .filter(
        (v): v is VehicleWithState & { state: VehicleChargeState } =>
          !!v.state?.isCharging && v.state.chargePowerKw > 0,
      )
      .map((v) => ({
        id: v.id,
        name: v.name || v.state.vehicleName,
        chargePowerW: v.state.chargePowerKw * 1000,
        solarW: vehicleSolarGrid[v.id]?.solarW ?? 0,
        gridW: vehicleSolarGrid[v.id]?.gridW ?? 0,
      }));
  }, [vehicles, vehicleSolarGrid]);
}
