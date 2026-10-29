import { AppDatabase } from "@chargeha/server/db";
import { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { VehicleManager } from "@chargeha/server/services/VehicleManager";
import type { ChargingPointManager } from "@chargeha/server/services/ChargingPointManager";
import { throwingMock } from "../../../../../server/src/test-helpers/throwingMock.ts";
import { Powerwall2LocalPlugin } from "../Powerwall2LocalPlugin.ts";

export async function pluginHarness() {
  const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
  const db = new AppDatabase(":memory:", key, null);
  await db.init();
  const deps = PluginDependencies.create({
    db,
    pluginId: "powerwall2_local",
    encryptionConfigured: () => true,
    vehicleManager: throwingMock<VehicleManager>("VehicleManager"),
    chargingPoints: throwingMock<ChargingPointManager>("ChargingPointManager"),
    tunnel: {
      getUrl: () => null,
      start: () => Promise.reject(new Error("not mocked")),
      stop: () => Promise.resolve(),
      getExpiryMinutes: () => null,
    },
    geocode: () => Promise.reject(new Error("not mocked")),
  });
  return { db, deps, plugin: new Powerwall2LocalPlugin(deps) };
}
