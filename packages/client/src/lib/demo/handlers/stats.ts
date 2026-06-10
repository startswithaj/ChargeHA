import type { QueryHandler } from "./types.ts";
import {
  aggregateDay,
  aggregateMonth,
  aggregateYear,
} from "../demoAggregate.ts";
import { demoNow } from "../demoClock.ts";

interface DayInput {
  date: string;
  resolution?: "1h" | "15m";
  vehicleId?: string;
}
interface MonthInput {
  year: number;
  month: number;
  vehicleId?: string;
}
interface YearInput {
  year: number;
  vehicleId?: string;
}

export const statsHandlers: Record<string, QueryHandler> = {
  "stats.day": (input, s) => {
    const i = input as DayInput;
    return aggregateDay(
      s.series,
      i.date,
      i.resolution ?? "1h",
      i.vehicleId,
      demoNow(),
    );
  },
  "stats.month": (input, s) => {
    const i = input as MonthInput;
    return aggregateMonth(s.series, i.year, i.month, i.vehicleId, demoNow());
  },
  "stats.year": (input, s) => {
    const i = input as YearInput;
    return aggregateYear(s.series, i.year, i.vehicleId, demoNow());
  },
};
