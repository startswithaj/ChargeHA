import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { asc, eq, sql } from "drizzle-orm";
import { tariffPeriods as tariffPeriodsTable } from "../Schema.ts";
import { parseDays } from "../Serialization.ts";
import type { CreateTariffPeriodInput, TariffPeriodRow } from "../types.ts";

export class TariffRepository {
  constructor(private db: BetterSQLite3Database) {}

  private toTariffPeriodRow(
    row: typeof tariffPeriodsTable.$inferSelect,
  ): TariffPeriodRow {
    return {
      ...row,
      days: parseDays(row.days),
      enabled: row.enabled === 1,
    };
  }

  async getTariffPeriods(): Promise<TariffPeriodRow[]> {
    const rows = await this.db
      .select()
      .from(tariffPeriodsTable)
      .orderBy(asc(tariffPeriodsTable.startTime));
    return rows.map((row) => this.toTariffPeriodRow(row));
  }

  async getTariffPeriod(id: number): Promise<TariffPeriodRow | null> {
    const rows = await this.db
      .select()
      .from(tariffPeriodsTable)
      .where(eq(tariffPeriodsTable.id, id));
    if (rows.length === 0) return null;
    return this.toTariffPeriodRow(rows[0]);
  }

  async createTariffPeriod(input: CreateTariffPeriodInput): Promise<number> {
    const result = await this.db
      .insert(tariffPeriodsTable)
      .values({
        label: input.label,
        startTime: input.startTime,
        endTime: input.endTime,
        days: JSON.stringify(input.days),
        ratePerKwh: input.ratePerKwh,
        enabled: input.enabled !== false ? 1 : 0,
      })
      .returning({ id: tariffPeriodsTable.id });
    return result[0].id;
  }

  async updateTariffPeriod(
    id: number,
    input: Partial<CreateTariffPeriodInput>,
  ): Promise<void> {
    const set: Record<string, unknown> = {};

    if (input.label !== undefined) set.label = input.label;
    if (input.startTime !== undefined) set.startTime = input.startTime;
    if (input.endTime !== undefined) set.endTime = input.endTime;
    if (input.days !== undefined) set.days = JSON.stringify(input.days);
    if (input.ratePerKwh !== undefined) {
      set.ratePerKwh = input.ratePerKwh;
    }
    if (input.enabled !== undefined) set.enabled = input.enabled ? 1 : 0;

    if (Object.keys(set).length === 0) return;

    set.updatedAt = sql`datetime('now')`;

    await this.db
      .update(tariffPeriodsTable)
      .set(set)
      .where(eq(tariffPeriodsTable.id, id));
  }

  async deleteTariffPeriod(id: number): Promise<void> {
    await this.db
      .delete(tariffPeriodsTable)
      .where(eq(tariffPeriodsTable.id, id));
  }

  async deleteAllTariffPeriods(): Promise<void> {
    await this.db.delete(tariffPeriodsTable);
  }
}
