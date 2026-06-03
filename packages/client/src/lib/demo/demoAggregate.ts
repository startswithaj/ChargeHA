// Pure-TS reimplementation of the server's StatsService, operating over the
// dateless demo series. Buckets readings by hour (day), day-of-month (month) or
// month (year), matching StatsResponse exactly so the UI is none the wiser.

import type {
  EnergyBucket,
  SolarProductionPoint,
  StatsBucket,
  StatsResponse,
  TariffBreakdownEntry,
  VehicleSocSnapshot,
} from "@chargeha/shared";
import type {
  DemoChargeEntry,
  DemoReading,
  DemoSeries,
  DemoVehicleMeta,
} from "./series.ts";
import {
  dateForOffset,
  offsetForDate,
  parseDateKey,
  timeToMinutes,
} from "./demoDates.ts";
import { costCents, labelForRate, rateForMinute } from "./demoTariff.ts";

const DAY_MS = 86_400_000;
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const pad = (n: number): string => String(n).padStart(2, "0");
const round = (n: number): number => Math.round(n);

interface ReadingEnergy {
  solarProductionWh: number;
  solarWh: number;
  gridWh: number;
  totalWh: number;
  costCents: number;
  solarSavingsCents: number;
}

interface ReadingCharge {
  solarWh: number;
  gridWh: number;
  awayWh: number;
  totalWh: number;
  costCents: number;
}

interface Tagged {
  idx: number;
  rate: number;
  energy: ReadingEnergy;
  charge: ReadingCharge;
}

/** Derive home-energy and charge metrics for one reading. */
const deriveReading = (
  r: DemoReading,
  intervalH: number,
  vehicleId: string | undefined,
): Omit<Tagged, "idx"> => {
  const rate = rateForMinute(timeToMinutes(r.time));
  const solarWh = Math.min(r.solarW, r.homeW) * intervalH;
  const gridWh = Math.max(0, r.gridW) * intervalH;
  const energy: ReadingEnergy = {
    solarProductionWh: r.solarW * intervalH,
    solarWh,
    gridWh,
    totalWh: r.homeW * intervalH,
    costCents: costCents(gridWh, rate),
    solarSavingsCents: costCents(solarWh, rate),
  };
  const entries = vehicleId
    ? r.charge.filter((c) => c.vehicleId === vehicleId)
    : r.charge;
  const cSolar = entries.reduce((s, c) => s + c.solarC, 0) * intervalH;
  const cGrid = entries.reduce((s, c) => s + c.gridC, 0) * intervalH;
  const charge: ReadingCharge = {
    solarWh: cSolar,
    gridWh: cGrid,
    awayWh: 0,
    totalWh: cSolar + cGrid,
    costCents: costCents(cGrid, rate),
  };
  return { rate, energy, charge };
};

const addEnergy = (
  a: ReadingEnergy | undefined,
  b: ReadingEnergy,
): ReadingEnergy => ({
  solarProductionWh: (a?.solarProductionWh ?? 0) + b.solarProductionWh,
  solarWh: (a?.solarWh ?? 0) + b.solarWh,
  gridWh: (a?.gridWh ?? 0) + b.gridWh,
  totalWh: (a?.totalWh ?? 0) + b.totalWh,
  costCents: (a?.costCents ?? 0) + b.costCents,
  solarSavingsCents: (a?.solarSavingsCents ?? 0) + b.solarSavingsCents,
});

const addCharge = (
  a: ReadingCharge | undefined,
  b: ReadingCharge,
): ReadingCharge => ({
  solarWh: (a?.solarWh ?? 0) + b.solarWh,
  gridWh: (a?.gridWh ?? 0) + b.gridWh,
  awayWh: (a?.awayWh ?? 0) + b.awayWh,
  totalWh: (a?.totalWh ?? 0) + b.totalWh,
  costCents: (a?.costCents ?? 0) + b.costCents,
});

