// The realtime heartbeat. Reads today's simulated curve at the current clock
// time (interpolating between 15-min points so it drifts smoothly) and emits a
// tick on an interval — the in-browser stand-in for the websocket subscription.

import type { CumulativeEnergyData, EnergyData } from "@chargeha/shared";
import type { DemoReading } from "./series.ts";
import type { DemoState } from "./demoState.ts";
import { timeToMinutes } from "./demoDates.ts";

const GRID_VOLTAGE_V = 230;
const TICK_INTERVAL_MS = 3000;
const INTERVAL_H = 0.25; // 15-min buckets

interface SolarPoint {
  solarW: number;
  homeW: number;
  gridW: number;
}

/** Interpolate today's curve at `minute` (smooth drift between 15-min points). */
const interpolate = (readings: DemoReading[], minute: number): SolarPoint => {
  if (readings.length === 0) return { solarW: 0, homeW: 0, gridW: 0 };
  const prev =
    [...readings].reverse().find((r) => timeToMinutes(r.time) <= minute) ??
      readings[0];
  const next = readings.find((r) => timeToMinutes(r.time) > minute);
  if (!next) {
    return { solarW: prev.solarW, homeW: prev.homeW, gridW: prev.gridW };
  }

  const pm = timeToMinutes(prev.time);
  const nm = timeToMinutes(next.time);
  const frac = nm > pm ? (minute - pm) / (nm - pm) : 0;
  const lerp = (a: number, b: number): number => Math.round(a + (b - a) * frac);
  return {
    solarW: lerp(prev.solarW, next.solarW),
    homeW: lerp(prev.homeW, next.homeW),
    gridW: lerp(prev.gridW, next.gridW),
  };
};

const todayReadings = (state: DemoState): DemoReading[] =>
  state.series.days.find((d) => d.offset === 0)?.readings ?? [];

/** Today's cumulative energy totals up to `minute`. */
const cumulativeToday = (
  readings: DemoReading[],
  minute: number,
): CumulativeEnergyData => {
  const sofar = readings.filter((r) => timeToMinutes(r.time) <= minute);
  const solarWh = sofar.reduce((s, r) => s + r.solarW * INTERVAL_H, 0);
  const importWh = sofar.reduce(
    (s, r) => s + Math.max(0, r.gridW) * INTERVAL_H,
    0,
  );
  const exportWh = sofar.reduce(
    (s, r) => s + Math.max(0, -r.gridW) * INTERVAL_H,
    0,
  );
  return {
    solarProducedWh: Math.round(solarWh),
    gridImportedWh: Math.round(importWh),
    gridExportedWh: Math.round(exportWh),
    dailySolarProducedWh: Math.round(solarWh),
    dailyGridImportWh: Math.round(importWh),
    dailyGridExportWh: Math.round(exportWh),
  };
};

export interface RealtimeSnapshot {
  timestamp: string;
  realtime: EnergyData;
  cumulative: CumulativeEnergyData;
}

/** Current interpolated energy snapshot, shaped like energy.realtime. */
export const currentSnapshot = (
  state: DemoState,
  now: Date = new Date(),
): RealtimeSnapshot => {
  const readings = todayReadings(state);
  const minute = now.getHours() * 60 + now.getMinutes();
  const point = interpolate(readings, minute);
  const iso = now.toISOString();
  return {
    timestamp: iso,
    realtime: {
      solarProductionW: point.solarW,
      gridPowerW: point.gridW,
      homeConsumptionW: point.homeW,
      batteryPowerW: null,
      batterySoc: null,
      gridVoltageV: GRID_VOLTAGE_V,
      lastUpdated: iso,
    },
    cumulative: cumulativeToday(readings, minute),
  };
};

// ── Tick emitter (drives subscription.onEvents in Phase 5) ──────────────────

const emitter = new EventTarget();
// deno-lint-ignore custom-no-let/no-let
let timer: number | null = null;

/** Start emitting ticks (idempotent). */
export const startDemoTick = (): void => {
  if (timer === null) {
    timer = setInterval(
      () => emitter.dispatchEvent(new Event("tick")),
      TICK_INTERVAL_MS,
    );
  }
};

/** Subscribe to ticks; returns an unsubscribe function. */
export const onDemoTick = (cb: () => void): () => void => {
  emitter.addEventListener("tick", cb);
  return () => emitter.removeEventListener("tick", cb);
};
