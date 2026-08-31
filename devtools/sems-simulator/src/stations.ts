import { REGION, state } from "./config.ts";

/** SEMS reports power as a string with a unit suffix, e.g. "1234(W)". */
const watts = (value: number): string => `${Math.round(value)}(W)`;

export interface InverterProfile {
  sn: string;
  name: string;
  modelType: string;
  /** Nameplate AC output, watts. */
  capacityW: number;
}

export interface StationProfile {
  id: string;
  name: string;
  hasPowerflow: boolean;
  /** HomeKit serial. Absent when no HomeKit is fitted. */
  homeKitSn: string | null;
  inverters: InverterProfile[];
  battery: { capacityWh: number; maxChargeW: number } | null;
  /** Baseline household draw, watts. */
  baseLoadW: number;
  totalPowerKwh: number;
}

export const STATIONS: readonly StationProfile[] = [
  {
    // The hardware this plugin is actually being written against.
    id: "11111111-1111-4111-8111-111111111111",
    name: "Fake 3-Phase Home",
    hasPowerflow: true,
    homeKitSn: "HK1000FAKE0001",
    inverters: [{
      sn: "9010KETU000FAKE1",
      name: "Roof Array",
      modelType: "GW10KAU-DT",
      capacityW: 10_000,
    }],
    battery: null,
    baseLoadW: 600,
    totalPowerKwh: 18_432.7,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Fake Hybrid + Battery",
    hasPowerflow: true,
    homeKitSn: "HK1000FAKE0002",
    inverters: [{
      sn: "9008ETU000FAKE2",
      name: "Hybrid Inverter",
      modelType: "GW8K-ET",
      capacityW: 8_000,
    }],
    battery: { capacityWh: 13_500, maxChargeW: 5_000 },
    baseLoadW: 750,
    totalPowerKwh: 9_876.4,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Fake Multi-Inverter Farm",
    hasPowerflow: true,
    homeKitSn: "HK1000FAKE0003",
    inverters: [
      {
        sn: "9020KETU00FAKE3A",
        name: "North Array",
        modelType: "GW20KAU-DT",
        capacityW: 20_000,
      },
      {
        sn: "9020KETU00FAKE3B",
        name: "South Array",
        modelType: "GW20KAU-DT",
        capacityW: 20_000,
      },
      {
        sn: "9015KETU00FAKE3C",
        name: "Shed Array",
        modelType: "GW15KAU-DT",
        capacityW: 15_000,
      },
    ],
    battery: null,
    baseLoadW: 2_400,
    totalPowerKwh: 154_002.1,
  },
  {
    // No HomeKit fitted, so SEMS reports no powerflow block at all.
    id: "44444444-4444-4444-8444-444444444444",
    name: "Fake Station Without HomeKit",
    hasPowerflow: false,
    homeKitSn: null,
    inverters: [{
      sn: "9005KETU000FAKE4",
      name: "Inverter Only",
      modelType: "GW5000-NS",
      capacityW: 5_000,
    }],
    battery: null,
    baseLoadW: 400,
    totalPowerKwh: 3_210.9,
  },
];

export const findStation = (id: string): StationProfile | undefined =>
  STATIONS.find((station) => station.id === id);

const currentHour = (): number => {
  if (state.hourOverride !== null) return state.hourOverride;
  const now = new Date();
  return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
};

/** Half-sine daylight curve, 06:00-18:00, peaking at solar noon. Scaled a
 *  little by the minute so consecutive polls never return identical values. */
const solarFraction = (hour: number): number => {
  if (hour <= 6 || hour >= 18) return 0;
  const shaped = Math.sin(((hour - 6) / 12) * Math.PI);
  const cloud = 0.9 + 0.1 * Math.sin(hour * 11);
  return Math.max(0, shaped ** 1.3 * cloud);
};

/** Household draw: a flat baseline with morning and evening peaks. */
const loadWatts = (profile: StationProfile, hour: number): number => {
  const morning = 1.6 * Math.exp(-(((hour - 7.5) / 1.2) ** 2));
  const evening = 2.4 * Math.exp(-(((hour - 18.5) / 1.5) ** 2));
  return profile.baseLoadW * (1 + morning + evening);
};

