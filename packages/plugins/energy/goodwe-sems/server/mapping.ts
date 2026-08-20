import type { EnergyData } from "@chargeha/shared";
import type { SemsPowerflow, SemsStationDetail } from "./GoodweSemsClient.ts";

const LOAD_STATUS_IMPORTING = 1;

const UNIT_SCALES: Record<string, number> = { w: 1, kw: 1000, mw: 1_000_000 };

export function parseSemsValue(
  raw: string | number | undefined,
): number | null {
  if (raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  // The parenthesised suffix is a unit, not decoration — "3.5(kW)" is 3500W.
  const unit = /\(([^)]*)\)/.exec(raw)?.[1].trim().toLowerCase();
  const stripped = raw.replace(/\([^)]*\)/g, "").trim();
  if (stripped === "") return null;
  const value = Number(stripped);
  if (!Number.isFinite(value)) return null;
  return value * (UNIT_SCALES[unit ?? ""] ?? 1);
}

export function applyStatus(
  magnitude: number,
  status: number | string | undefined,
): number {
  const multiplier = Number(status);
  if (!Number.isFinite(multiplier)) return magnitude;
  return magnitude * multiplier;
}

// SEMS sends `grid` unsigned in both directions; `loadStatus` carries the
// direction. `gridStatus` is -1 in both directions on multi-inverter stations,
// so it is not safe to sign by.
export function toGridPowerW(flow: SemsPowerflow): number {
  const magnitude = parseSemsValue(flow.grid);
  if (magnitude === null) return 0;
  const status = Number(flow.loadStatus);
  // Unknown direction must not read as export: phantom export starts a charge
  // that draws real grid power.
  if (!Number.isFinite(status) || status === 0) return 0;
  const direction = status === LOAD_STATUS_IMPORTING ? 1 : -1;
  return Math.abs(magnitude) * direction;
}

export function toBatteryPowerW(flow: SemsPowerflow): number | null {
  const magnitude = parseSemsValue(flow.bettery);
  if (magnitude === null) return null;
  return applyStatus(Math.abs(magnitude), flow.betteryStatus);
}

const EXPORT_TOLERANCE_W = 40;

// SEMS sometimes reports a grid export that exceeds the solar production
// plus battery output. The inverter-side solar upload lags the meter-side
// grid reading, so the composed payload is physically impossible. Real
// captures from the 14 Aug AU logs:
//   10:27:57  solar=3218W  grid=-3827W  home=0W  (raw load=0(W) gridStatus=1)   ← exporting 609W more than solar
//   10:47:57  solar=2551W  grid=-3997W  home=0W  (raw load=0(W) gridStatus=1)   ← 1446W over
//   10:49–51  solar=3911W  grid=-6392…-6440W  home=0W                            ← 2.5kW over, 3-poll window
//   10:58:56  solar=2680W  grid=-6176W  home=0W                                  ← 3.5kW over — the worst
//   11:00:03  solar=4954W  grid=-7252W  home=0W
//   11:14:58  solar=4835W  grid=-5335W  home=0W
export function isImpossibleExport(data: EnergyData): boolean {
  const exportW = -data.gridPowerW;
  if (exportW <= 0) return false;
  const batteryW = Math.abs(data.batteryPowerW ?? 0);
  return exportW > data.solarProductionW + batteryW + EXPORT_TOLERANCE_W;
}

export function toEnergyData(flow: SemsPowerflow): EnergyData {
  const load = parseSemsValue(flow.load);
  const solar = parseSemsValue(flow.pv) ?? 0;
  const grid = toGridPowerW(flow);
  return {
    solarProductionW: solar,
    gridPowerW: grid,
    // Overnight the inverter sleeps and SEMS sends load as an empty string
    // with only the meter reporting. Home consumption is still solar + signed
    // grid (the same balance SEMS uses to compute load), so derive it instead
    // of showing 0W.
    homeConsumptionW: load === null
      ? Math.max(0, solar + grid)
      : Math.abs(load),
    batteryPowerW: toBatteryPowerW(flow),
    batterySoc: parseSemsValue(flow.soc),
    gridVoltageV: null,
    lastUpdated: new Date().toISOString(),
  };
}

export function toEnergyDataFromDetail(
  detail: SemsStationDetail,
  flow: SemsPowerflow,
): EnergyData {
  return {
    ...toEnergyData(flow),
    sourceUpdatedAt: detail.sourceUpdatedAtMs !== null
      ? new Date(detail.sourceUpdatedAtMs).toISOString()
      : null,
  };
}
