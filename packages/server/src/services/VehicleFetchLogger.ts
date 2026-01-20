import type { AppDatabase } from "../db/AppDatabase.ts";
import type { Logger } from "../lib/Logger.ts";
import type { TypedEventEmitter } from "./TypedEventEmitter.ts";

export class VehicleFetchLogger {
  constructor(
    db: AppDatabase,
    eventEmitter: TypedEventEmitter,
    logger: Logger,
  ) {
    eventEmitter.subscribe("vehicle_update", (state) => {
      db.insertVehiclePollLog({
        vehicleId: state.vehicleId,
        vehicleName: state.vehicleName,
        isOnline: state.isOnline,
        isPluggedIn: state.isPluggedIn,
        isCharging: state.isCharging,
        batteryLevel: state.batteryLevel,
        chargeLimit: state.chargeLimit,
        chargeAmps: state.chargeAmps,
        chargeAmpsMax: state.chargeAmpsMax,
        chargePowerKw: state.chargePowerKw,
        chargerVoltage: state.chargerVoltage,
        energyAddedKwh: state.energyAddedKwh,
        minutesToFull: state.minutesToFull,
        isHome: state.isHome ?? false,
      }).catch((err) => {
        logger.error(
          `Failed to write fetch log for ${state.vehicleName}:`,
          err,
        );
      });
    });
  }
}
