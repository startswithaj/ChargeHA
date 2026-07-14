import type { QueryHandler } from "./types.ts";
import type { EnergyData } from "@chargeha/shared";
import { deserializeSection } from "@chargeha/shared/configSections";
import { demoEnergyPluginSummaries } from "@chargeha/plugins/demoPluginSummaries";
import { simulatedEnergyConfigDef } from "../../../../../plugins/energy/simulated/server/config.ts";
import type { DemoState } from "../demoState.ts";
import { currentSnapshot } from "../demoTick.ts";
import { dateForOffset } from "../demoDates.ts";
import { demoNow } from "../demoClock.ts";

const GRID_VOLTAGE_V = 230;
const BUCKETS_PER_DAY = 96;

type DatedReading = EnergyData & { timestamp: string };

/** Most-recent-first energy readings across the series, up to `limit`. */
const datedReadings = (s: DemoState, limit: number): DatedReading[] => {
  const now = demoNow();
  const daysNeeded = s.series.days.slice(
    0,
    Math.ceil(limit / BUCKETS_PER_DAY) + 1,
  );
  return daysNeeded
    .flatMap((day) => {
      const date = dateForOffset(day.offset, now);
      return day.readings.map((r): DatedReading => {
        const ts = `${date}T${r.time}:00`;
        return {
          solarProductionW: r.solarW,
          gridPowerW: r.gridW,
          homeConsumptionW: r.homeW,
          batteryPowerW: null,
          batterySoc: null,
          gridVoltageV: GRID_VOLTAGE_V,
          lastUpdated: ts,
          timestamp: ts,
        };
      });
    })
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);
};

export const energyHandlers: Record<string, QueryHandler> = {
  "energy.realtime": (_i, s) => currentSnapshot(s, demoNow()),
  "energy.getPlugins": (_i, s) =>
    demoEnergyPluginSummaries.map((p) => ({
      ...p,
      configured: s.config.energy_adapter_type === p.id,
    })),
  "energy.history": (input, s) => ({
    readings: datedReadings(s, (input as { limit?: number }).limit ?? 60),
  }),
  "plugin.energy.simulated_energy.getConfig": (_i, s) =>
    deserializeSection(simulatedEnergyConfigDef, s.config),
};
