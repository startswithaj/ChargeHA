import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { EnergyData } from "@chargeha/shared";
import { and, count, desc, gte, lt, lte, sql } from "drizzle-orm";
import { sqliteTimezoneOffset, toSqliteDatetime } from "./sqliteHelpers.ts";
import { energyReadings } from "../Schema.ts";

export class EnergyRepository {
  constructor(private db: BetterSQLite3Database) {}

  async insertEnergyReading(
    realtime: EnergyData,
    ratePerKwh?: number | null,
  ): Promise<void> {
    await this.db.insert(energyReadings).values({
      solarProductionW: realtime.solarProductionW,
      gridPowerW: realtime.gridPowerW,
      homeConsumptionW: realtime.homeConsumptionW,
      batteryPowerW: realtime.batteryPowerW,
      batterySoc: realtime.batterySoc,
      ratePerKwh: ratePerKwh ?? null,
      pollFailed: realtime.pollFailed === true ? 1 : 0,
    });
  }

  async getRecentReadings(
    limit = 60,
  ): Promise<Array<EnergyData & { timestamp: string }>> {
    const rows = await this.db
      .select()
      .from(energyReadings)
      .orderBy(desc(energyReadings.timestamp))
      .limit(limit);

    return rows.map((row) => ({
      timestamp: row.timestamp,
      solarProductionW: row.solarProductionW,
      gridPowerW: row.gridPowerW,
      homeConsumptionW: row.homeConsumptionW,
      batteryPowerW: row.batteryPowerW ?? null,
      batterySoc: row.batterySoc ?? null,
      gridVoltageV: null,
      lastUpdated: row.timestamp,
    })).reverse();
  }

  async getEnergyReadingsPaginated(opts: {
    limit: number;
    offset: number;
    from?: string;
    to?: string;
  }): Promise<{
    rows: Array<{
      id: number;
      timestamp: string;
      solarProductionW: number;
      gridPowerW: number;
      homeConsumptionW: number;
      batteryPowerW: number | null;
      batterySoc: number | null;
      ratePerKwh: number | null;
    }>;
    total: number;
  }> {
    const conditions = [];

    if (opts.from) {
      conditions.push(
        gte(energyReadings.timestamp, toSqliteDatetime(opts.from)),
      );
    }
    if (opts.to) {
      conditions.push(lte(energyReadings.timestamp, toSqliteDatetime(opts.to)));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const countResult = await this.db
      .select({ cnt: count() })
      .from(energyReadings)
      .where(where);
    const total = countResult[0].cnt;

    const rows = await this.db
      .select()
      .from(energyReadings)
      .where(where)
      .orderBy(desc(energyReadings.timestamp))
      .limit(opts.limit)
      .offset(opts.offset);

    return { rows, total };
  }

  async pruneEnergyReadings(retentionDays: number): Promise<void> {
    await this.db
      .delete(energyReadings)
      .where(
        lt(
          energyReadings.timestamp,
          sql`datetime('now', ${`-${retentionDays} days`})`,
        ),
      );
  }

  /** Get today's solar/import/export totals from energy_readings (local day). */
  async getTodayEnergySummary(
    timezone: string,
  ): Promise<{ solarWh: number; gridImportWh: number; gridExportWh: number }> {
    // Compute today's date in the configured timezone using explicit parts
    const now = new Date();
    const fmtOpts: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      ...(timezone ? { timeZone: timezone } : {}),
    };
    const parts = new Intl.DateTimeFormat("en-US", fmtOpts).formatToParts(now);
    const findPart = (type: string): string => {
      const part = parts.find((p) => p.type === type);
      if (!part) throw new Error(`Missing "${type}" in formatted date parts`);
      return part.value;
    };
    const y = findPart("year");
    const m = findPart("month");
    const d = findPart("day");
    const todayStr = `${y}-${m}-${d}`;

    // Compute the UTC offset for converting stored UTC timestamps to local dates
    const tzOffsetHours = timezone
      ? this.getTimezoneOffsetHours(timezone)
      : -(now.getTimezoneOffset() / 60);
    const offset = sqliteTimezoneOffset(tzOffsetHours);

    const rows = await this.db.all<{
      solar_wh: number;
      grid_import_wh: number;
      grid_export_wh: number;
    }>(sql`SELECT
              SUM(solar_production_w * (60.0 / 3600.0)) AS solar_wh,
              SUM(MAX(grid_power_w, 0) * (60.0 / 3600.0)) AS grid_import_wh,
              SUM(MAX(-grid_power_w, 0) * (60.0 / 3600.0)) AS grid_export_wh
            FROM energy_readings
            WHERE date(timestamp, ${offset}) = ${todayStr}`);
    const row = rows[0];
    return {
      solarWh: (row?.solar_wh as number) ?? 0,
      gridImportWh: (row?.grid_import_wh as number) ?? 0,
      gridExportWh: (row?.grid_export_wh as number) ?? 0,
    };
  }

  /** Convert an IANA timezone to a UTC offset in hours. */
  private getTimezoneOffsetHours(timezone: string): number {
    const now = new Date();
    const utc = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
    const local = new Date(
      now.toLocaleString("en-US", { timeZone: timezone }),
    );
    return (local.getTime() - utc.getTime()) / (1000 * 60 * 60);
  }
}
