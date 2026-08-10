import type { QueryHandler } from "./types.ts";
import type { DemoCharger, DemoState, DemoVehicle } from "../demoState.ts";
import { currentSnapshot } from "../demoTick.ts";
import { demoNow } from "../demoClock.ts";
import {
  CHARGER_CAPABLE_ADAPTERS,
  linkedChargingPointId,
} from "../chargingPoints.ts";

const CREATED_AT = "2026-01-01T00:00:00.000Z";
const VOLTAGE = 230;

const linkedChargerState = (v: DemoVehicle, now: string) => ({
  chargerId: linkedChargingPointId(v.id),
  isCharging: v.isCharging,
  isPluggedIn: v.isPluggedIn,
  chargeAmps: v.isCharging ? v.chargeAmps : 0,
  chargeAmpsMax: 32,
  chargeAmpsMin: 5,
  chargePowerKw: v.isCharging ? (v.chargeAmps * VOLTAGE) / 1000 : 0,
  chargerVoltage: VOLTAGE,
  chargerPhases: 1,
  energyAddedKwh: 0,
  status: v.isCharging ? ("charging" as const) : ("available" as const),
  statusDetail: null,
  lastUpdated: now,
});

const MIN_AMPS = 6;

// auto follows demo solar surplus, matching what the real controller
// would command; charge_now draws at the car's max.
const simDrawAmps = (state: DemoState, c: DemoCharger): number => {
  if (c.mode === "stop") return 0;
  const carMaxAmps = c.simCarMaxAmps ?? 16;
  if (c.mode === "charge_now") return carMaxAmps;
  const snap = currentSnapshot(state, demoNow());
  const surplusW = snap.realtime.solarProductionW -
    snap.realtime.homeConsumptionW;
  const amps = Math.min(carMaxAmps, Math.floor(surplusW / VOLTAGE));
  return amps >= MIN_AMPS ? amps : 0;
};

const simChargerState = (state: DemoState, c: DemoCharger, now: string) => {
  const pluggedIn = c.simPluggedIn ?? true;
  const on = c.mode !== "stop";
  const amps = pluggedIn ? simDrawAmps(state, c) : 0;
  const drawing = amps > 0;
  return {
    chargerId: c.id,
    isCharging: drawing,
    isPluggedIn: pluggedIn,
    chargeAmps: amps,
    chargeAmpsMax: 32,
    chargeAmpsMin: MIN_AMPS,
    chargePowerKw: (amps * VOLTAGE) / 1000,
    chargerVoltage: VOLTAGE,
    chargerPhases: 1,
    energyAddedKwh: 0,
    status: statusOf(on, pluggedIn, drawing),
    statusDetail: null,
    lastUpdated: now,
  };
};

const resolutionKind = (pluggedInCount: number) => {
  if (pluggedInCount === 1) return "inferred" as const;
  return pluggedInCount > 1 ? ("ambiguous" as const) : ("none" as const);
};

const statusOf = (on: boolean, pluggedIn: boolean, drawing: boolean) => {
  if (!on) return "available" as const;
  if (!pluggedIn) return "no_draw" as const;
  return drawing ? ("charging" as const) : ("suspended" as const);
};

export const chargerHandlers: Record<string, QueryHandler> = {
  "charger.list": (_i, s) => {
    const now = new Date().toISOString();
    // One control path per car: a smart charger present means no
    // vehicle-API charging points.
    const hasSmartCharger = s.chargers.length > 0;
    if (hasSmartCharger) {
      const pluggedIn = s.vehicles.filter((v) => v.isPluggedIn);
      const inferredId = pluggedIn.length === 1 ? pluggedIn[0].id : null;
      const resolution = resolutionKind(pluggedIn.length);
      return s.chargers.map((c) => ({
        id: c.id,
        name: c.name,
        chargerAdapterType: c.chargerAdapterType,
        chargerConfig: "{}",
        mode: c.mode,
        priority: c.priority,
        vehicleId: c.vehicleId,
        kind: "smart" as const,
        active: true,
        createdAt: CREATED_AT,
        updatedAt: now,
        state: simChargerState(s, c, now),
        resolvedVehicleId: inferredId,
        vehicleResolution: resolution,
      }));
    }
    return s.vehicles
      .filter((v) => CHARGER_CAPABLE_ADAPTERS.has(v.adapterType))
      .map((v) => ({
        id: linkedChargingPointId(v.id),
        name: v.name,
        chargerAdapterType: v.adapterType,
        chargerConfig: "{}",
        mode: v.mode,
        priority: v.priority,
        vehicleId: v.id,
        kind: "vehicle_api" as const,
        active: v.apiControlActive !== false,
        createdAt: CREATED_AT,
        updatedAt: now,
        state: linkedChargerState(v, now),
        resolvedVehicleId: v.id,
        vehicleResolution: "linked" as const,
      }));
  },

  "plugin.charger.simulated_charger.status": (_i, s) =>
    s.chargers
      .filter((c) => c.chargerAdapterType === "simulated_charger")
      .map((c) => {
        const pluggedIn = c.simPluggedIn ?? true;
        const carMaxAmps = c.simCarMaxAmps ?? 16;
        // Same amps the charger state reports, so the dev panel cannot
        // disagree with the card about a solar-limited auto charge.
        const amps = simDrawAmps(s, c);
        return {
          pluggedIn,
          carMaxAmps,
          on: c.mode !== "stop",
          commandedAmps: amps,
          drawAmps: pluggedIn ? amps : 0,
        };
      }),
};
