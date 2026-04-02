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
  // Shared vehicle list cache via tRPC
  const vehiclesQuery = trpc.vehicle.list.useQuery();
  const vehicles = useMemo(() => {
    const data = vehiclesQuery.data;
    if (!data) return [];
    return data.vehicles as VehicleWithState[];
  }, [vehiclesQuery.data]);
  const hasConfiguredVehicles = vehicles.length > 0;

  // Build per-vehicle stats queries
  const year = cursor.getFullYear();
  const month = cursor.getMonth() + 1;
  const dateStr = cursorToDateStr(cursor);
  const tz = useMemo(() => -(new Date().getTimezoneOffset() / 60), []);

  const vehicleQueries = trpc.useQueries((t) =>
    vehicles.map((v) => {
      switch (period) {
        case "day":
          return t.stats.day(
            {
              date: dateStr,
              vehicleId: v.id,
              tz,
              resolution: resolution === "15m" ? "15m" : undefined,
            },
            { enabled: !loading },
          );
        case "month":
          return t.stats.month(
            { year, month, vehicleId: v.id, tz },
            { enabled: !loading },
          );
        case "year":
          return t.stats.year(
            { year, vehicleId: v.id, tz },
            { enabled: !loading },
          );
      }
    })
  );

  // Prevent fallback UI from rendering while per-vehicle queries are still settling.
  const vehicleBreakdownsLoading = vehiclesQuery.isPending ||
    vehicleQueries.some((q) => q.isPending);

  // Map query results to VehicleBreakdown[]
  const vehicleBreakdowns = useMemo(() => {
    return vehicles
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
  }, [vehicles, vehicleQueries]);

  const hasChargeData = data ? data.totalChargedWh > 0 : false;
  const currencySymbol = data?.currencySymbol ?? "$";

  // Grid % for energy breakdown
  const gridPercent = data && data.homeConsumedWh > 0
    ? 100 - data.homeSelfPoweredPercent
    : 0;

  // Charge self-powered % for vehicle breakdown
  const chargeHomeTotal = (data?.totalSolarWh ?? 0) + (data?.totalGridWh ?? 0);
  const chargeGridPercent = chargeHomeTotal > 0
    ? Math.round(((data?.totalGridWh ?? 0) / chargeHomeTotal) * 100)
    : 0;

  // Filter per-vehicle breakdowns to those with charge data
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