/** Battery behaviour: soak up surplus during the day, discharge after dark. */
const batteryFlow = (
  profile: StationProfile,
  surplus: number,
  hour: number,
): { power: number; status: number; soc: number } => {
  if (!profile.battery) return { power: 0, status: 0, soc: 0 };
  // SOC tracks the day: climbs while charging, falls overnight.
  const soc = Math.round(
    Math.min(
      100,
      Math.max(
        10,
        20 + 80 * solarFraction(hour) + (hour > 18 ? -10 * (hour - 18) : 0),
      ),
    ),
  );
  if (surplus > 100 && soc < 100) {
    return {
      power: Math.min(surplus, profile.battery.maxChargeW),
      status: 1,
      soc,
    };
  }
  if (surplus < -100 && soc > 10) {
    return {
      power: Math.min(-surplus, profile.battery.maxChargeW),
      status: -1,
      soc,
    };
  }
  return { power: 0, status: 0, soc };
};

export interface Powerflow {
  pv: string;
  load: string;
  grid: string;
  bettery: string;
  betteryStatus: number;
  soc: string;
  gridStatus: number;
  loadStatus: number;
}

/** Build the powerflow block for a station at the current simulated time.
 *
 *  Sign convention, taken from four real captured SEMS payloads:
 *  - loadStatus     1 = importing from the grid, -1 = exporting, 0 = idle.
 *                   This is the reliable direction flag.
 *  - gridStatus    -1 = importing, 1 = exporting. Matches three of the four
 *                   real payloads; the fourth (a multi-inverter station) has
 *                   -1 while exporting, so consumers must not sign by it.
 *  - betteryStatus  1 = charging, -1 = discharging, 0 = idle.
 *
 *  In "magnitude" mode — the default, and what real SEMS does — `grid` is
 *  always non-negative in both directions. "signed" mode makes `grid` carry
 *  the sign itself, kept only so the other reading stays testable. */
export const buildPowerflow = (profile: StationProfile): Powerflow => {
  const hour = currentHour();
  const capacity = profile.inverters.reduce(
    (sum, inverter) => sum + inverter.capacityW,
    0,
  );
  const pv = capacity * solarFraction(hour);
  const load = loadWatts(profile, hour);
  const battery = batteryFlow(profile, pv - load, hour);
  // Positive net = importing from the grid.
  const net = load + (battery.status === 1 ? battery.power : 0) - pv -
    (battery.status === -1 ? battery.power : 0);

  const idle = Math.abs(net) < 50;
  // Real SEMS: loadStatus is the direction flag, gridStatus is its inverse.
  const loadStatus = idle ? 0 : (net > 0 ? 1 : -1);
  const gridStatus = idle ? 0 : -loadStatus;
  const gridValue = state.gridSignMode === "signed" ? net : Math.abs(net);

  return {
    pv: watts(pv),
    load: watts(load),
    grid: watts(gridValue),
    bettery: watts(battery.power),
    betteryStatus: battery.status,
    soc: profile.battery ? `${battery.soc}%` : "0%",
    gridStatus,
    loadStatus,
  };
};

export const stationListEntry = (
  profile: StationProfile,
): Record<string, unknown> => ({
  id: profile.id,
  powerstation_id: profile.id,
  stationname: profile.name,
  status: 1,
  capacity: profile.inverters.reduce((s, i) => s + i.capacityW, 0) / 1000,
  org_name: "Fake SEMS Org",
});

export const stationDetail = (
  profile: StationProfile,
): Record<string, unknown> => ({
  hasPowerflow: profile.hasPowerflow,
  powerflow: profile.hasPowerflow ? buildPowerflow(profile) : null,
  hasEnergeStatisticsCharts: false,
  homeKit: { sn: profile.homeKitSn },
  info: {
    powerstation_id: profile.id,
    stationname: profile.name,
    address: "1 Example Street, Testville",
    org_code: "FAKE",
    powerstation_type: profile.battery ? "Hybrid" : "Grid-Tied",
    status: 1,
    time_span: 10,
    capacity: profile.inverters.reduce((s, i) => s + i.capacityW, 0) / 1000,
  },
  inverter: profile.inverters.map((inverter) => ({
    sn: inverter.sn,
    name: inverter.name,
    model_type: inverter.modelType,
    status: 1,
    invert_full: {
      sn: inverter.sn,
      name: inverter.name,
      model_type: inverter.modelType,
      capacity: inverter.capacityW / 1000,
      status: 1,
      pac: Math.round(
        inverter.capacityW * solarFraction(currentHour()),
      ),
    },
  })),
  kpi: {
    total_power: profile.totalPowerKwh,
    power: Math.round(
      profile.inverters.reduce((s, i) => s + i.capacityW, 0) *
        solarFraction(currentHour()),
    ) / 1000,
    pmeter: 0,
    currency: "AUD",
  },
  energeStatisticsCharts: {},
  region: REGION,
});
