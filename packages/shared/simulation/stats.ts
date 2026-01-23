import type { SimResult } from "./types.ts";

export interface AmpChange {
  time: string;
  from: number;
  to: number;
}

export interface VehicleStats {
  name: string;
  starts: number;
  stops: number;
  ampChanges: number;
  totalCalls: number;
  chargingMinutes: number;
  finalBattery: number;
  ampChangeLog: AmpChange[];
}

interface StatsAcc {
  starts: number;
  stops: number;
  ampChanges: number;
  chargingMinutes: number;
  wasCharging: boolean;
  prevAmps: number;
  ampChangeLog: AmpChange[];
}

export function computeVehicleStats(
  results: SimResult[],
  vehicleNames: string[],
): VehicleStats[] {
  return vehicleNames.map((name, index) => {
    const acc = results.reduce<StatsAcc>((acc, r) => {
      const v = r.vehicles[index];
      const isCharging = v.isCharging;

      if (isCharging && !acc.wasCharging) {
        acc.starts++;
        acc.ampChangeLog.push({ time: r.time, from: 0, to: v.chargeAmps });
      } else if (!isCharging && acc.wasCharging) {
        acc.stops++;
        acc.ampChangeLog.push({ time: r.time, from: acc.prevAmps, to: 0 });
      } else if (isCharging && v.chargeAmps !== acc.prevAmps) {
        acc.ampChanges++;
        acc.ampChangeLog.push({
          time: r.time,
          from: acc.prevAmps,
          to: v.chargeAmps,
        });
      }

      if (isCharging) acc.chargingMinutes++;
      acc.wasCharging = isCharging;
      acc.prevAmps = v.chargeAmps;
      return acc;
    }, {
      starts: 0,
      stops: 0,
      ampChanges: 0,
      chargingMinutes: 0,
      wasCharging: false,
      prevAmps: 0,
      ampChangeLog: [],
    });

    return {
      name,
      starts: acc.starts,
      stops: acc.stops,
      ampChanges: acc.ampChanges,
      totalCalls: acc.starts + acc.stops + acc.ampChanges,
      chargingMinutes: acc.chargingMinutes,
      finalBattery: results[results.length - 1].vehicles[index].batteryLevel,
      ampChangeLog: acc.ampChangeLog,
    };
  });
}
