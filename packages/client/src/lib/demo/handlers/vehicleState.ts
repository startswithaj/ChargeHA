import { chargePowerKilowatts } from "@chargeha/shared/chargePower";
import type { DemoVehicle } from "../demoState.ts";
import { DEMO_PHASES, DEMO_VOLTAGE } from "../demoState.ts";

export const SYDNEY = { latitude: -33.8688, longitude: 151.2093 };

/** Build the live charge-state object (VehicleState) from a demo vehicle. */
export const buildVehicleState = (v: DemoVehicle, now: string) => ({
  vehicleId: v.id,
  batteryLevel: v.socPercent,
  chargeLimit: v.chargeLimitPercent,
  isCharging: v.isCharging,
  isPluggedIn: v.isPluggedIn,
  isOnline: true,
  chargeAmps: v.isCharging ? v.chargeAmps : 0,
  chargeAmpsMax: 32,
  chargeAmpsMin: 5,
  chargePowerKw: v.isCharging
    ? chargePowerKilowatts(v.chargeAmps, DEMO_VOLTAGE, DEMO_PHASES)
    : 0,
  chargerVoltage: DEMO_VOLTAGE,
  chargerPhases: DEMO_PHASES,
  energyAddedKwh: 0,
  minutesToFull: 0,
  chargePortOpen: v.isPluggedIn,
  vehicleName: v.name,
  lastUpdated: now,
  latitude: SYDNEY.latitude,
  longitude: SYDNEY.longitude,
  isHome: true,
});
