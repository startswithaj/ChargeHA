import type { AppDatabase } from "../db/AppDatabase.ts";
import type {
  EnergyBucket,
  SolarProductionPoint,
  StatsBucket,
  StatsResponse,
  TariffBreakdownEntry,
  VehicleSocSnapshot,
} from "@chargeha/shared";

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

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

interface CostInfo {
  solarSavingsCents: number;
  evSolarSavingsCents: number;
  currencySymbol: string;
  currencyCode: string;
  tariffBreakdown?: TariffBreakdownEntry[];
}

export class StatsService {
  constructor(private db: AppDatabase) {}

  async buildDayStats(
    date: string,
    tz: number,
    vehicleId: string | undefined,
    detailed: boolean,
  ): Promise<StatsResponse> {
    return detailed
      ? await this.buildDetailedDayStats(date, tz, vehicleId)
      : await this.buildHourlyDayStats(date, tz, vehicleId);
  }

  async buildMonthStats(
    year: number,
    month: number,
    tz: number,
    vehicleId: string | undefined,
  ): Promise<StatsResponse> {
    const numDays = daysInMonth(year, month);
    const monthStr = String(month).padStart(2, "0");
    const startDate = `${year}-${monthStr}-01`;
    const endDate = `${year}-${monthStr}-${String(numDays).padStart(2, "0")}`;

    const [energyRows, chargeRows, solarRows, currency, tariffBreakdown] =
      await Promise.all([
        this.db.stats.getEnergyStatsMonth(year, month, tz),
        this.db.stats.getStatsMonth(year, month, tz, vehicleId),
        this.db.stats.getSolarProductionMonth(year, month, tz),
        this.getCurrencyConfig(),
        this.buildTariffBreakdown(startDate, endDate, tz),
      ]);

    const { energyBuckets, buckets } = this.buildBucketsFromRows(
      energyRows,
      chargeRows,
      1,
      numDays,
      (d) => String(d),
    );

    // 6-hour solar production line (4 points per day: x = 1, 1.25, 1.5, ..., numDays.75)
    // Multiply by 4 to convert 6-hour energy to equivalent daily rate (matching bar scale)
    const solarProductionLine = this.buildMonthlySolarLine(
      solarRows,
      numDays,
    );

    return this.buildResponse(
      "month",
      startDate,
      endDate,
      energyBuckets,
      buckets,
      solarProductionLine,
      {
        solarSavingsCents: this.sumSolarSavings(energyRows, chargeRows),
        evSolarSavingsCents: this.sumSolarSavings(chargeRows),
        tariffBreakdown,
        ...currency,
      },
    );
  }

  async buildYearStats(
    year: number,
    tz: number,
    vehicleId: string | undefined,
  ): Promise<StatsResponse> {
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    const [energyRows, chargeRows, solarRows, currency, tariffBreakdown] =
      await Promise.all([
        this.db.stats.getEnergyStatsYear(year, tz),
        this.db.stats.getStatsYear(year, tz, vehicleId),
        this.db.stats.getSolarProductionYear(year, tz),
        this.getCurrencyConfig(),
        this.buildTariffBreakdown(startDate, endDate, tz),
      ]);

    const { energyBuckets, buckets } = this.buildBucketsFromRows(
      energyRows,
      chargeRows,
      1,
      12,
      (m) => MONTH_LABELS[m - 1],
    );

    // Weekly solar production line (~52 points: x maps week to month position 1-12)
    // Multiply by 52/12 ≈ 4.33 to convert weekly energy to equivalent monthly rate (matching bar scale)
    const solarProductionLine = this.buildYearlySolarLine(solarRows);

    return this.buildResponse(
      "year",
      startDate,
      endDate,
      energyBuckets,
      buckets,
      solarProductionLine,
      {
        solarSavingsCents: this.sumSolarSavings(energyRows, chargeRows),
        evSolarSavingsCents: this.sumSolarSavings(chargeRows),
        tariffBreakdown,
        ...currency,
      },
    );
  }

