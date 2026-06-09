// The realtime heartbeat. Reads today's simulated curve at the current clock
// time, layers the live charging controller on top, and emits a tick on an
// interval — the in-browser stand-in for the websocket subscription.

import type { CumulativeEnergyData, EnergyData } from "@chargeha/shared";
import { generateSolarDay } from "@chargeha/shared/simulation";
import type { SolarConfig } from "@chargeha/shared/simulation";
import { deserializeSection } from "@chargeha/shared/configSections";
import { simulatedEnergyConfigDef } from "../../../../plugins/energy/simulated/server/config.ts";
import type { DemoReading } from "./series.ts";
import type { DemoSchedule, DemoState, DemoVehicle } from "./demoState.ts";
import { getDemoState, updateDemoStateLive } from "./demoState.ts";
import { minuteOfDay, timeToMinutes } from "./demoDates.ts";
import { hash01 } from "./hash.ts";
import { isActiveNow } from "./handlers/schedule.ts";

const TICK_INTERVAL_MS = 3000;
const INTERVAL_H = 0.25; // 15-min buckets
const GRID_VOLTAGE_V = 230;
const MIN_AMPS = 5;
const MAX_AMPS = 32;
const TICK_HOURS = TICK_INTERVAL_MS / 3_600_000;

const todayReadings = (state: DemoState): DemoReading[] =>
  state.series.days.find((d) => d.offset === 0)?.readings ?? [];

interface BasePoint {
  solarW: number;
  baseHomeW: number;
}

// The live energy is simulated from the editable simulated-energy settings via
// the real solar model. Memoise the generated day per config so we only rebuild
// the curve when the settings actually change.
type SolarMinute = ReturnType<typeof generateSolarDay>[number];
const solarDayCache = new Map<string, SolarMinute[]>();
const solarDayFor = (config: SolarConfig): SolarMinute[] => {
  const key = JSON.stringify(config);
  const cached = solarDayCache.get(key);
  if (cached) return cached;
  const day = generateSolarDay(config);
  solarDayCache.set(key, day);
  return day;
};

/** The simulated-energy config from demo state (drives the live solar model).
 *  Section values deserialize as strings, so coerce to the numeric SolarConfig. */
const solarConfigOf = (state: DemoState): SolarConfig => {
  const c = deserializeSection(simulatedEnergyConfigDef, state.config);
  return {
    seed: Number(c.seed),
    peakKw: Number(c.peakKw),
    cloudiness: Number(c.cloudiness),
    storms: Number(c.storms),
    homeBaseW: Number(c.homeBaseW),
    sunrise: Number(c.sunrise),
    sunset: Number(c.sunset),
  };
};

// Per-second sensor-style noise so live readings visibly fluctuate each tick
// (real solar/home meters jitter between polls). Stable within a second.
const noise = (now: Date, amp: number, salt: number): number =>
  (hash01(Math.floor(now.getTime() / 1000) + salt) - 0.5) * 2 * amp;

/** Live solar + base household load simulated from the simulated-energy config,
 *  with small per-second sensor jitter. Editing the settings changes this. */
const liveBasePoint = (state: DemoState, now: Date): BasePoint => {
  const day = solarDayFor(solarConfigOf(state));
  const idx = Math.min(
    day.length - 1,
    Math.max(0, Math.floor(minuteOfDay(now))),
  );
  const point = day[idx];
  return {
    solarW: Math.max(
      0,
      Math.round((point?.solarW ?? 0) * (1 + noise(now, 0.04, 1))),
    ),
    baseHomeW: Math.max(
      0,
      Math.round((point?.homeW ?? 0) * (1 + noise(now, 0.08, 2))),
    ),
  };
};

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

interface ChargeResult {
  vehicles: DemoVehicle[];
  totalW: number;
}

const clampAmps = (amps: number): number =>
  amps >= MIN_AMPS ? Math.min(Math.floor(amps), MAX_AMPS) : 0;

interface Decision {
  isCharging: boolean;
  amps: number;
  drawW: number;
}

/** Decide one vehicle's draw given an active charge schedule (if any), whether a
 *  blockout is active, and the solar excess still available. */
const charge = (amps: number): Decision =>
  amps > 0
    ? { isCharging: true, amps, drawW: amps * GRID_VOLTAGE_V }
    : { isCharging: false, amps: 0, drawW: 0 };

