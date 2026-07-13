import { trpc } from "../trpc.ts";
import { useRealtimeEvents } from "../hooks/useRealtimeEvents.ts";
import { vehicleErrorStore } from "../hooks/vehicleErrorStore.ts";
import { controllerStatusStore } from "../hooks/controllerStatusStore.ts";

/**
 * Renderless component that manages the single SSE subscription for all
 * real-time events (energy, vehicle, errors) and updates the tRPC cache.
 *
 * Call this once inside the authenticated area of the app.
 */
export function RealtimeSync() {
  const utils = trpc.useUtils();

  useRealtimeEvents({
    onEnergyUpdate: (data) => {
      utils.energy.realtime.setData(undefined, {
        timestamp: data.lastUpdated,
        realtime: {
          solarProductionW: data.solarProductionW,
          gridPowerW: data.gridPowerW,
          homeConsumptionW: data.homeConsumptionW,
          batteryPowerW: data.batteryPowerW,
          batterySoc: data.batterySoc,
          gridVoltageV: data.gridVoltageV,
          lastUpdated: data.lastUpdated,
          pollFailed: data.pollFailed,
          pollError: data.pollError,
        },
        cumulative: {
          solarProducedWh: data.solarProducedWh,
          gridImportedWh: data.gridImportedWh,
          gridExportedWh: data.gridExportedWh,
          dailySolarProducedWh: data.dailySolarProducedWh,
          dailyGridImportWh: data.dailyGridImportWh,
          dailyGridExportWh: data.dailyGridExportWh,
        },
      });
    },
    onVehicleUpdate: (update) => {
      utils.vehicle.list.setData(undefined, (old) => {
        if (!old) return old;
        return {
          vehicles: old.vehicles.map((v) =>
            v.id === update.vehicleId ? { ...v, state: update } : v
          ),
        };
      });
    },
    onVehicleError: (event) => {
      if (event.error === null) {
        vehicleErrorStore.clearError(event.vehicleId);
      } else {
        vehicleErrorStore.setError(event.vehicleId, event.error);
      }
    },
    onControllerStatus: (event) => {
      controllerStatusStore.update(
        event.vehicleId,
        event.action,
        event.reason,
        event.detail,
        event.targetAmps,
        event.checksJson,
      );
    },
  });

  return null;
}
