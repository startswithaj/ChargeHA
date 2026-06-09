// Builds the demo time series IN THE BROWSER by running the real simulation
// (~250ms for 90 days). Replaces the old build-time generator + committed file:
// data is always fresh and relative to today, with nothing shipped.

import {
  DEFAULT_SOLAR_CONFIG,
  runSimulation,
} from "@chargeha/shared/simulation";
import type { SimulationOptions } from "@chargeha/shared/simulation";
import type {
  DemoChargeEntry,
  DemoDay,
  DemoReading,
  DemoSeries,
} from "./series.ts";
import { minuteOfDay, timeToMinutes } from "./demoDates.ts";
import { hash01 } from "./hash.ts";

const DEMO_DAYS = 90;
const BUCKET_MINUTES = 15;

export const DEMO_VEHICLES = [
  {
    id: "SIM-DEMO-001",
    name: "Model 3 SR+",
    capacityKwh: 60,
    start: 55,
    limit: 80,
    priority: 1,
  },
  {
    id: "SIM-DEMO-002",
    name: "Model Y LR",
    capacityKwh: 75,
    start: 45,
    limit: 90,
    priority: 2,
  },
] as const;

const pad = (n: number): string => String(n).padStart(2, "0");

const timeOfDay = (minute: number): string =>
  `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;

interface DayProfile {
  seed: number;
  cloudiness: number;
  storms: number;
  homeLoad: number;
  ev1Start: number;
  ev2Start: number;
  away: boolean[];
}

// Deterministic per-(offset, salt) value in [0,1) for reproducible day variation.
const rand = (offset: number, salt: number): number =>
  hash01(offset * 131 + salt);

/**
 * Per-day weather + vehicle presence so no two days look alike: clear days,
 * overcast days, the occasional storm, and days a car is away (no charging).
 */
const dayProfile = (offset: number): DayProfile => {
  const stormy = rand(offset, 2) < 0.12;
  return {
    seed: 1000 + offset,
    cloudiness: Math.round(10 + rand(offset, 1) * 75),
    storms: stormy ? 1 + Math.floor(rand(offset, 3) * 2) : 0,
    homeLoad: Math.round(
      DEFAULT_SOLAR_CONFIG.homeBaseW * (0.85 + rand(offset, 4) * 0.5),
    ),
    // Vary the daily start SoC so charging amount differs day-to-day: a nearly
    // full car barely charges, a low one pulls from grid when solar is short.
    ev1Start: Math.round(35 + rand(offset, 5) * 55),
    ev2Start: Math.round(30 + rand(offset, 6) * 60),
    away: DEMO_VEHICLES.map((_, i) => rand(offset, 10 + i) < 0.18),
  };
};

const simOptions = (profile: DayProfile): SimulationOptions => ({
  seed: profile.seed,
  vehicleCount: 2,
  waterfall: false,
  minGenKw: "1",
  graceMin: "6",
  cooldownMin: "15",
  peakSolarKw: DEFAULT_SOLAR_CONFIG.peakKw,
  minExcessKw: "",
  cloudiness: profile.cloudiness,
  storms: profile.storms,
  homeLoad: profile.homeLoad,
  sunrise: DEFAULT_SOLAR_CONFIG.sunrise,
  sunset: DEFAULT_SOLAR_CONFIG.sunset,
  ev1Start: profile.ev1Start,
  ev2Start: profile.ev2Start,
  ev1CapacityKwh: DEMO_VEHICLES[0].capacityKwh,
  ev2CapacityKwh: DEMO_VEHICLES[1].capacityKwh,
});

interface ChargingVehicle {
  vehicleId: string;
  w: number;
  amps: number;
  soc: number;
}

/** Split available solar excess across charging vehicles, in priority order. */
const allocateSolar = (
  charging: ChargingVehicle[],
  excessW: number,
): DemoChargeEntry[] =>
  charging.reduce(
    (acc, v) => {
      const solarC = Math.min(v.w, acc.remaining);
      return {
        remaining: acc.remaining - solarC,
        rows: [
          ...acc.rows,
          {
            vehicleId: v.vehicleId,
            w: v.w,
            amps: v.amps,
            soc: v.soc,
            solarC: Math.round(solarC),
            gridC: Math.round(v.w - solarC),
          },
        ],
      };
    },
    { remaining: excessW, rows: [] as DemoChargeEntry[] },
  ).rows;

const buildDay = (offset: number): DemoDay => {
  const profile = dayProfile(offset);
  const out = runSimulation(simOptions(profile));
  const buckets = out.results.filter((r) => r.minute % BUCKET_MINUTES === 0);

  const readings = buckets.map((r): DemoReading => {
    const charging = r.vehicles
      .map((v, i) => ({
        vehicleId: DEMO_VEHICLES[i].id,
        w: v.isCharging ? Math.round(v.chargePowerW) : 0,
        amps: v.chargeAmps,
        soc: Math.round(v.batteryLevel),
        // A car that's away that day contributes no charging load.
        isCharging: v.isCharging && v.chargePowerW > 0 && !profile.away[i],
      }))
      .filter((v) => v.isCharging);

    const totalChargeW = charging.reduce((s, v) => s + v.w, 0);
    return {
      time: timeOfDay(r.minute),
      solarW: r.solarW,
      homeW: r.homeW + totalChargeW,
      gridW: r.gridW + totalChargeW,
      charge: allocateSolar(charging, Math.max(0, -r.gridW)),
    };
  });

  const logs = out.events
    .filter((e) => !profile.away[e.vehicleId === "SIM_V1" ? 0 : 1])
    .map((e) => {
      const idx = e.vehicleId === "SIM_V1" ? 0 : 1;
      return {
        time: timeOfDay(e.minute),
        vehicleId: DEMO_VEHICLES[idx].id,
        vehicleName: DEMO_VEHICLES[idx].name,
        action: e.action,
        detail: e.detail,
        amps: e.targetAmps,
        checksJson: e.checksJson,
      };
    });

  return { offset, readings, logs };
};

/**
 * Build the full demo series. Today (offset 0) is truncated to the current
 * time-of-day so it reads as a day in progress rather than a finished day.
 */
export const buildDemoSeries = (now: Date = new Date()): DemoSeries => {
  const nowMinutes = minuteOfDay(now);
  const days = Array.from({ length: DEMO_DAYS }, (_, offset) => {
    const day = buildDay(offset);
    if (offset > 0) return day;
    return {
      ...day,
      readings: day.readings.filter((r) => timeToMinutes(r.time) <= nowMinutes),
      logs: day.logs.filter((l) => timeToMinutes(l.time) <= nowMinutes),
    };
  });

  return {
    bucketMinutes: BUCKET_MINUTES,
    vehicles: DEMO_VEHICLES.map((v) => ({
      id: v.id,
      name: v.name,
      capacityKwh: v.capacityKwh,
      chargeLimitPercent: v.limit,
      priority: v.priority,
    })),
    days,
  };
};
