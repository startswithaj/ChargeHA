import { useMemo } from "react";
import type {
  EnergyData,
  VehicleChargeState,
  VehicleWithState,
} from "@chargeha/shared";
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

/**
 * Compute solar vs grid split per charging vehicle and build the
 * ChargingVehicleFlow[] list for the energy flow diagram.
 * Same formula as data-recorder.ts:140-155
 */
export function useChargingVehicleFlows(
  realtime: EnergyData | null,
  vehicles: VehicleWithState[],
): ChargingVehicleFlow[] {
  // Compute solar vs grid split per charging vehicle
  const vehicleSolarGrid = useMemo(() => {
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
      chargingVehicles.map((v) => {
        const chargePowerW = v.state.chargePowerKw * 1000;
        // Solar attribution: meter already includes EV draw in homeConsumption
        const availableSolar = Math.max(
          0,
          realtime.solarProductionW - realtime.homeConsumptionW + chargePowerW,
        );
        const vehicleShare = totalChargePowerW > 0
          ? chargePowerW / totalChargePowerW
          : 1;
        const solarW = Math.min(chargePowerW, availableSolar * vehicleShare);
        return [v.id, { solarW, gridW: chargePowerW - solarW }];
      }),
    );
  }, [realtime, vehicles]);

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
