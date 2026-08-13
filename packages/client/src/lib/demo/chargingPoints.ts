import { chargerCapableVehicleAdapters } from "@chargeha/plugins/demoPluginSummaries";

export {
  linkedChargingPointId,
  linkedVehicleId,
} from "@chargeha/shared/chargingPoints";

export const CHARGER_CAPABLE_ADAPTERS: ReadonlySet<string> = new Set(
  chargerCapableVehicleAdapters,
);
