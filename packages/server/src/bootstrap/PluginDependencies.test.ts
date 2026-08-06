// Per-charger config exists so a plugin can drive more than one device. The
// load-bearing behaviour is the read fallback: a charger configured before
// per-charger storage existed has only plugin-global values, and must keep
// working without a migration. Writes always go to the scoped key, so a
// charger migrates itself the first time it is saved.
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { PluginDependencies } from "./PluginDependencies.ts";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { ChargerRow } from "../db/types.ts";

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
    { config = {}, secrets = {}, chargers = [] }: {
      config?: Record<string, string>;
      secrets?: Record<string, string>;
      chargers?: ChargerRow[];
    },
  ) => {
    const store = { ...config };
    const secretStore = { ...secrets };
    return {
      store,
      secretStore,
      db: {
        getPluginConfig: (key: string) => Promise.resolve(store[key] ?? null),
        setPluginConfig: (key: string, value: string | null) => {
          if (value === null) delete store[key];
          else store[key] = value;
          return Promise.resolve();
        },
        readSecret: (key: string) => Promise.resolve(secretStore[key] ?? null),
        storeSecret: (key: string, value: string | null) => {
          if (value === null) delete secretStore[key];
          else secretStore[key] = value;
          return Promise.resolve();
        },
        getChargers: () => Promise.resolve(chargers),
      } as unknown as AppDatabase,
    };
  };

  const build = (fake: ReturnType<typeof fakeDb>) =>
    PluginDependencies.create({
      db: fake.db,
      vehicleManager: {} as never,
      chargingPoints: {} as never,
      energyManager: {} as never,
      tunnel: {} as never,
      geocode: () => Promise.resolve({} as never),
      encryptionConfigured: () => false,
      pluginId: "ocpp",
    });

  it("reads the scoped value when one is stored", async () => {
    const fake = fakeDb({
      config: {
        "ocpp.charger.row-1.charger_id": "charger-a",
        "ocpp.charger_id": "legacy",
      },
    });
    const scoped = build(fake).forCharger("row-1");
    expect(await scoped.getConfig("charger_id")).toBe("charger-a");
  });

  it("falls back to the plugin-wide value, so no migration is needed", async () => {
    const fake = fakeDb({ config: { "ocpp.charger_id": "legacy" } });
    const scoped = build(fake).forCharger("row-1");
    expect(await scoped.getConfig("charger_id")).toBe("legacy");
  });

  it("writes scoped, leaving the plugin-wide value untouched", async () => {
    const fake = fakeDb({ config: { "ocpp.charger_id": "legacy" } });
    await build(fake).forCharger("row-1").setConfig("charger_id", "charger-a");
    expect(fake.store["ocpp.charger.row-1.charger_id"]).toBe("charger-a");
    expect(fake.store["ocpp.charger_id"]).toBe("legacy");
  });

  it("keeps two chargers' values apart", async () => {
    const fake = fakeDb({});
    const deps = build(fake);
    await deps.forCharger("row-1").setConfig("max_amps", "32");
    await deps.forCharger("row-2").setConfig("max_amps", "16");
    expect(await deps.forCharger("row-1").getConfig("max_amps")).toBe("32");
    expect(await deps.forCharger("row-2").getConfig("max_amps")).toBe("16");
  });

  it("scopes secrets too, so they stay on the encrypted path", async () => {
    const fake = fakeDb({});
    await build(fake).forCharger("row-1").setSecret("key", "s3cret");
    // Stored via storeSecret, not as plain plugin config.
    expect(fake.secretStore["ocpp.charger.row-1.key"]).toBe("s3cret");
    expect(fake.store["ocpp.charger.row-1.key"]).toBeUndefined();
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