  /** Build day stats with 15-minute resolution. */
  private async buildDetailedDayStats(
    date: string,
    tz: number,
    vehicleId: string | undefined,
  ): Promise<StatsResponse> {
    const [energyRows, chargeRows, currency, tariffBreakdown, pollLogs] =
      await Promise.all([
        this.db.stats.getEnergyStatsDayDetailed(date, tz),
        this.db.stats.getStatsDayDetailed(date, tz, vehicleId),
        this.getCurrencyConfig(),
        this.buildTariffBreakdown(date, date, tz),
        this.db.vehicles.getVehicleSocForDay(date, tz),
      ]);
    const energyMap = new Map(energyRows.map((r) => [r.bucket, r]));
    const chargeMap = new Map(chargeRows.map((r) => [r.bucket, r]));

    // Fill 96 fifteen-minute buckets (0-95)
    const { energyBuckets, buckets } = this.fillBuckets(
      0,
      96,
      (i) => {
        const hour = Math.floor(i / 4);
        const minutes = String((i % 4) * 15).padStart(2, "0");
        return `${String(hour).padStart(2, "0")}:${minutes}`;
      },
      energyMap,
      chargeMap,
    );

    return this.buildDayResponse(
      date,
      energyBuckets,
      buckets,
      this.sumSolarSavings(energyRows, chargeRows),
      this.sumSolarSavings(chargeRows),
      tariffBreakdown,
      currency,
      this.buildVehicleSocBuckets(pollLogs, 96, "15m"),
    );
  }

  /** Build day stats with 1-hour resolution. */
  private async buildHourlyDayStats(
    date: string,
    tz: number,
    vehicleId: string | undefined,
  ): Promise<StatsResponse> {
    const [energyRows, chargeRows, currency, tariffBreakdown, pollLogs] =
      await Promise.all([
        this.db.stats.getEnergyStatsDay(date, tz),
        this.db.stats.getStatsDay(date, tz, vehicleId),
        this.getCurrencyConfig(),
        this.buildTariffBreakdown(date, date, tz),
        this.db.vehicles.getVehicleSocForDay(date, tz),
      ]);

    const { energyBuckets, buckets } = this.buildBucketsFromRows(
      energyRows,
      chargeRows,
      0,
      24,
      (h) => String(h),
    );

    return this.buildDayResponse(
      date,
      energyBuckets,
      buckets,
      this.sumSolarSavings(energyRows, chargeRows),
      this.sumSolarSavings(chargeRows),
      tariffBreakdown,
      currency,
      this.buildVehicleSocBuckets(pollLogs, 24, "1h"),
    );
  }

  /** Assemble a day-period StatsResponse with optional vehicle SoC. */
  private buildDayResponse(
    date: string,
    energyBuckets: EnergyBucket[],
    buckets: StatsBucket[],
    solarSavingsCents: number,
    evSolarSavingsCents: number,
    tariffBreakdown: TariffBreakdownEntry[],
    currency: { currencySymbol: string; currencyCode: string },
    vehicleSoc: VehicleSocSnapshot[][],
  ): StatsResponse {
    const response = this.buildResponse(
      "day",
      date,
      date,
      energyBuckets,
      buckets,
      [],
      { solarSavingsCents, evSolarSavingsCents, tariffBreakdown, ...currency },
    );
    if (vehicleSoc.length > 0) {
      response.vehicleSoc = vehicleSoc;
    }
    return response;
  }

  /** Create bucket maps from rows with string bucket keys and fill. */
  private buildBucketsFromRows<
    E extends {
      bucket: string;
      solarProductionWh: number;
      solarWh: number;
      gridWh: number;
      totalWh: number;
      costCents: number;
      solarSavingsCents: number;
    },
    C extends {
      bucket: string;
      solarWh: number;
      gridWh: number;
      awayWh: number;
      totalWh: number;
      costCents: number;
    },
  >(
    energyRows: E[],
    chargeRows: C[],
    start: number,
    count: number,
    labelFn: (key: number) => string,
  ): { energyBuckets: EnergyBucket[]; buckets: StatsBucket[] } {
    const energyMap = this.toNumericBucketMap(energyRows);
    const chargeMap = this.toNumericBucketMap(chargeRows);
    return this.fillBuckets(start, count, labelFn, energyMap, chargeMap);
  }

