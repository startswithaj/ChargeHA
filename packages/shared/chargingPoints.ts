const PREFIX = "cp-";

// Vehicle-API charging point ids are derived from their vehicle so they
// survive deactivation and re-activation, keeping schedules attached.
export const linkedChargingPointId = (vehicleId: string): string =>
  `${PREFIX}${vehicleId}`;

export const linkedVehicleId = (chargingPointId: string): string | null =>
  chargingPointId.startsWith(PREFIX)
    ? chargingPointId.slice(PREFIX.length)
    : null;
