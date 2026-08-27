import { describe, it } from "@std/testing/bdd";
import { assertRejects } from "@std/assert";
import { expect } from "@std/expect";
import { FakeTime } from "@std/testing/time";
import { Logger } from "@chargeha/server/lib/Logger";
import { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { ChargerRow } from "@chargeha/shared";
import type { ResolvedChargerRow } from "@chargeha/shared/plugins";
import { throwingMock } from "../../../../server/src/test-helpers/throwingMock.ts";
import { OcppChargerPlugin } from "./OcppChargerPlugin.ts";

describe("OCPP charger plugin", () => {
  const log = new Logger("OcppTest", "error");
  const dbLog = new PluginDbLogger(() => Promise.resolve(), log);

  const rowFor = (id: string, name: string): ChargerRow => ({
    id,
    name,
    chargerAdapterType: "ocpp",
    chargerConfig: "{}",
    mode: "auto",
    priority: 1,
    vehicleId: null,
    kind: "smart",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  const ROW = rowFor("row-1", "Test OCPP");

  describe("createChargerMiddleware", () => {
    it("throws 'OCPP charge point id not configured' when config.charger_id is absent", async () => {
      const plugin = new OcppChargerPlugin(
        throwingMock<PluginDependencies>("PluginDependencies", { log, dbLog }),
      );
      await assertRejects(
        () => plugin.createChargerMiddleware(ROW, { config: {}, secrets: {} }),
        Error,
        "OCPP charge point id not configured",
      );
    });
  });

  describe("getHealthChecks", () => {
    it("names only the disconnected row when one of two is connected past the grace", async () => {
      // The banner shares the card's disconnect grace, so the check only
      // reports once the window has lapsed — FakeTime steps past it.
      using time = new FakeTime();
      const rowA = rowFor("row-a", "Connected Charger");
      const rowB = rowFor("row-b", "Disconnected Charger");
      const plugin = new OcppChargerPlugin(
        throwingMock<PluginDependencies>("PluginDependencies", {
          log,
          dbLog,
          resolveChargerConfigs: () =>
            Promise.resolve([
              { row: rowA, config: { charger_id: "cp-a" }, secrets: {} },
              { row: rowB, config: { charger_id: "cp-b" }, secrets: {} },
            ] as ResolvedChargerRow[]),
        }),
      );
      // Adopt cp-a via a stub socket so it reports connected; cp-b is left
      // untouched so it stays disconnected.
      const centralSystem = (plugin as unknown as {
        centralSystem: {
          attach: (
            socket: unknown,
            opts: { provisional?: boolean; chargerId?: string },
          ) => void;
        };
      }).centralSystem;
      const stubSocket = {
        close: () => {},
        // Setters only — nothing needs to observe the assigned handlers.
        set onmessage(_v: unknown) {
          // no-op: this stub never receives messages
        },
        set onclose(_v: unknown) {
          // no-op: this stub is never closed by the central system
        },
        set onerror(_v: unknown) {
          // no-op: this stub never errors
        },
      };
      centralSystem.attach(stubSocket, { chargerId: "cp-a" });
      time.tick(121_000);

      const [check] = plugin.getHealthChecks();
      const result = await check.run();
      expect(result.status).toBe("error");
      expect(result.message).toContain("Disconnected Charger");
      expect(result.message).not.toContain("Connected Charger");
    });
  });
});
