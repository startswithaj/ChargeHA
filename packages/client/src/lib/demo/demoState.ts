// The demo's in-memory "database": a mirror of the server's config key/value
// store plus the editable entity lists. Queries read from here; mutations update
// it and persist to sessionStorage (see demoPersistence.ts). The simulated time
// series is held alongside but is regenerated each session, never persisted.

import type { DayOfWeek } from "@chargeha/shared";
import type { DemoSeries } from "./series.ts";
import { loadDemoSeries } from "./demoSeriesLoader.ts";
import { OFFPEAK_RATE, PEAK_RATE } from "./demoTariff.ts";
import { loadPersisted, savePersisted } from "./demoPersistence.ts";

export type DemoVehicleMode = "auto" | "charge_now" | "stop";

export interface DemoVehicle {
  id: string;
  name: string;
  adapterType: string;
  priority: number;
  mode: DemoVehicleMode;
  batteryCapacityKwh: number;
  chargeLimitPercent: number;
  socPercent: number;
  isCharging: boolean;
  isPluggedIn: boolean;
  chargeAmps: number;
}

export interface DemoSchedule {
  id: string;
  vehicleId: string | null;
  scheduleType: string;
  startTime: string;
  endTime: string;
  days: DayOfWeek[];
  chargeAmps: number | null;
  chargeLimitPct: number | null;
  enabled: boolean;
}

export interface DemoTariff {
  id: number;
  label: string;
  startTime: string;
  endTime: string;
  days: DayOfWeek[];
  ratePerKwh: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Everything the user can change — persisted to sessionStorage. */
export interface DemoMutable {
  config: Record<string, string>;
  vehicles: DemoVehicle[];
  schedules: DemoSchedule[];
  tariffs: DemoTariff[];
  authenticated: boolean;
}

/** Full demo state — mutable slices plus the (non-persisted) simulated series. */
export interface DemoState extends DemoMutable {
  series: DemoSeries;
}

const ALL_DAYS: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const SEED_AT = "2026-01-01T00:00:00.000Z";

/** Default config — lands on the first-run wizard (no adapter, no vehicles). */
const defaultConfig = (): Record<string, string> => ({
  home_latitude: "-33.8688",
  home_longitude: "151.2093",
  timezone: "Australia/Sydney",
  currency_symbol: "$",
  currency_code: "AUD",
  charging_enabled: "true",
  solar_tracking_enabled: "true",
  solar_tracking_mode: "solar_only",
  solar_reference: "excess",
  default_rate_per_kwh: "0.30",
  auth_mode: "none",
  energy_adapter_type: "",
  wizard_completed: "",
  wizard_step: "",
  wizard_vehicle_type: "",
  wizard_energy_type: "",
});

const defaultTariffs = (): DemoTariff[] => [
  {
    id: 1,
    label: "Peak",
    startTime: "14:00",
    endTime: "20:00",
    days: ALL_DAYS,
    ratePerKwh: PEAK_RATE,
    enabled: true,
    createdAt: SEED_AT,
    updatedAt: SEED_AT,
  },
  {
    id: 2,
    label: "Off-peak",
    startTime: "20:00",
    endTime: "14:00",
    days: ALL_DAYS,
    ratePerKwh: OFFPEAK_RATE,
    enabled: true,
    createdAt: SEED_AT,
    updatedAt: SEED_AT,
  },
];

const defaultMutable = (): DemoMutable => ({
  config: defaultConfig(),
  vehicles: [],
  schedules: [],
  tariffs: defaultTariffs(),
  authenticated: false,
});

// Lazy session singleton.
// deno-lint-ignore custom-no-let/no-let
let state: DemoState | null = null;

/** Initialise demo state: build the series and hydrate persisted edits. */
export const initDemoState = async (): Promise<DemoState> => {
  if (state) return state;
  const series = await loadDemoSeries();
  const mutable = loadPersisted() ?? defaultMutable();
  state = { ...mutable, series };
  return state;
};

export const getDemoState = (): DemoState => {
  if (!state) {
    throw new Error("demoState not initialised — call initDemoState()");
  }
  return state;
};

const toMutable = (s: DemoState): DemoMutable => ({
  config: s.config,
  vehicles: s.vehicles,
  schedules: s.schedules,
  tariffs: s.tariffs,
  authenticated: s.authenticated,
});

const applyUpdate = (
  fn: (m: DemoMutable) => DemoMutable,
  persist: boolean,
): DemoState => {
  const current = getDemoState();
  const nextMutable = fn(toMutable(current));
  state = { ...nextMutable, series: current.series };
  if (persist) savePersisted(nextMutable);
  return state;
};

/** Apply a change to the mutable state, persist it, and return the new state. */
export const updateDemoState = (
  fn: (m: DemoMutable) => DemoMutable,
): DemoState => applyUpdate(fn, true);

/** Apply a change WITHOUT persisting — for the realtime tick's live controller,
 *  which updates state every few seconds and must not spam sessionStorage. */
export const updateDemoStateLive = (
  fn: (m: DemoMutable) => DemoMutable,
): DemoState => applyUpdate(fn, false);

/** Test-only: clear the singleton so the next init starts fresh. */
export const resetDemoState = (): void => {
  state = null;
};
