import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { AppDatabase } from "@chargeha/server/db";
import { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { VehicleManager } from "@chargeha/server/services/VehicleManager";
import type { ChargingPointManager } from "@chargeha/server/services/ChargingPointManager";
import { throwingMock } from "../../../../server/src/test-helpers/throwingMock.ts";
import { GoodweSemsPlugin } from "./GoodweSemsPlugin.ts";
import { GoodweSemsAdapter } from "./GoodweSemsAdapter.ts";
import { SemsPlusAdapter } from "./semsplus/SemsPlusAdapter.ts";

describe("GoodweSemsPlugin.createAdapter", () => {
  let db: AppDatabase;

  const makeDeps = (): PluginDependencies =>
    PluginDependencies.create({
      db,
      vehicleManager: throwingMock<VehicleManager>("VehicleManager"),
      chargingPoints: throwingMock<ChargingPointManager>(
        "ChargingPointManager",
      ),
      tunnel: {
        getUrl: () => null,
        start: () => Promise.reject(new Error("tunnel not mocked")),
        stop: () => Promise.resolve(),
        getExpiryMinutes: () => null,
      },
      geocode: () => Promise.reject(new Error("geocode not mocked")),
      encryptionConfigured: () => false,
      pluginId: "goodwe_sems",
    });

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
    await db.setPluginConfig("goodwe_sems.account", "owner@example.com");
    await db.setPluginConfig("goodwe_sems.password", "secret123");
    await db.setPluginConfig("goodwe_sems.station_id", "station-1");
  });

  afterEach(() => {
    db.close();
  });

  it("builds the legacy adapter when use_sems_plus is unset", async () => {
    const adapter = await new GoodweSemsPlugin(makeDeps()).createAdapter();
    expect(adapter).toBeInstanceOf(GoodweSemsAdapter);
  });

  it("builds the legacy adapter when use_sems_plus is false", async () => {
    await db.setPluginConfig("goodwe_sems.use_sems_plus", "false");
    const adapter = await new GoodweSemsPlugin(makeDeps()).createAdapter();
    expect(adapter).toBeInstanceOf(GoodweSemsAdapter);
  });

  it("builds the SEMS+ adapter when use_sems_plus is true", async () => {
    await db.setPluginConfig("goodwe_sems.use_sems_plus", "true");
    const adapter = await new GoodweSemsPlugin(makeDeps()).createAdapter();
    expect(adapter).toBeInstanceOf(SemsPlusAdapter);
  });
});