  /** Parse string bucket keys to numeric map. */
  private toNumericBucketMap<T extends { bucket: string }>(
    rows: T[],
  ): Map<number, T> {
    return new Map(rows.map((r) => [parseInt(r.bucket, 10), r]));
  }

  /** Fill energy and charge bucket arrays from maps keyed by bucket index. */
  private fillBuckets<
    E extends {
      solarProductionWh: number;
      solarWh: number;
      gridWh: number;
      totalWh: number;
      costCents: number;
      solarSavingsCents: number;
    },
    C extends {
      solarWh: number;
      gridWh: number;
      awayWh: number;
      totalWh: number;
      costCents: number;
    },
  >(
    start: number,
    count: number,
    labelFn: (key: number) => string,
    energyMap: Map<number, E>,
    chargeMap: Map<number, C>,
  ): { energyBuckets: EnergyBucket[]; buckets: StatsBucket[] } {
    const keys = Array.from({ length: count }, (_, i) => start + i);
    const energyBuckets: EnergyBucket[] = keys.map((key) => {
      const label = labelFn(key);
      const e = energyMap.get(key);
      return {
        label,
        solarProductionWh: e?.solarProductionWh ?? 0,
        solarWh: e?.solarWh ?? 0,
        gridWh: e?.gridWh ?? 0,
        totalWh: e?.totalWh ?? 0,
        costCents: e?.costCents ?? 0,
        solarSavingsCents: e?.solarSavingsCents ?? 0,
      };
    });
    const buckets: StatsBucket[] = keys.map((key) => {
      const label = labelFn(key);
      const v = chargeMap.get(key);
      return {
        label,
        solarWh: v?.solarWh ?? 0,
        gridWh: v?.gridWh ?? 0,
        awayWh: v?.awayWh ?? 0,
        totalWh: v?.totalWh ?? 0,
        costCents: v?.costCents ?? 0,
      };
    });
    return { energyBuckets, buckets };
  }

  /** Sum solarSavingsCents across rows (energy + charge). */
  private sumSolarSavings(
    ...rowSets: ReadonlyArray<ReadonlyArray<{ solarSavingsCents: number }>>
  ): number {
    return rowSets
      .flatMap((rows) => rows)
      .reduce((total, row) => total + row.solarSavingsCents, 0);
  }

  /** Build monthly solar production line — 4 points per day (6-hour quarters). */
  private buildMonthlySolarLine(
    solarRows: ReadonlyArray<
      { day: number; quarter: number; solarProductionWh: number }
    >,
    numDays: number,
  ): SolarProductionPoint[] {
    const solarMap = new Map(
      solarRows.map((r) => [`${r.day}-${r.quarter}`, r]),
    );
    const line: SolarProductionPoint[] = Array.from(
      { length: numDays },
      (_, di) => di + 1,
    ).flatMap((d) =>
      Array.from({ length: 4 }, (_, q) => {
        const s = solarMap.get(`${d}-${q}`);
        return {
          x: d + q * 0.25,
          solarProductionKwh: Math.round(
            ((s?.solarProductionWh ?? 0) * 4 / 1000) * 100,
          ) / 100,
        };
      })
    );
    return line;
  }

