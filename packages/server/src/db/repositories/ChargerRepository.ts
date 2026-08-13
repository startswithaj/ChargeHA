import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { asc, eq } from "drizzle-orm";
import { chargers } from "../Schema.ts";
import type { ChargerRow, UpsertChargerInput } from "../types.ts";
import type { ChargerKind, ChargingPointMode } from "@chargeha/shared";

type ChargerRecord = typeof chargers.$inferSelect;

export interface ChargerSecretsRecord {
  value: string;
  isEncrypted: boolean;
}

function toChargerRow(row: ChargerRecord): ChargerRow {
  return {
    id: row.id,
    name: row.name,
    chargerAdapterType: row.chargerAdapterType,
    chargerConfig: row.chargerConfig,
    mode: row.mode as ChargingPointMode,
    kind: row.kind as ChargerKind,
    priority: row.priority,
    vehicleId: row.vehicleId,
    active: row.active === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toColumns(input: UpsertChargerInput) {
  const { active, ...rest } = input;
  return active === undefined ? rest : { ...rest, active: active ? 1 : 0 };
}

export class ChargerRepository {
  constructor(private db: BetterSQLite3Database) {}

  async getChargers(): Promise<ChargerRow[]> {
    const rows = await this.db.select().from(chargers)
      .orderBy(asc(chargers.priority));
    return rows.map(toChargerRow);
  }

  async getCharger(id: string): Promise<ChargerRow | null> {
    const rows = await this.db.select().from(chargers)
      .where(eq(chargers.id, id));
    const row = rows[0];
    return row ? toChargerRow(row) : null;
  }

  async upsertCharger(input: UpsertChargerInput): Promise<void> {
    const values = toColumns(input);
    await this.db.insert(chargers)
      .values(values)
      .onConflictDoUpdate({
        target: chargers.id,
        set: { ...values, updatedAt: new Date().toISOString() },
      });
  }

  async insertCharger(
    input: UpsertChargerInput & {
      chargerSecrets: string;
      chargerSecretsEncrypted: boolean;
    },
  ): Promise<void> {
    const { chargerSecrets, chargerSecretsEncrypted, ...rest } = input;
    await this.db.insert(chargers).values({
      ...toColumns(rest),
      chargerSecrets,
      chargerSecretsEncrypted: chargerSecretsEncrypted ? 1 : 0,
    });
  }

  async updateChargerMode(id: string, mode: ChargingPointMode): Promise<void> {
    await this.db.update(chargers)
      .set({ mode, updatedAt: new Date().toISOString() })
      .where(eq(chargers.id, id));
  }

  async updateChargerPriority(id: string, priority: number): Promise<void> {
    await this.db.update(chargers)
      .set({ priority, updatedAt: new Date().toISOString() })
      .where(eq(chargers.id, id));
  }

  async updateChargerActive(id: string, active: boolean): Promise<void> {
    await this.db.update(chargers)
      .set({ active: active ? 1 : 0, updatedAt: new Date().toISOString() })
      .where(eq(chargers.id, id));
  }

  async updateChargerVehicleId(
    id: string,
    vehicleId: string | null,
  ): Promise<void> {
    await this.db.update(chargers)
      .set({ vehicleId, updatedAt: new Date().toISOString() })
      .where(eq(chargers.id, id));
  }

  async deleteCharger(id: string): Promise<void> {
    await this.db.delete(chargers).where(eq(chargers.id, id));
  }

  async resequencePriorities(): Promise<void> {
    const rows = await this.getChargers();
    await rows.reduce(
      (chain, row, i) =>
        chain.then(() => this.updateChargerPriority(row.id, i + 1)),
      Promise.resolve(),
    );
  }

  async getChargerConfigJson(id: string): Promise<string | null> {
    const rows = await this.db.select({ value: chargers.chargerConfig })
      .from(chargers).where(eq(chargers.id, id));
    return rows[0]?.value ?? null;
  }

  async setChargerConfigJson(id: string, json: string): Promise<void> {
    await this.db.update(chargers)
      .set({ chargerConfig: json, updatedAt: new Date().toISOString() })
      .where(eq(chargers.id, id));
  }

  async getChargerSecretsRecord(
    id: string,
  ): Promise<ChargerSecretsRecord | null> {
    const rows = await this.db.select({
      value: chargers.chargerSecrets,
      isEncrypted: chargers.chargerSecretsEncrypted,
    }).from(chargers).where(eq(chargers.id, id));
    const row = rows[0];
    return row
      ? { value: row.value, isEncrypted: row.isEncrypted === 1 }
      : null;
  }

  async setChargerSecretsRecord(
    id: string,
    value: string,
    isEncrypted: boolean,
  ): Promise<void> {
    await this.db.update(chargers)
      .set({
        chargerSecrets: value,
        chargerSecretsEncrypted: isEncrypted ? 1 : 0,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(chargers.id, id));
  }
}
