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
  // No simulated vehicle-poll or plugin logs in demo.
  "log.vehicleUpdates": () => ({ readings: [], total: 0 }),
  "log.pluginLogs": () => ({ logs: [], total: 0 }),
};