  /** Build yearly solar production line — 1 point per week (weeks 0-52). */
  private buildYearlySolarLine(
    solarRows: ReadonlyArray<
      { week: number; solarProductionWh: number }
    >,
  ): SolarProductionPoint[] {
    const solarMap = new Map(solarRows.map((r) => [r.week, r]));
    const line: SolarProductionPoint[] = Array.from(
      { length: 53 },
      (_, w) => {
        const s = solarMap.get(w);
        return {
          // Map week 0-52 to month position 1-12
          x: 1 + (w / 52) * 11,
          solarProductionKwh: Math.round(
            ((s?.solarProductionWh ?? 0) * (52 / 12) / 1000) * 100,
          ) / 100,
        };
      },
    );
    return line;
  }

  /** Convert a timestamp like "2026-03-01 10:30:00" to a bucket index. */
  private timestampToBucket(
    timestamp: string,
    resolution: "1h" | "15m",
  ): number {
    const timePart = timestamp.split(" ")[1] ?? "00:00:00";
    const [hh, mm] = timePart.split(":").map(Number);
    return resolution === "15m" ? hh * 4 + Math.floor(mm / 15) : hh;
  }

  /** Map vehicle poll logs to bucket-indexed SoC snapshots.
   *  For each bucket, takes the latest poll log entry for each vehicle
   *  at or before the bucket's end time. */
  private buildVehicleSocBuckets(
    pollLogs: Array<{
      vehicleId: string;
      vehicleName: string;
      batteryLevel: number;
      timestamp: string;
    }>,
    bucketCount: number,
    resolution: "1h" | "15m",
  ): VehicleSocSnapshot[][] {
    if (pollLogs.length === 0) return [];

    const logsWithBucket = pollLogs.map((log) => ({
      ...log,
      bucket: this.timestampToBucket(log.timestamp, resolution),
    }));

    // Group logs by bucket — mutate the reduce accumulator (O(N))
    const logsByBucket = logsWithBucket.reduce<
      Record<number, typeof logsWithBucket>
    >(
      (acc, log) => {
        (acc[log.bucket] ??= []).push(log);
        return acc;
      },
      {},
    );

    type VehicleState = Record<
      string,
      { vehicleName: string; batteryLevel: number }
    >;

    // Thread `latest` forward through buckets, snapshotting per bucket
    const { buckets } = Array.from({ length: bucketCount }).reduce<{
      latest: VehicleState;
      buckets: VehicleSocSnapshot[][];
    }>(
      ({ latest, buckets }, _, i) => {
        const bucketLogs = logsByBucket[i] ?? [];

        // Fold bucket logs into the running latest-state via nested reduce
        const nextLatest = bucketLogs.reduce<VehicleState>(
          (state, log) => {
            state[log.vehicleId] = {
              vehicleName: log.vehicleName,
              batteryLevel: log.batteryLevel,
            };
            return state;
          },
          latest,
        );

        buckets.push(
          Object.entries(nextLatest).map(([vehicleId, info]) => ({
            vehicleId,
            vehicleName: info.vehicleName,
            batteryLevel: info.batteryLevel,
          })),
        );

        return { latest: nextLatest, buckets };
      },
      { latest: {}, buckets: [] },
    );

    return buckets;
  }

  /** Load currency config from the database. */
  private async getCurrencyConfig(): Promise<
    { currencySymbol: string; currencyCode: string }
  > {
    const [symbol, code] = await Promise.all([
      this.db.getConfig("currency_symbol"),
      this.db.getConfig("currency_code"),
    ]);
    return {
      currencySymbol: symbol ?? "$",
      currencyCode: code ?? "AUD",
    };
  }