const decideCharge = (
  v: DemoVehicle,
  schedule: DemoSchedule | undefined,
  blocked: boolean,
  remainingExcessW: number,
): Decision => {
  const idle: Decision = { isCharging: false, amps: 0, drawW: 0 };
  if (v.mode === "stop") return idle;
  if (!v.isPluggedIn || v.socPercent >= v.chargeLimitPercent) return idle;

  // Manual "charge now" forces full charging, drawing grid if solar's short.
  if (v.mode === "charge_now") return charge(MAX_AMPS);

  // Auto mode: a blockout suppresses; an active charge window forces; else solar.
  if (blocked) return idle;
  if (schedule) return charge(clampAmps(schedule.chargeAmps ?? MAX_AMPS));
  return charge(clampAmps(remainingExcessW / GRID_VOLTAGE_V));
};

/** Decide every vehicle's charging for this instant, honouring schedules (active
 *  blockout suppresses; an active charge window forces charging) and otherwise
 *  sharing solar excess by priority. Pure — does not advance SoC. */
const chargeVehicles = (
  vehicles: DemoVehicle[],
  excessW: number,
  schedules: DemoSchedule[],
  now: Date,
): ChargeResult => {
  const blocked = schedules.some((s) =>
    s.scheduleType === "blockout" && isActiveNow(s, now)
  );
  const chargeWindow = (id: string): DemoSchedule | undefined =>
    schedules.find((s) =>
      s.scheduleType === "charge" && s.vehicleId === id && isActiveNow(s, now)
    );

  const byPriority = [...vehicles].sort((a, b) => a.priority - b.priority);
  const out = byPriority.reduce(
    (acc, v) => {
      const d = decideCharge(v, chargeWindow(v.id), blocked, acc.remaining);
      return {
        remaining: Math.max(0, acc.remaining - d.drawW),
        total: acc.total + d.drawW,
        rows: [...acc.rows, {
          ...v,
          isCharging: d.isCharging,
          chargeAmps: d.amps,
        }],
      };
    },
    { remaining: excessW, total: 0, rows: [] as DemoVehicle[] },
  );
  const byId = new Map(out.rows.map((v) => [v.id, v]));
  return {
    vehicles: vehicles.map((v) => byId.get(v.id) ?? v),
    totalW: out.total,
  };
};

/** Current energy snapshot: base household load + the live car(s) on top, so
 *  solar / home / grid and the per-car split all reconcile. Pure (no SoC change). */
export const currentSnapshot = (
  state: DemoState,
  now: Date = new Date(),
): RealtimeSnapshot => {
  const readings = todayReadings(state);
  const minute = minuteOfDay(now);
  const { solarW, baseHomeW } = liveBasePoint(state, now);
  const { totalW: carW } = chargeVehicles(
    state.vehicles,
    Math.max(0, solarW - baseHomeW),
    state.schedules,
    now,
  );
  const homeW = baseHomeW + carW;
  const iso = now.toISOString();
  return {
    timestamp: iso,
    realtime: {
      solarProductionW: solarW,
      gridPowerW: Math.round(homeW - solarW), // >0 import, <0 export
      homeConsumptionW: homeW,
      batteryPowerW: null,
      batterySoc: null,
      gridVoltageV: GRID_VOLTAGE_V,
      lastUpdated: iso,
    },
    cumulative: cumulativeToday(readings, minute),
  };
};

// ── Live charging controller ────────────────────────────────────────────────
// Each tick, plugged-in vehicles charge from current solar excess and slowly
// fill — so the dashboard car visibly charges when the sun is out and idles
// otherwise. In-memory only (updateDemoStateLive — never persisted).

/** Add one tick's worth of charge to a vehicle's SoC (capped at its limit). */
const advanceSoc = (v: DemoVehicle): DemoVehicle => {
  if (!v.isCharging) return v;
  const deltaPct = (v.chargeAmps * GRID_VOLTAGE_V * TICK_HOURS) /
    (v.batteryCapacityKwh * 1000) * 100;
  return {
    ...v,
    socPercent: Math.min(v.chargeLimitPercent, v.socPercent + deltaPct),
  };
};

/** Advance live charging one tick: set amps from current solar excess and
 *  accumulate SoC. Returns the updated vehicles. */
export const runLiveController = (now: Date = new Date()): DemoVehicle[] => {
  const state = getDemoState();
  const { solarW, baseHomeW } = liveBasePoint(state, now);
  const { vehicles } = chargeVehicles(
    state.vehicles,
    Math.max(0, solarW - baseHomeW),
    state.schedules,
    now,
  );
  const advanced = vehicles.map(advanceSoc);
  updateDemoStateLive((m) => ({ ...m, vehicles: advanced }));
  return advanced;
};

// ── Tick emitter (drives subscription.onEvents) ─────────────────────────────

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
