import { state } from "./config.ts";

// SEMS+ reports power as kW floats, unlike the legacy portal's "1234(W)"
// strings. pGrid is signed: positive exports, negative imports.
const kw = (watts: number): number => Math.round(watts) / 1000;

export interface StationProfile {
  id: string;
  name: string;
  // Nameplate AC output, watts.
  capacityW: number;
  // Baseline household draw, watts.
  baseLoadW: number;
  battery: { capacityWh: number; maxChargeW: number } | null;
  evChargerW: number | null;
}

export const STATIONS: readonly StationProfile[] = [
  {
    // Mirrors the AU 3-phase HomeKit install this backend was built against.
    id: "11111111-1111-4111-8111-111111111111",
    name: "Fake 3-Phase Home",
    capacityW: 10_000,
    baseLoadW: 600,
    battery: null,
    evChargerW: null,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Fake Hybrid + Battery",
    capacityW: 8_000,
    baseLoadW: 750,
    battery: { capacityWh: 13_500, maxChargeW: 5_000 },
    evChargerW: null,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Fake Home + EV Charger",
    capacityW: 6_600,
    baseLoadW: 500,
    battery: null,
    evChargerW: 7_000,
  },
];

export const findStation = (id: string): StationProfile | undefined =>
  STATIONS.find((s) => s.id === id);

const hourNow = (): number =>
  state.hourOverride ?? new Date().getHours() + new Date().getMinutes() / 60;

// Bell curve peaking at solar noon, zero before 06:00 and after 20:00.
const solarW = (capacityW: number, hour: number): number => {
  if (hour < 6 || hour > 20) return 0;
  const fraction = Math.cos(((hour - 13) / 7) * (Math.PI / 2)) ** 2;
  return capacityW * Math.max(0, fraction) * 0.85;
};

export interface Flow {
  id: string;
  name: string;
  status: string;
  isGoodweInverter: boolean;
  flows: Record<string, string[]>;
  pSystem?: number;
  pAc: number;
  pGrid: number;
  pConsum: number;
  pBat?: number;
  soc?: number;
  pEvChar?: number;
  consumFlag: boolean;
  refreshTime: string;
}

// The gateway timestamps in station-local time with no offset.
const refreshTime = (): string =>
  new Date(Date.now() - 12_000).toISOString().replace(/Z$/, "").slice(0, 23);

export const stationFlow = (station: StationProfile): Flow => {
  const hour = hourNow();
  const solar = solarW(station.capacityW, hour);
  const evW = station.evChargerW !== null && hour > 9 && hour < 16
    ? station.evChargerW
    : 0;
  // Charge the battery from any surplus, discharge it to cover a shortfall.
  const surplus = solar - station.baseLoadW - evW;
  const batteryW = station.battery === null ? 0 : Math.max(
    -station.battery.maxChargeW,
    Math.min(station.battery.maxChargeW, surplus > 0 ? surplus * 0.6 : surplus),
  );
  const load = station.baseLoadW + evW;
  // pAc = pConsum + pGrid holds in every captured payload; keep it exact.
  const gridW = solar - load - Math.max(0, batteryW) +
    Math.max(0, -batteryW);

  const flow: Flow = {
    id: station.id,
    name: station.name,
    status: solar > 0 ? "1" : "0",
    isGoodweInverter: true,
    flows: solar > 0
      ? { pSystem: ["pConsum", "pGrid"] }
      : { pGrid: ["pConsum"] },
    pAc: kw(solar),
    pGrid: kw(gridW),
    pConsum: kw(load),
    consumFlag: false,
    refreshTime: refreshTime(),
  };
  if (solar > 0) flow.pSystem = kw(solar);
  if (station.battery !== null) {
    flow.pBat = kw(batteryW);
    flow.soc = Math.round(55 + Math.sin(hour / 3) * 30);
  }
  if (evW > 0) flow.pEvChar = kw(evW);
  return flow;
};

export const stationListEntry = (station: StationProfile) => ({
  id: station.id,
  name: station.name,
  status: "1",
  capacity: station.capacityW / 1000,
});