  /** Build tariff breakdown entries by matching rates to tariff period labels. */
  private async buildTariffBreakdown(
    startDate: string,
    endDate: string,
    tzOffsetHours: number,
  ): Promise<TariffBreakdownEntry[]> {
    const [rateRows, periods, defaultRateStr, currencySymbolStr] = await Promise
      .all([
        this.db.stats.getTariffBreakdown(
          startDate,
          endDate,
          tzOffsetHours,
        ),
        this.db.getTariffPeriods(),
        this.db.getConfig("default_rate_per_kwh"),
        this.db.getConfig("currency_symbol"),
      ]);
    const currencySymbol = currencySymbolStr ?? "$";

    if (rateRows.length === 0) return [];

    // Build a map of rate → label from tariff periods
    const defaultRate = defaultRateStr ? parseFloat(defaultRateStr) : 0;
    const rateToLabel = new Map<number, string>(
      periods
        .filter((p) => p.enabled)
        .map((p) => [p.ratePerKwh, p.label]),
    );

    return rateRows.map((row) => {
      const knownLabel = rateToLabel.get(row.ratePerKwh);
      const fallbackLabel = row.ratePerKwh === defaultRate
        ? "Default"
        : `${currencySymbol}${row.ratePerKwh}/kWh`;
      return {
        label: knownLabel ?? fallbackLabel,
        ratePerKwh: row.ratePerKwh,
        gridWh: row.gridWh,
        costCents: row.costCents,
      };
    });
  }

  /** Compute home energy totals from energy buckets. */
  private computeEnergyTotals(energyBuckets: EnergyBucket[]) {
    const homeSolarProductionWh = energyBuckets.reduce(
      (s, b) => s + b.solarProductionWh,
      0,
    );
    const homeSolarWh = energyBuckets.reduce(
      (s, b) => s + b.solarWh,
      0,
    );
    const homeGridWh = energyBuckets.reduce(
      (s, b) => s + b.gridWh,
      0,
    );
    const homeConsumedWh = energyBuckets.reduce(
      (s, b) => s + b.totalWh,
      0,
    );
    const homeSelfPoweredPercent = homeConsumedWh > 0
      ? Math.round((homeSolarWh / homeConsumedWh) * 100)
      : 0;
    return {
      homeSolarProductionWh,
      homeSolarWh,
      homeGridWh,
      homeConsumedWh,
      homeSelfPoweredPercent,
    };
  }

  /** Compute vehicle charging totals from charge buckets. */
  private computeChargeTotals(buckets: StatsBucket[]) {
    const totalSolarWh = buckets.reduce(
      (s, b) => s + b.solarWh,
      0,
    );
    const totalGridWh = buckets.reduce(
      (s, b) => s + b.gridWh,
      0,
    );
    const totalAwayWh = buckets.reduce(
      (s, b) => s + b.awayWh,
      0,
    );
    const totalChargedWh = buckets.reduce(
      (s, b) => s + b.totalWh,
      0,
    );
    // selfPoweredPercent is based on home charging only (away excluded)
    const homeChargeTotal = totalSolarWh + totalGridWh;
    const selfPoweredPercent = homeChargeTotal > 0
      ? Math.round((totalSolarWh / homeChargeTotal) * 100)
      : 0;
    const totalCostCents = buckets.reduce(
      (s, b) => s + (b.costCents ?? 0),
      0,
    );
    return {
      totalSolarWh,
      totalGridWh,
      totalAwayWh,
      totalChargedWh,
      selfPoweredPercent,
      totalCostCents,
    };
  }

  private buildResponse(
    period: StatsResponse["period"],
    startDate: string,
    endDate: string,
    energyBuckets: EnergyBucket[],
    buckets: StatsBucket[],
    solarProductionLine: SolarProductionPoint[],
    costInfo: CostInfo,
  ): StatsResponse {
    const energy = this.computeEnergyTotals(energyBuckets);
    const charge = this.computeChargeTotals(buckets);

    const response: StatsResponse = {
      period,
      startDate,
      endDate,
      energyBuckets,
      ...energy,
      solarProductionLine,
      buckets,
      ...charge,
      solarSavingsCents: costInfo.solarSavingsCents,
      evSolarSavingsCents: costInfo.evSolarSavingsCents,
      currencySymbol: costInfo.currencySymbol,
      currencyCode: costInfo.currencyCode,
    };

    if (costInfo.tariffBreakdown && costInfo.tariffBreakdown.length > 0) {
      response.tariffBreakdown = costInfo.tariffBreakdown;
    }

    return response;
  }
}