/** Fill bucket arrays for a fixed set of bucket keys. */
const buildBuckets = (
  tagged: Tagged[],
  keys: number[],
  labelFn: (key: number) => string,
): { energyBuckets: EnergyBucket[]; buckets: StatsBucket[] } => {
  const energyMap = tagged.reduce(
    (m, t) => m.set(t.idx, addEnergy(m.get(t.idx), t.energy)),
    new Map<number, ReadingEnergy>(),
  );
  const chargeMap = tagged.reduce(
    (m, t) => m.set(t.idx, addCharge(m.get(t.idx), t.charge)),
    new Map<number, ReadingCharge>(),
  );

  const energyBuckets = keys.map((key): EnergyBucket => {
    const e = energyMap.get(key);
    return {
      label: labelFn(key),
      solarProductionWh: round(e?.solarProductionWh ?? 0),
      solarWh: round(e?.solarWh ?? 0),
      gridWh: round(e?.gridWh ?? 0),
      totalWh: round(e?.totalWh ?? 0),
      costCents: round(e?.costCents ?? 0),
      solarSavingsCents: round(e?.solarSavingsCents ?? 0),
    };
  });
  const buckets = keys.map((key): StatsBucket => {
    const c = chargeMap.get(key);
    return {
      label: labelFn(key),
      solarWh: round(c?.solarWh ?? 0),
      gridWh: round(c?.gridWh ?? 0),
      awayWh: round(c?.awayWh ?? 0),
      totalWh: round(c?.totalWh ?? 0),
      costCents: round(c?.costCents ?? 0),
    };
  });
  return { energyBuckets, buckets };
};

const sum = <T>(rows: T[], pick: (r: T) => number): number =>
  rows.reduce((s, r) => s + pick(r), 0);

const computeEnergyTotals = (e: EnergyBucket[]) => {
  const homeSolarWh = sum(e, (b) => b.solarWh);
  const homeConsumedWh = sum(e, (b) => b.totalWh);
  return {
    homeSolarProductionWh: sum(e, (b) => b.solarProductionWh),
    homeConsumedWh,
    homeSolarWh,
    homeGridWh: sum(e, (b) => b.gridWh),
    homeSelfPoweredPercent: homeConsumedWh > 0
      ? Math.round((homeSolarWh / homeConsumedWh) * 100)
      : 0,
  };
};

const computeChargeTotals = (b: StatsBucket[]) => {
  const totalSolarWh = sum(b, (x) => x.solarWh);
  const totalGridWh = sum(b, (x) => x.gridWh);
  const homeChargeTotal = totalSolarWh + totalGridWh;
  return {
    totalSolarWh,
    totalGridWh,
    totalAwayWh: sum(b, (x) => x.awayWh),
    totalChargedWh: sum(b, (x) => x.totalWh),
    selfPoweredPercent: homeChargeTotal > 0
      ? Math.round((totalSolarWh / homeChargeTotal) * 100)
      : 0,
    totalCostCents: sum(b, (x) => x.costCents ?? 0),
  };
};

/** Per-rate breakdown of grid energy used for vehicle charging. */
const buildTariffBreakdown = (tagged: Tagged[]): TariffBreakdownEntry[] => {
  const byRate = tagged.reduce((m, t) => {
    const cur = m.get(t.rate) ?? { gridWh: 0, costCents: 0 };
    return m.set(t.rate, {
      gridWh: cur.gridWh + t.charge.gridWh,
      costCents: cur.costCents + t.charge.costCents,
    });
  }, new Map<number, { gridWh: number; costCents: number }>());
  return [...byRate.entries()]
    .filter(([, v]) => v.gridWh > 0)
    .map(([rate, v]) => ({
      label: labelForRate(rate),
      ratePerKwh: rate,
      gridWh: round(v.gridWh),
      costCents: round(v.costCents),
    }));
};

