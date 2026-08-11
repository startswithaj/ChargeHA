import { useMemo } from "react";
import type { EnergyData } from "@chargeha/shared";
import { calculateSolarAttribution } from "@chargeha/shared/solarAttribution";
import type { ChargingVehicleFlow } from "../../EnergyFlowDiagram/EnergyFlowDiagram.tsx";

export interface ChargingEntry {
  id: string;
  name: string;
  isCharging: boolean;
  chargePowerKw: number;
}

export function formatTimeUntil(isoString: string): string {
  const diffMs = new Date(isoString).getTime() - Date.now();
  const diffMin = Math.max(0, Math.round(diffMs / 60_000));
  if (diffMin < 60) return `${diffMin}m`;
  const hours = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

export function useChargingSolarGrid(
  realtime: EnergyData | null,
  entries: ChargingEntry[],
): Record<string, { solarW: number; gridW: number }> {
  return useMemo(() => {
    if (!realtime) return {};

    const charging = entries.filter((e) => e.isCharging && e.chargePowerKw > 0);
    const totalChargePowerW = charging.reduce(
      (sum, e) => sum + (e.chargePowerKw * 1000),
      0,
    );

    return Object.fromEntries(
      charging.map((e) => [
        e.id,
        calculateSolarAttribution(
          e.chargePowerKw * 1000,
          totalChargePowerW,
          realtime.solarProductionW,
          realtime.homeConsumptionW,
        ),
      ]),
    );
  }, [realtime, entries]);
}

export function useChargingFlows(
  realtime: EnergyData | null,
  entries: ChargingEntry[],
): ChargingVehicleFlow[] {
  const solarGrid = useChargingSolarGrid(realtime, entries);

  return useMemo(() => {
    return entries
      .filter((e) => e.isCharging && e.chargePowerKw > 0)
      .map((e) => ({
        id: e.id,
        name: e.name,
        chargePowerW: e.chargePowerKw * 1000,
        solarW: solarGrid[e.id]?.solarW ?? 0,
        gridW: solarGrid[e.id]?.gridW ?? 0,
      }));
  }, [entries, solarGrid]);
}

export function chargingEntriesFromPoints(
  points: Array<
    {
      id: string;
      name: string;
      state: { isCharging: boolean; chargePowerKw: number | null } | null;
    }
  >,
): ChargingEntry[] {
  return points.map((p) => ({
    id: p.id,
    name: p.name,
    isCharging: p.state?.isCharging ?? false,
    chargePowerKw: p.state?.chargePowerKw ?? 0,
  }));
}
