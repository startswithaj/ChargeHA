import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { VehicleMode } from "@chargeha/shared";
import { and, asc, count, desc, eq, gte, lt, lte, max, sql } from "drizzle-orm";
import { sqliteTimezoneOffset, toSqliteDatetime } from "./sqliteHelpers.ts";
import { vehicleChargeReadings, vehicles as vehiclesTable } from "../Schema.ts";
import type {
  UpsertVehicleInput,
  VehicleChargeReadingInput,
  VehicleRow,
} from "../types.ts";

export class VehicleRepository {
  constructor(private db: BetterSQLite3Database) {}

  async getVehicle(id: string): Promise<VehicleRow | null> {
    const rows = await this.db
      .select()
      .from(vehiclesTable)
      .where(eq(vehiclesTable.id, id));
    if (rows.length === 0) return null;
    return rows[0] as VehicleRow;
  }

  async getVehicles(): Promise<VehicleRow[]> {
    const rows = await this.db
      .select()
      .from(vehiclesTable)
      .orderBy(asc(vehiclesTable.priority));
    return rows as VehicleRow[];
  }

  async deleteVehicle(id: string): Promise<void> {
    await this.db.delete(vehiclesTable).where(eq(vehiclesTable.id, id));
  }

  async updateVehicleMode(id: string, mode: VehicleMode): Promise<void> {
    await this.db
      .update(vehiclesTable)
      .set({ mode, updatedAt: sql`datetime('now')` })
      .where(eq(vehiclesTable.id, id));
  }

  async updateVehiclePriority(id: string, priority: number): Promise<void> {
    await this.db
      .update(vehiclesTable)
      .set({ priority, updatedAt: sql`datetime('now')` })
      .where(eq(vehiclesTable.id, id));
  }

  async getNextVehiclePriority(): Promise<number> {
    const result = await this.db
      .select({ m: max(vehiclesTable.priority) })
      .from(vehiclesTable);
    return (result[0].m ?? 0) + 1;
  }

  async resequenceVehiclePriorities(): Promise<void> {
    const vehicles = await this.getVehicles();
    await vehicles.reduce(
      (chain, vehicle, i) =>
        vehicle.priority !== i + 1
          ? chain.then(() => this.updateVehiclePriority(vehicle.id, i + 1))
          : chain,
      Promise.resolve(),
    );
  }

  async upsertVehicle(input: UpsertVehicleInput): Promise<void> {
    await this.db
      .insert(vehiclesTable)
      .values({
        id: input.id,
        name: input.name,
        adapterType: input.adapterType,
        priority: input.priority,
        config: input.config,
        mode: input.mode,
        updatedAt: sql`datetime('now')`,
      })
      .onConflictDoUpdate({
        target: vehiclesTable.id,
        set: {
          name: input.name,
          adapterType: input.adapterType,
          priority: input.priority,
          config: input.config,
          mode: input.mode,
          updatedAt: sql`datetime('now')`,
        },
      });
  }

  async insertVehicleChargeReading(
    reading: VehicleChargeReadingInput,
  ): Promise<void> {
    await this.db.insert(vehicleChargeReadings).values({
      vehicleId: reading.vehicleId,
      chargePowerW: reading.chargePowerW,
      chargeAmps: reading.chargeAmps,
      batteryLevel: reading.batteryLevel,
      solarContributionW: reading.solarContributionW,
      gridContributionW: reading.gridContributionW,
      isHome: reading.isHome ? 1 : 0,
      ratePerKwh: reading.ratePerKwh ?? null,
    });
  }

  async getVehicleChargeReadingsPaginated(opts: {
    limit: number;
    offset: number;
    vehicleId?: string;
    from?: string;
    to?: string;
  }): Promise<{
    rows: Array<{
      id: number;
      timestamp: string;
      vehicleId: string;
      chargePowerW: number;
      chargeAmps: number;
      batteryLevel: number | null;
      solarContributionW: number;
      gridContributionW: number;
      isHome: boolean;
      ratePerKwh: number | null;
    }>;
    total: number;
  }> {
    const conditions = [];

    if (opts.vehicleId) {
      conditions.push(eq(vehicleChargeReadings.vehicleId, opts.vehicleId));
    }
    if (opts.from) {
      conditions.push(
        gte(vehicleChargeReadings.timestamp, toSqliteDatetime(opts.from)),
      );
    }
    if (opts.to) {
      conditions.push(
        lte(vehicleChargeReadings.timestamp, toSqliteDatetime(opts.to)),
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const countResult = await this.db
      .select({ cnt: count() })
      .from(vehicleChargeReadings)
      .where(where);
    const total = countResult[0].cnt;

    const result = await this.db
      .select()
      .from(vehicleChargeReadings)
      .where(where)
      .orderBy(desc(vehicleChargeReadings.timestamp))
      .limit(opts.limit)
      .offset(opts.offset);

    const rows = result.map((row) => ({
      ...row,
      isHome: row.isHome === 1,
    }));

    return { rows, total };
  }

  async pruneVehicleChargeReadings(retentionDays: number): Promise<void> {
    await this.db
      .delete(vehicleChargeReadings)
      .where(
        lt(
          vehicleChargeReadings.timestamp,
          sql`datetime('now', ${`-${retentionDays} days`})`,
        ),
      );
  }

  async getVehicleSocForDay(
    date: string,
    tzOffsetHours: number,
  ): Promise<
    Array<{
      vehicleId: string;
      vehicleName: string;
      batteryLevel: number;
      timestamp: string;
    }>
  > {
    const offset = sqliteTimezoneOffset(tzOffsetHours);

    const rows = await this.db.all<{
      vehicle_id: string;
      vehicle_name: string;
      battery_level: number;
      local_ts: string;
    }>(sql`SELECT vehicle_id, vehicle_name, battery_level,
              datetime(timestamp, ${offset}) AS local_ts
            FROM vehicle_poll_logs
            WHERE date(timestamp, ${offset}) = ${date}
            ORDER BY timestamp ASC`);

    return rows.map((row) => ({
      vehicleId: row.vehicle_id,
      vehicleName: row.vehicle_name,
      batteryLevel: row.battery_level,
      timestamp: row.local_ts,
    }));
  }
}
