import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { AppDatabase } from "../db/AppDatabase.ts";
import { EnergyPoller } from "./EnergyPoller.ts";
import { DataRecorder } from "./DataRecorder.ts";
import { TypedEventEmitter } from "./TypedEventEmitter.ts";
import type { EnergyAdapterManager } from "./EnergyAdapterManager.ts";
import type { ChargingPointManager } from "./ChargingPointManager.ts";
import type { VehicleManager } from "./VehicleManager.ts";
import type { TariffService } from "./TariffService.ts";
import { Logger } from "../lib/Logger.ts";
import { testable } from "../test-helpers/Testable.ts";
import { throwingMock } from "../test-helpers/throwingMock.ts";

describe("EnergyPoller — genuine failure observability", () => {
  it("preserves Logs, recorded failure rows and events for a genuine poll error", async () => {
    const message = "Adapter unavailable";
    const db = new AppDatabase(":memory:");

    await db.init();

    const emitter = new TypedEventEmitter();
    const failures: string[] = [];
    emitter.subscribe(
      "energy_poll_failure",
      ({ error }) => failures.push(error),
    );
    const log = new Logger("PollFailureTest", "error");
    const chargingPoints = throwingMock<ChargingPointManager>(
      "ChargingPointManager",
      {
        getChargingLoadW: () => Promise.resolve({ meteredW: 0, unmeteredW: 0 }),
        getChargersWithState: () => Promise.resolve([]),
      },
    );
    const poller = new EnergyPoller(
      throwingMock<EnergyAdapterManager>("EnergyAdapterManager", {
        activePluginId: "test-energy",
        ready: () => Promise.resolve(),
        isRelevantConfigKey: () => false,
        pollIntervalSeconds: () => 10,
        getRealtimeData: () => Promise.reject(new Error(message)),
      }),
      chargingPoints,
      emitter,
      db,
      log,
    );

    await poller.stop();

    const recorder = new DataRecorder(
      db,
      throwingMock<VehicleManager>("VehicleManager"),
      chargingPoints,
      throwingMock<TariffService>("TariffService", {
        resolveCurrentRate: () => Promise.resolve(null),
      }),
      emitter,
      log,
    );

    await recorder.stop();
    try {
      await testable(poller).poll();
      await testable(recorder).record();

      expect(failures).toEqual([message]);
      expect(poller.getRealtimeSnapshot().realtime).toMatchObject({
        pollFailed: true,
        pollError: message,
      });

      const logs = await db.logs.getPluginLogs({
        pluginId: "test-energy",
        limit: 10,
        offset: 0,
      });

      expect(logs.total).toBe(1);
      expect(logs.rows[0].message).toBe("Poll failed: " + message);

      const readings = await db.energy.getEnergyReadingsPaginated({
        limit: 10,
        offset: 0,
      });

      expect(readings.total).toBe(1);
      expect(readings.rows[0].pollFailed).toBe(1);
      expect(readings.rows[0].solarProductionW).toBe(0);
    } finally {
      await recorder.stop();
      await poller.stop();
      db.close();
    }
  });
});
