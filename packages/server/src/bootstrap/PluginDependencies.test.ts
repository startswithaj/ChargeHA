import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertRejects } from "@std/assert";
import { expect } from "@std/expect";
import { PluginDependencies } from "./PluginDependencies.ts";
import { AppDatabase } from "../db/AppDatabase.ts";
import type { AppDatabase as AppDatabaseType } from "../db/AppDatabase.ts";
import type { ChargerRow, UpsertChargerInput } from "../db/types.ts";
import type { ChargingPointManager } from "../services/ChargingPointManager.ts";
import { throwingMock } from "../test-helpers/throwingMock.ts";

describe("PluginDependencies charger scoping", () => {
  const charger = (id: string, adapterType: string): ChargerRow => ({
    id,
    name: id,
    chargerAdapterType: adapterType,
    chargerConfig: "{}",
    mode: "auto",
    priority: 1,
    vehicleId: null,
    kind: "smart",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  /** Minimal stand-in for the slice of AppDatabase these methods touch. */
  const fakeDb = (
    { chargers = [] }: {
      chargers?: ChargerRow[];
    },
  ) => {
    return {
      db: {
        getChargers: () => Promise.resolve(chargers),
      } as unknown as AppDatabaseType,
    };
  };

  const build = (fake: ReturnType<typeof fakeDb>) =>
    PluginDependencies.create({
      db: fake.db,
      vehicleManager: {} as never,
      chargingPoints: {} as never,
      tunnel: {} as never,
      geocode: () => Promise.resolve({} as never),
      encryptionConfigured: () => false,
      pluginId: "ocpp",
    });

  it("returns only this plugin's charger rows", async () => {
    const fake = fakeDb({
      chargers: [
        charger("row-1", "ocpp"),
        charger("row-2", "tapo"),
        charger("row-3", "ocpp"),
      ],
    });
    const rows = await build(fake).getChargerRows();
    expect(rows.map((r) => r.id)).toEqual(["row-1", "row-3"]);
  });
});

describe("PluginDependencies row-scoped config/secrets (real AppDatabase)", () => {
  const TEST_KEY = btoa(String.fromCharCode(...new Uint8Array(32)));

  const upsertInput = (
    id: string,
    adapterType: string,
  ): UpsertChargerInput => ({
    id,
    name: id,
    chargerAdapterType: adapterType,
    chargerConfig: "{}",
    mode: "auto",
    priority: 1,
    vehicleId: null,
  });

  const build = (db: AppDatabaseType, pluginId: string) =>
    PluginDependencies.create({
      db,
      vehicleManager: {} as never,
      chargingPoints: {} as never,
      tunnel: {} as never,
      geocode: () => Promise.resolve({} as never),
      encryptionConfigured: () => true,
      pluginId,
    });

  let db: AppDatabase;

  beforeEach(async () => {
    db = new AppDatabase(":memory:", TEST_KEY);
    await db.init();
    await db.chargers.upsertCharger(upsertInput("row-a", "tapo"));
    await db.chargers.upsertCharger(upsertInput("row-b", "tapo"));
    await db.chargers.upsertCharger(upsertInput("row-other", "ocpp"));
  });

  afterEach(() => {
    db.close();
  });

  it("resolveChargerConfig returns config + decrypted secrets for an owned row", async () => {
    await db.patchChargerConfig("row-a", { host: "10.0.0.1" });
    await db.patchChargerSecrets("row-a", { password: "hunter2" });
    const deps = build(db, "tapo");
    const resolved = await deps.resolveChargerConfig("row-a");
    expect(resolved.config.host).toBe("10.0.0.1");
    expect(resolved.secrets.password).toBe("hunter2");
  });

  it("resolveChargerConfig throws for a row belonging to another plugin", async () => {
    const deps = build(db, "tapo");
    await assertRejects(
      () => deps.resolveChargerConfig("row-other"),
      Error,
      "does not belong to plugin",
    );
  });

  it("resolveChargerConfig throws for an unknown row id", async () => {
    const deps = build(db, "tapo");
    await assertRejects(
      () => deps.resolveChargerConfig("row-nonexistent"),
      Error,
      "does not belong to plugin",
    );
  });

  it("resolveChargerConfigs returns exactly this plugin's rows, each with distinct config", async () => {
    await db.patchChargerConfig("row-a", { host: "10.0.0.1" });
    await db.patchChargerConfig("row-b", { host: "10.0.0.2" });
    const deps = build(db, "tapo");
    const entries = await deps.resolveChargerConfigs();
    expect(entries.map((e) => e.row.id).sort()).toEqual(["row-a", "row-b"]);
    const byId = new Map(entries.map((e) => [e.row.id, e.config.host]));
    expect(byId.get("row-a")).toBe("10.0.0.1");
    expect(byId.get("row-b")).toBe("10.0.0.2");
  });

  it("patchChargerConfig sets a key, leaving a differently-set key intact", async () => {
    const deps = build(db, "tapo");
    await deps.patchChargerConfig("row-a", { host: "10.0.0.1" });
    await deps.patchChargerConfig("row-a", { email: "a@example.com" });
    const { config } = await deps.resolveChargerConfig("row-a");
    expect(config.host).toBe("10.0.0.1");
    expect(config.email).toBe("a@example.com");
  });

  it("patchChargerConfig(id, { k: null }) removes the key rather than storing ''", async () => {
    const deps = build(db, "tapo");
    await deps.patchChargerConfig("row-a", { host: "10.0.0.1" });
    await deps.patchChargerConfig("row-a", { host: null });
    const { config } = await deps.resolveChargerConfig("row-a");
    expect("host" in config).toBe(false);
  });

  it("patchChargerSecrets round-trips through resolveChargerConfig().secrets and stays out of config", async () => {
    const deps = build(db, "tapo");
    await deps.patchChargerSecrets("row-a", { password: "hunter2" });
    const { config, secrets } = await deps.resolveChargerConfig("row-a");
    expect(secrets.password).toBe("hunter2");
    expect("password" in config).toBe(false);
  });

  it("patchChargerConfig throws for a row of another plugin", async () => {
    const deps = build(db, "tapo");
    await assertRejects(
      () => deps.patchChargerConfig("row-other", { host: "x" }),
      Error,
      "does not belong to plugin",
    );
  });

  it("patchChargerSecrets throws for a row of another plugin", async () => {
    const deps = build(db, "tapo");
    await assertRejects(
      () => deps.patchChargerSecrets("row-other", { password: "x" }),
      Error,
      "does not belong to plugin",
    );
  });

  it("writing row A's config does not alter row B's", async () => {
    const deps = build(db, "tapo");
    await deps.patchChargerConfig("row-a", { host: "10.0.0.1" });
    await deps.patchChargerConfig("row-b", { host: "10.0.0.2" });
    const [a, b] = await Promise.all([
      deps.resolveChargerConfig("row-a"),
      deps.resolveChargerConfig("row-b"),
    ]);
    expect(a.config.host).toBe("10.0.0.1");
    expect(b.config.host).toBe("10.0.0.2");
  });

  it("rebuildCharger delegates to chargingPoints.rebuildMiddlewareFor for an owned row", async () => {
    let rebuiltId: string | null = null;
    const deps = PluginDependencies.create({
      db,
      vehicleManager: {} as never,
      chargingPoints: throwingMock<ChargingPointManager>(
        "ChargingPointManager",
        {
          rebuildMiddlewareFor: (id: string) => {
            rebuiltId = id;
            return Promise.resolve();
          },
        },
      ),
      tunnel: {} as never,
      geocode: () => Promise.resolve({} as never),
      encryptionConfigured: () => true,
      pluginId: "tapo",
    });

    await deps.rebuildCharger("row-a");

    expect(rebuiltId).toBe("row-a");
  });

  it("rebuildCharger throws for a row of another plugin, without rebuilding", async () => {
    let rebuilt = false;
    const deps = PluginDependencies.create({
      db,
      vehicleManager: {} as never,
      chargingPoints: throwingMock<ChargingPointManager>(
        "ChargingPointManager",
        {
          rebuildMiddlewareFor: () => {
            rebuilt = true;
            return Promise.resolve();
          },
        },
      ),
      tunnel: {} as never,
      geocode: () => Promise.resolve({} as never),
      encryptionConfigured: () => true,
      pluginId: "tapo",
    });

    await assertRejects(
      () => deps.rebuildCharger("row-other"),
      Error,
      "does not belong to plugin",
    );
    expect(rebuilt).toBe(false);
  });

  it("createChargerRow delegates to chargingPoints.createChargerForType, stamped with this plugin's id", async () => {
    let seenAdapterType: string | null = null;
    const createdRow: ChargerRow = {
      id: "row-new",
      name: "New Tapo",
      chargerAdapterType: "tapo",
      chargerConfig: "{}",
      mode: "auto",
      priority: 1,
      vehicleId: null,
      kind: "smart",
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const deps = PluginDependencies.create({
      db,
      vehicleManager: {} as never,
      chargingPoints: throwingMock<ChargingPointManager>(
        "ChargingPointManager",
        {
          createChargerForType: (adapterType: string) => {
            seenAdapterType = adapterType;
            return Promise.resolve(createdRow);
          },
        },
      ),
      tunnel: {} as never,
      geocode: () => Promise.resolve({} as never),
      encryptionConfigured: () => true,
      pluginId: "tapo",
    });

    const row = await deps.createChargerRow();

    expect(seenAdapterType).toBe("tapo");
    expect(row.id).toBe("row-new");
  });
});
