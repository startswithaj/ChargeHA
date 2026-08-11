import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { asc, eq } from "drizzle-orm";
import { chargers } from "../Schema.ts";
import type { ChargerRow, UpsertChargerInput } from "../types.ts";
import type { ChargerKind, ChargingPointMode } from "@chargeha/shared";

type ChargerRecord = typeof chargers.$inferSelect;

// Raw contents of the encrypted secrets column, exactly as stored.
export interface ChargerSecretsRecord {
  value: string;
  isEncrypted: boolean;
}

// Map a DB record to the shared row shape. Fields are listed explicitly
// rather than spread: `charger_secrets` and `charger_secrets_encrypted` are on the record and must NOT reach `ChargerRow`, which is serialized to
// the browser by `trpc.charger.list` and handed to plugins. A spread would leak credentials the moment the column was added.
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

  // Upsert a charger row. `charger_secrets` is never in `values`, so an
  // upsert of an existing row leaves the stored secrets untouched.
  async upsertCharger(input: UpsertChargerInput): Promise<void> {
    const values = toColumns(input);
    await this.db.insert(chargers)
      .values(values)
      .onConflictDoUpdate({
        target: chargers.id,
        set: { ...values, updatedAt: new Date().toISOString() },
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

  // Explicit vehicle assignment for a smart charger. `null` clears it,
  // returning resolution to inference — never `""`.
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

  // ---- Row-scoped config / secrets (raw column access) ----
  //
  // These move the column value only. Encryption and JSON parsing are
  // AppDatabase's job — this class has no encryption key, like every other
  // repository.

  // Serialized config JSON for one row, or null when the row is absent.
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

  // Raw secrets column + flag, or null when the row is absent.
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
