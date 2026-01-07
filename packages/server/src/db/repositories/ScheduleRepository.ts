import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { asc, eq, sql } from "drizzle-orm";
import { schedules as schedulesTable } from "../Schema.ts";
import { parseDays } from "../Serialization.ts";
import type { CreateScheduleInput, ScheduleRow } from "../types.ts";

export class ScheduleRepository {
  constructor(private db: BetterSQLite3Database) {}

  private toScheduleRow(
    row: typeof schedulesTable.$inferSelect,
  ): ScheduleRow {
    return {
      ...row,
      days: parseDays(row.daysJson),
      enabled: row.enabled === 1,
    } as unknown as ScheduleRow;
  }

  async getSchedules(): Promise<ScheduleRow[]> {
    const rows = await this.db
      .select()
      .from(schedulesTable)
      .orderBy(asc(schedulesTable.createdAt));
    return rows.map((row) => this.toScheduleRow(row));
  }

  async getSchedule(id: string): Promise<ScheduleRow | null> {
    const rows = await this.db
      .select()
      .from(schedulesTable)
      .where(eq(schedulesTable.id, id));
    if (rows.length === 0) return null;
    return this.toScheduleRow(rows[0]);
  }

  async createSchedule(input: CreateScheduleInput): Promise<void> {
    await this.db.insert(schedulesTable).values({
      id: input.id,
      vehicleId: input.vehicleId,
      scheduleType: input.scheduleType,
      startTime: input.startTime,
      endTime: input.endTime,
      daysJson: JSON.stringify(input.days),
      chargeAmps: input.chargeAmps,
      chargeLimitPct: input.chargeLimitPct,
      enabled: input.enabled !== false ? 1 : 0,
    });
  }

  async updateSchedule(
    id: string,
    input: Partial<Omit<CreateScheduleInput, "id">>,
  ): Promise<void> {
    const set: Record<string, unknown> = {};

    if (input.vehicleId !== undefined) set.vehicleId = input.vehicleId;
    if (input.scheduleType !== undefined) set.scheduleType = input.scheduleType;
    if (input.startTime !== undefined) set.startTime = input.startTime;
    if (input.endTime !== undefined) set.endTime = input.endTime;
    if (input.days !== undefined) set.daysJson = JSON.stringify(input.days);
    if (input.chargeAmps !== undefined) set.chargeAmps = input.chargeAmps;
    if (input.chargeLimitPct !== undefined) {
      set.chargeLimitPct = input.chargeLimitPct;
    }
    if (input.enabled !== undefined) set.enabled = input.enabled ? 1 : 0;

    if (Object.keys(set).length === 0) return;

    set.updatedAt = sql`datetime('now')`;

    await this.db
      .update(schedulesTable)
      .set(set)
      .where(eq(schedulesTable.id, id));
  }

  async deleteSchedule(id: string): Promise<void> {
    await this.db
      .delete(schedulesTable)
      .where(eq(schedulesTable.id, id));
  }

  async deleteSchedulesByVehicle(vehicleId: string): Promise<void> {
    await this.db
      .delete(schedulesTable)
      .where(eq(schedulesTable.vehicleId, vehicleId));
  }
}
