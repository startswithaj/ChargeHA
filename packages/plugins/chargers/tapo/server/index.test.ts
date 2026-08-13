import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertRejects } from "@std/assert";
import { expect } from "@std/expect";
import { AppDatabase } from "@chargeha/server/db";
import { Logger } from "@chargeha/server/lib/Logger";
import { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { ChargerRow } from "@chargeha/shared";
import type { ResolvedChargerRow } from "@chargeha/shared/plugins";
import { throwingMock } from "../../../../server/src/test-helpers/throwingMock.ts";
import { startTapoSimulator } from "../../../../../devtools/tapo-simulator/main.ts";
import { TapoChargerPlugin, tapoCredentials } from "./index.ts";

describe("Tapo charger plugin", () => {
  const log = new Logger("TapoTest", "error");
  // Every charger-device call now writes through dbLog too — a no-op
  // persist keeps these tests focused on what they actually assert.
  const dbLog = new PluginDbLogger(() => Promise.resolve(), log);

  const ROW: ChargerRow = {
    id: "row-1",
    name: "Test Tapo",
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

  describe("tapoCredentials", () => {
    it("reports missing host", () => {
      const result = tapoCredentials({ config: {}, secrets: {} });
      expect(result).toEqual({ error: "Tapo host not configured" });
    });

    it("reports missing account credentials when host is present but password is absent", () => {
      const result = tapoCredentials({
        config: { host: "10.0.0.1" },
        secrets: {},
      });
      expect(result).toEqual({
        error: "Tapo account credentials not configured",
      });
    });

    it("reads password from secrets, not config — a password placed in config is not accepted", () => {
      const result = tapoCredentials({
        config: { host: "10.0.0.1", password: "x" },
        secrets: {},
      });
      expect(result).toEqual({
        error: "Tapo account credentials not configured",
      });
    });

    it("succeeds with host+email in config and password in secrets", () => {
      const result = tapoCredentials({
        config: { host: "10.0.0.1", email: "a@example.com" },
        secrets: { password: "hunter2" },
      });
      expect(result).toEqual({
        host: "10.0.0.1",
        email: "a@example.com",
        password: "hunter2",
      });
    });
  });

  describe("createChargerMiddleware", () => {
    const deps = () =>
      throwingMock<PluginDependencies>("PluginDependencies", { log, dbLog });

    it("throws 'Tapo host not configured' when config.host is absent", async () => {
      const plugin = new TapoChargerPlugin(deps());
      await assertRejects(
        () => plugin.createChargerMiddleware(ROW, { config: {}, secrets: {} }),
        Error,
        "Tapo host not configured",
      );
    });

    it("throws 'Tapo account credentials not configured' when password is absent", async () => {
      const plugin = new TapoChargerPlugin(deps());
      await assertRejects(
        () =>
          plugin.createChargerMiddleware(ROW, {
            config: { host: "10.0.0.1" },
            secrets: {},
          }),
        Error,
        "Tapo account credentials not configured",
      );
    });

    it("builds middleware from a full bundle", async () => {
      const plugin = new TapoChargerPlugin(deps());
      const mw = await plugin.createChargerMiddleware(ROW, {
        config: {
          host: "10.0.0.1",
          email: "a@example.com",
          fixed_draw_amps: "12",
        },
        secrets: { password: "hunter2" },
      });
      // Construction only — fixed_draw_amps reaching the adapter is asserted
      // in TapoChargerAdapter.test.ts ("fixed draw amps from config").
      expect(mw).toBeDefined();
      await mw.shutdown();
    });
  });

  describe("two Tapo rows — independent config end to end", () => {
    let db: AppDatabase;

    beforeEach(async () => {
      db = new AppDatabase(":memory:");
      await db.init();
    });

    afterEach(() => {
      db.close();
    });

    it("each row resolves its own host/email/password and builds its own middleware", async () => {
      const rowA: ChargerRow = { ...ROW, id: "row-a", name: "Plug A" };
      const rowB: ChargerRow = { ...ROW, id: "row-b", name: "Plug B" };
      await db.upsertCharger(rowA);
      await db.upsertCharger(rowB);

      await db.setChargerConfig(rowA.id, {
        host: "10.0.0.11",
        email: "a@example.com",
      });
      await db.setChargerSecrets(rowA.id, { password: "password-a" });
      await db.setChargerConfig(rowB.id, {
        host: "10.0.0.22",
        email: "b@example.com",
      });
      await db.setChargerSecrets(rowB.id, { password: "password-b" });

      // Row-scoped storage: each row reads back its own values, not the
      // other row's — this is what the row-scoping refactor is supposed to
      // guarantee at the DB layer.
      const [configA, secretsA, configB, secretsB] = await Promise.all([
        db.getChargerConfig(rowA.id),
        db.getChargerSecrets(rowA.id),
        db.getChargerConfig(rowB.id),
        db.getChargerSecrets(rowB.id),
      ]);
      expect(configA.host).toBe("10.0.0.11");
      expect(secretsA.password).toBe("password-a");
      expect(configB.host).toBe("10.0.0.22");
      expect(secretsB.password).toBe("password-b");

      // Each row's resolved bundle produces its own distinct credentials —
      // tapoCredentials is the function the plugin uses to turn a resolved
      // bundle into the values it connects with.
      const credsA = tapoCredentials({ config: configA, secrets: secretsA });
      const credsB = tapoCredentials({ config: configB, secrets: secretsB });
      expect(credsA).toEqual({
        host: "10.0.0.11",
        email: "a@example.com",
        password: "password-a",
      });
      expect(credsB).toEqual({
        host: "10.0.0.22",
        email: "b@example.com",
        password: "password-b",
      });
      expect(credsA).not.toEqual(credsB);

      // And the plugin builds a middleware from each row's own bundle
      // without throwing — proving construction is per-row, not shared
      // global state left over from a previous row.
      const plugin = new TapoChargerPlugin(
        throwingMock<PluginDependencies>("PluginDependencies", { log, dbLog }),
      );
      const mwA = await plugin.createChargerMiddleware(rowA, {
        config: configA,
        secrets: secretsA,
      });
      const mwB = await plugin.createChargerMiddleware(rowB, {
        config: configB,
        secrets: secretsB,
      });
      expect(mwA).toBeDefined();
      expect(mwB).toBeDefined();
      expect(mwA).not.toBe(mwB);
      await mwA.shutdown();
      await mwB.shutdown();
    });
  });

  describe("getHealthChecks", () => {
    it("reports 'ok' silently for a row with no host configured", async () => {
      const plugin = new TapoChargerPlugin(
        throwingMock<PluginDependencies>("PluginDependencies", {
          log,
          dbLog,
          resolveChargerConfigs: () =>
            Promise.resolve([
              { row: ROW, config: {}, secrets: {} } as ResolvedChargerRow,
            ]),
        }),
      );
      const [check] = plugin.getHealthChecks();
      const result = await check.run();
      expect(result).toEqual({ status: "ok" });
    });

    it("names the failing row and reports 'error' when one of two rows is unreachable", async () => {
      const sim = startTapoSimulator();
      try {
        const reachableRow: ChargerRow = {
          ...ROW,
          id: "row-ok",
          name: "OK Plug",
        };
        const unreachableRow: ChargerRow = {
          ...ROW,
          id: "row-bad",
          name: "Bad Plug",
        };
        const plugin = new TapoChargerPlugin(
          throwingMock<PluginDependencies>("PluginDependencies", {
            log,
            dbLog,
            resolveChargerConfigs: () =>
              Promise.resolve([
                {
                  row: reachableRow,
                  config: {
                    host: `127.0.0.1:${sim.devicePort}`,
                    email: "user@example.com",
                  },
                  secrets: { password: "example-password" },
                },
                {
                  row: unreachableRow,
                  config: { host: "127.0.0.1:1", email: "user@example.com" },
                  secrets: { password: "example-password" },
                },
              ] as ResolvedChargerRow[]),
          }),
        );

        const [check] = plugin.getHealthChecks();
        const result = await check.run();

        expect(result.status).toBe("error");
        expect(result.message).toContain("Bad Plug");
        expect(result.message).not.toContain("OK Plug");
      } finally {
        await sim.stop();
      }
    });
  });
});
