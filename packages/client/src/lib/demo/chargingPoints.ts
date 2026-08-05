import { chargerCapableVehicleAdapters } from "@chargeha/plugins/demoPluginSummaries";

const PREFIX = "cp-";

export const linkedChargingPointId = (vehicleId: string): string =>
  `${PREFIX}${vehicleId}`;

export const linkedVehicleId = (chargingPointId: string): string | null =>
  chargingPointId.startsWith(PREFIX)
    ? chargingPointId.slice(PREFIX.length)
    : null;

export const CHARGER_CAPABLE_ADAPTERS: ReadonlySet<string> = new Set(
  chargerCapableVehicleAdapters,
);
