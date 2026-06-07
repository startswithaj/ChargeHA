import type { QueryHandler } from "./types.ts";
import type { DemoState } from "../demoState.ts";
import { dateForOffset } from "../demoDates.ts";

interface Page {
  limit?: number;
  offset?: number;
}

const parseChecks = (json: string): Record<string, unknown> => {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const controllerLogs = (s: DemoState) =>
  s.series.days
    .flatMap((day, di) => {
      const date = dateForOffset(day.offset);
      return day.logs.map((l, li) => ({
        id: di * 100_000 + li,
        timestamp: `${date}T${l.time}:00`,
        vehicleId: l.vehicleId,
        vehicleName: l.vehicleName,
        mode: "auto",
        inputs: {},
        checks: parseChecks(l.checksJson),
        action: l.action,
        actionDetail: l.detail,
        targetAmps: l.amps,
        traceId: null,
      }));
    })
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

const energyReads = (s: DemoState) =>
  s.series.days
    .flatMap((day, di) => {
      const date = dateForOffset(day.offset);
      return day.readings.map((r, li) => ({
        id: di * 100_000 + li,
        timestamp: `${date}T${r.time}:00`,
        solarProductionW: r.solarW,
        gridPowerW: r.gridW,
        homeConsumptionW: r.homeW,
        batteryPowerW: null,
        batterySoc: null,
        ratePerKwh: null,
      }));
    })
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

const CHARGER_VOLTAGE_V = 230;
const CHARGE_AMPS_MAX = 32;

/** Synthesize vehicle-update rows from the series' per-vehicle charge entries
 *  (one row per charging reading — idle readings aren't stored per-vehicle). */
const vehicleUpdates = (s: DemoState) => {
  const vById = new Map(s.series.vehicles.map((v) => [v.id, v]));
  return s.series.days
    .flatMap((day, di) => {
      const date = dateForOffset(day.offset);
      return day.readings.flatMap((r, ri) =>
        r.charge.map((c, ci) => {
          const v = vById.get(c.vehicleId);
          const capacityKwh = v?.capacityKwh ?? 60;
          const chargeLimit = v?.chargeLimitPercent ?? 80;
          const powerKw = c.w / 1000;
          const remainingKwh = Math.max(
            0,
            (chargeLimit - c.soc) / 100 * capacityKwh,
          );
          return {
            id: di * 1_000_000 + ri * 10 + ci,
            timestamp: `${date}T${r.time}:00`,
            vehicleName: v?.name ?? c.vehicleId,
            isOnline: true,
            isHome: true,
            isPluggedIn: true,
            isCharging: true,
            batteryLevel: c.soc,
            chargeLimit,
            chargePowerKw: powerKw,
            chargeAmps: c.amps,
            chargeAmpsMax: CHARGE_AMPS_MAX,
            chargerVoltage: CHARGER_VOLTAGE_V,
            energyAddedKwh: 0,
            minutesToFull: powerKw > 0
              ? Math.round(remainingKwh / powerKw * 60)
              : 0,
          };
        })
      );
    })
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
};

const paginate = <T>(rows: T[], input: Page): { rows: T[]; total: number } => {
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 50;
  return { rows: rows.slice(offset, offset + limit), total: rows.length };
};

export const logsHandlers: Record<string, QueryHandler> = {
  "log.chargeController": (input, s) => {
    const { rows, total } = paginate(controllerLogs(s), input as Page);
    return { logs: rows, total };
  },
  "log.energyReads": (input, s) => {
    const { rows, total } = paginate(energyReads(s), input as Page);
    return { readings: rows, total };
  },
  "log.vehicleUpdates": (input, s) => {
    const { rows, total } = paginate(vehicleUpdates(s), input as Page);
    return { readings: rows, total };
  },
  // No plugin logs in demo — nothing meaningful to fabricate.
  "log.pluginLogs": () => ({ logs: [], total: 0 }),
};
