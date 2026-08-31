import { useMemo } from "react";
import type {
  StatsPeriod,
  StatsResponse,
  VehicleWithState,
} from "@chargeha/shared";
import type { DayResolution } from "./useStats.ts";
import { trpc } from "../trpc.ts";

export interface VehicleBreakdown {
  vehicleId: string;
  vehicleName: string;
  totalChargedWh: number;
  totalSolarWh: number;
  totalGridWh: number;
  totalCostCents: number;
  evSolarSavingsCents: number;
}

interface UseVehicleBreakdownsArgs {
  data: StatsResponse | null;
  loading: boolean;
  period: StatsPeriod;
  cursor: Date;
  resolution: DayResolution;
}

interface UseVehicleBreakdownsResult {
  hasChargeData: boolean;
  hasConfiguredVehicles: boolean;
  vehicleBreakdownsLoading: boolean;
  currencySymbol: string;
  gridPercent: number;
  chargeGridPercent: number;
  activeVehicleBreakdowns: VehicleBreakdown[];
}

function cursorToDateStr(cursor: Date): string {
  const year = cursor.getFullYear();
  const month = cursor.getMonth() + 1;
  return `${year}-${String(month).padStart(2, "0")}-${
    String(cursor.getDate()).padStart(2, "0")
  }`;
}

export function useVehicleBreakdowns({
  data,
  loading,
  period,
  cursor,
  resolution,
}: UseVehicleBreakdownsArgs): UseVehicleBreakdownsResult {
  const vehiclesQuery = trpc.vehicle.list.useQuery();
  const chargersQuery = trpc.charger.list.useQuery();
  const vehicles = useMemo(() => {
    const data = vehiclesQuery.data;
    if (!data) return [];
    return data.vehicles as VehicleWithState[];
  }, [vehiclesQuery.data]);
  // Readings key by resolved vehicle, else by the standalone charger.
  const entities = useMemo(() => {
    const standalone = (chargersQuery.data ?? [])
      .filter((c) => c.vehicleId === null)
      .map((c) => ({ id: c.id, name: c.name }));
    return [
      ...vehicles.map((v) => ({ id: v.id, name: v.name })),
      ...standalone,
    ];
  }, [vehicles, chargersQuery.data]);
  const hasConfiguredVehicles = entities.length > 0;

  const year = cursor.getFullYear();
  const month = cursor.getMonth() + 1;
  const dateStr = cursorToDateStr(cursor);

  const vehicleQueries = trpc.useQueries((t) =>
    entities.map((v) => {
      switch (period) {
        case "day":
          return t.stats.day(
            {
              date: dateStr,
              vehicleId: v.id,
              resolution: resolution === "15m" ? "15m" : undefined,
            },
            { enabled: !loading },
          );
        case "month":
          return t.stats.month(
            { year, month, vehicleId: v.id },
            { enabled: !loading },
          );
        case "year":
          return t.stats.year(
            { year, vehicleId: v.id },
            { enabled: !loading },
          );
      }
    })
  );

  const listsPending = vehiclesQuery.isPending || chargersQuery.isPending;
  const vehicleBreakdownsLoading = listsPending ||
    vehicleQueries.some((q) => q.isPending);

  const vehicleBreakdowns = useMemo(() => {
    return entities
      .map((v, i) => {
        const res = vehicleQueries[i]?.data;
        if (!res) return null;
        return {
          vehicleId: v.id,
          vehicleName: v.name,
          totalChargedWh: res.totalChargedWh,
          totalSolarWh: res.totalSolarWh,
          totalGridWh: res.totalGridWh,
          totalCostCents: res.totalCostCents ?? 0,
          evSolarSavingsCents: res.evSolarSavingsCents ?? 0,
        };
      })
      .filter((vb): vb is VehicleBreakdown => vb !== null);
  }, [entities, vehicleQueries]);

  const hasChargeData = data ? data.totalChargedWh > 0 : false;
  const currencySymbol = data?.currencySymbol ?? "$";

  // Grid % for energy breakdown
  const gridPercent = data && data.homeConsumedWh > 0
    ? 100 - data.homeSelfPoweredPercent
    : 0;

  // Grid share of vehicle-charging energy, for the vehicle breakdown.
  const chargeHomeTotal = (data?.totalSolarWh ?? 0) + (data?.totalGridWh ?? 0);
  const chargeGridPercent = chargeHomeTotal > 0
    ? Math.round(((data?.totalGridWh ?? 0) / chargeHomeTotal) * 100)
    : 0;

  const activeVehicleBreakdowns = vehicleBreakdowns.filter(
    (vb) => vb.totalChargedWh > 0,
  );

  return {
    hasChargeData,
    hasConfiguredVehicles,
    vehicleBreakdownsLoading,
    currencySymbol,
    gridPercent,
    chargeGridPercent,
    activeVehicleBreakdowns,
  };
}