/** Per-bucket vehicle SoC snapshots, carrying the last known level forward. */
const buildVehicleSoc = (
  readings: DemoReading[],
  count: number,
  idxFn: (r: DemoReading) => number,
  vehicles: DemoVehicleMeta[],
): VehicleSocSnapshot[][] => {
  const nameById = new Map(vehicles.map((v) => [v.id, v.name]));
  const byBucket = readings.reduce((m, r) => {
    const i = idxFn(r);
    return m.set(i, [...(m.get(i) ?? []), ...r.charge]);
  }, new Map<number, DemoChargeEntry[]>());

  const result = Array.from({ length: count }).reduce<{
    latest: Map<string, number>;
    buckets: VehicleSocSnapshot[][];
  }>(
    (acc, _, i) => {
      const next = (byBucket.get(i) ?? []).reduce(
        (state, c) => state.set(c.vehicleId, c.soc),
        new Map(acc.latest),
      );
      acc.buckets.push(
        [...next.entries()].map(([vehicleId, soc]) => ({
          vehicleId,
          vehicleName: nameById.get(vehicleId) ?? vehicleId,
          batteryLevel: soc,
        })),
      );
      return { latest: next, buckets: acc.buckets };
    },
    { latest: new Map(), buckets: [] },
  );

  return result.buckets.some((b) => b.length > 0) ? result.buckets : [];
};

interface AssembleArgs {
  period: StatsResponse["period"];
  startDate: string;
  endDate: string;
  tagged: Tagged[];
  energyBuckets: EnergyBucket[];
  buckets: StatsBucket[];
  solarProductionLine: SolarProductionPoint[];
  vehicleSoc?: VehicleSocSnapshot[][];
}

const assembleResponse = (args: AssembleArgs): StatsResponse => {
  const evSavings = sum(
    args.tagged,
    (t) => costCents(t.charge.solarWh, t.rate),
  );
  const homeSavings = sum(args.tagged, (t) => t.energy.solarSavingsCents);
  const tariffBreakdown = buildTariffBreakdown(args.tagged);

  const response: StatsResponse = {
    period: args.period,
    startDate: args.startDate,
    endDate: args.endDate,
    energyBuckets: args.energyBuckets,
    ...computeEnergyTotals(args.energyBuckets),
    solarProductionLine: args.solarProductionLine,
    buckets: args.buckets,
    ...computeChargeTotals(args.buckets),
    solarSavingsCents: round(homeSavings + evSavings),
    evSolarSavingsCents: round(evSavings),
    currencySymbol: "$",
    currencyCode: "AUD",
  };
  if (tariffBreakdown.length > 0) response.tariffBreakdown = tariffBreakdown;
  if (args.vehicleSoc && args.vehicleSoc.length > 0) {
    response.vehicleSoc = args.vehicleSoc;
  }
  return response;
};

/** Readings for one day's offset (empty if that day isn't in the series). */
const readingsForOffset = (series: DemoSeries, offset: number): DemoReading[] =>
  series.days.find((d) => d.offset === offset)?.readings ?? [];

export const aggregateDay = (
  series: DemoSeries,
  date: string,
  resolution: "1h" | "15m",
  vehicleId?: string,
  now?: Date,
): StatsResponse => {
  const intervalH = series.bucketMinutes / 60;
  const readings = readingsForOffset(series, offsetForDate(date, now));
  const is15 = resolution === "15m";
  const count = is15 ? 96 : 24;
  const idxFn = (r: DemoReading): number =>
    is15
      ? Math.floor(timeToMinutes(r.time) / 15)
      : Math.floor(timeToMinutes(r.time) / 60);
  const labelFn = (i: number): string =>
    is15 ? `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}` : String(i);

  const tagged = readings.map((r): Tagged => ({
    idx: idxFn(r),
    ...deriveReading(r, intervalH, vehicleId),
  }));
  const keys = Array.from({ length: count }, (_, i) => i);
  const { energyBuckets, buckets } = buildBuckets(tagged, keys, labelFn);

  return assembleResponse({
    period: "day",
    startDate: date,
    endDate: date,
    tagged,
    energyBuckets,
    buckets,
    solarProductionLine: [],
    vehicleSoc: buildVehicleSoc(readings, count, idxFn, series.vehicles),
  });
};

