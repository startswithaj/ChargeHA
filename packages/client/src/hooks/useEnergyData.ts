import type { CumulativeEnergyData, EnergyData } from "@chargeha/shared";
import { trpc } from "../trpc.ts";

export interface EnergyQueryData {
  realtime: EnergyData;
  cumulative: CumulativeEnergyData;
  lastUpdated: Date;
}

export function useEnergyData() {
  const query = trpc.energy.realtime.useQuery(undefined, {
    select: (data): EnergyQueryData => ({
      realtime: data.realtime,
      cumulative: data.cumulative,
      lastUpdated: new Date(data.timestamp),
    }),
  });

  return query;
}