/** Days in the series falling within a given year/month (month 1-12). */
const daysInMonth = (
  series: DemoSeries,
  year: number,
  month: number,
  now?: Date,
): { date: Date; readings: DemoReading[] }[] =>
  series.days
    .map((d) => ({
      date: parseDateKey(dateForOffset(d.offset, now)),
      readings: d.readings,
    }))
    .filter((x) =>
      x.date.getFullYear() === year && x.date.getMonth() + 1 === month
    );

const monthlySolarLine = (
  days: { date: Date; readings: DemoReading[] }[],
  intervalH: number,
  numDays: number,
): SolarProductionPoint[] =>
  Array.from({ length: numDays }, (_, i) => i + 1).flatMap((d) => {
    const readings = days.find((x) => x.date.getDate() === d)?.readings ?? [];
    return Array.from({ length: 4 }, (_, q) => {
      const wh = readings
        .filter((r) => {
          const h = Math.floor(timeToMinutes(r.time) / 60);
          return h >= q * 6 && h < q * 6 + 6;
        })
        .reduce((s, r) => s + r.solarW * intervalH, 0);
      return {
        x: d + q * 0.25,
        solarProductionKwh: Math.round((wh * 4 / 1000) * 100) / 100,
      };
    });
  });

export const aggregateMonth = (
  series: DemoSeries,
  year: number,
  month: number,
  vehicleId?: string,
  now?: Date,
): StatsResponse => {
  const intervalH = series.bucketMinutes / 60;
  const numDays = new Date(year, month, 0).getDate();
  const days = daysInMonth(series, year, month, now);

  const tagged = days.flatMap(({ date, readings }) =>
    readings.map((r): Tagged => ({
      idx: date.getDate(),
      ...deriveReading(r, intervalH, vehicleId),
    }))
  );
  const keys = Array.from({ length: numDays }, (_, i) => i + 1);
  const { energyBuckets, buckets } = buildBuckets(tagged, keys, String);

  return assembleResponse({
    period: "month",
    startDate: `${year}-${pad(month)}-01`,
    endDate: `${year}-${pad(month)}-${pad(numDays)}`,
    tagged,
    energyBuckets,
    buckets,
    solarProductionLine: monthlySolarLine(days, intervalH, numDays),
  });
};

const weekOfYear = (date: Date): number => {
  const start = new Date(date.getFullYear(), 0, 1);
  const doy = Math.floor((date.getTime() - start.getTime()) / DAY_MS);
  return Math.min(52, Math.floor(doy / 7));
};

const yearlySolarLine = (
  days: { date: Date; readings: DemoReading[] }[],
  intervalH: number,
): SolarProductionPoint[] => {
  const byWeek = days.reduce((m, { date, readings }) => {
    const w = weekOfYear(date);
    const wh = readings.reduce((s, r) => s + r.solarW * intervalH, 0);
    return m.set(w, (m.get(w) ?? 0) + wh);
  }, new Map<number, number>());
  return Array.from({ length: 53 }, (_, w) => ({
    x: 1 + (w / 52) * 11,
    solarProductionKwh:
      Math.round(((byWeek.get(w) ?? 0) * (52 / 12) / 1000) * 100) / 100,
  }));
};

export const aggregateYear = (
  series: DemoSeries,
  year: number,
  vehicleId?: string,
  now?: Date,
): StatsResponse => {
  const intervalH = series.bucketMinutes / 60;
  const days = series.days
    .map((d) => ({
      date: parseDateKey(dateForOffset(d.offset, now)),
      readings: d.readings,
    }))
    .filter((x) => x.date.getFullYear() === year);

  const tagged = days.flatMap(({ date, readings }) =>
    readings.map((r): Tagged => ({
      idx: date.getMonth() + 1,
      ...deriveReading(r, intervalH, vehicleId),
    }))
  );
  const keys = Array.from({ length: 12 }, (_, i) => i + 1);
  const { energyBuckets, buckets } = buildBuckets(
    tagged,
    keys,
    (m) => MONTH_LABELS[m - 1],
  );

  return assembleResponse({
    period: "year",
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`,
    tagged,
    energyBuckets,
    buckets,
    solarProductionLine: yearlySolarLine(days, intervalH),
  });
};
