import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { AppDatabase } from "../../db/AppDatabase.ts";
import type { ControllerLogInput } from "../../db/types.ts";
import { appRouter } from "../root.ts";
import { createCallerFactory } from "../trpc.ts";
import type { TrpcContext } from "../trpc.ts";
import { testable } from "../../test-helpers/Testable.ts";
import { LogService } from "../../services/LogService.ts";
import { throwingMock } from "../../test-helpers/throwingMock.ts";

describe("Logs tRPC Router", () => {
  const createCaller = createCallerFactory(appRouter);

  const sampleEntry: ControllerLogInput = {
    vehicleId: "VIN1",
    vehicleName: "Model 3",
    mode: "auto",
    inputsJson: JSON.stringify({
      energy: { solarProductionW: 5000, gridPowerW: -2000 },
      vehicleState: null,
      config: {},
      activeSchedules: [],
    }),
    checksJson: JSON.stringify([
      { check: "plugged_in", result: "yes" },
      { check: "mode", result: "auto" },
    ]),
    action: "start",
    actionDetail: "Start charging at 12A",
    targetAmps: 12,
    traceId: "test",
  };

  // R1 (audit-flagged): back-dating a controller_logs row needs a sqlite reach-in.
  // Skipped pending public `db.insertControllerLogEntryWithTimestamp` API — see
  // progress.txt US-047 notes.
  const insertLogWithTimestamp = (
    database: AppDatabase,
    entry: typeof sampleEntry,
    timestamp: string,
  ): void => {
    const sqlite = testable(database).sqlite;
    sqlite.prepare(`INSERT INTO controller_logs (
        timestamp, vehicle_id, vehicle_name, mode, inputs_json, checks_json,
        action, action_detail, target_amps
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      timestamp,
      entry.vehicleId,
      entry.vehicleName,
      entry.mode,
      entry.inputsJson,
      entry.checksJson,
      entry.action,
      entry.actionDetail,
      entry.targetAmps,
    );
  };

  let db: AppDatabase;
  let caller: ReturnType<typeof createCaller>;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
    caller = createCaller(throwingMock<TrpcContext>("TrpcContext", {
      db,
      logService: new LogService(db),
    }));
  });

  afterEach(() => {
    db.close();
  });

  describe("log.chargeController", () => {
    it("returns empty list when no logs exist", async () => {
      const data = await caller.log.chargeController({});
      expect(data.logs).toEqual([]);
      expect(data.total).toBe(0);
    });

    it("returns log entries with parsed JSON fields", async () => {
      await db.insertControllerLogEntries([sampleEntry]);

      const data = await caller.log.chargeController({});
      expect(data.logs).toHaveLength(1);
      expect(data.total).toBe(1);

      const log = data.logs[0];
      expect(log.vehicleId).toBe("VIN1");
      expect(log.action).toBe("start");
      expect(log.targetAmps).toBe(12);
      // JSON fields should be parsed objects, not strings
      expect(typeof log.inputs).toBe("object");
      expect(log.inputs?.energy?.solarProductionW).toBe(5000);
      expect(Array.isArray(log.checks)).toBe(true);
      expect(log.checks[0].check).toBe("plugged_in");
    });

    it("filters by vehicleId", async () => {
      await db.insertControllerLogEntries([
        { ...sampleEntry, vehicleId: "VIN_A" },
        { ...sampleEntry, vehicleId: "VIN_B" },
      ]);

      const data = await caller.log.chargeController({
        vehicleId: "VIN_A",
      });
      expect(data.logs).toHaveLength(1);
      expect(data.total).toBe(1);
      expect(data.logs[0].vehicleId).toBe("VIN_A");
    });

    it("paginates with limit and offset", async () => {
      await Array.from({ length: 5 }).reduce(async (prev, _, i) => {
        await prev;
        await db.insertControllerLogEntries([
          { ...sampleEntry, actionDetail: `entry-${i}` },
        ]);
      }, Promise.resolve());

      const data = await caller.log.chargeController({
        limit: 2,
        offset: 0,
      });
      expect(data.logs).toHaveLength(2);
      expect(data.total).toBe(5);
    });

    it("returns only logs within from/to time range", async () => {
      // Stored format matches SQLite's `datetime('now')` output (space separator).
      await insertLogWithTimestamp(db, sampleEntry, "2026-03-01 08:00:00");
      await insertLogWithTimestamp(db, sampleEntry, "2026-03-01 12:00:00");
      await insertLogWithTimestamp(db, sampleEntry, "2026-03-01 18:00:00");

      const data = await caller.log.chargeController({
        from: "2026-03-01T10:00:00.000Z",
        to: "2026-03-01T14:00:00.000Z",
      });
      expect(data.logs).toHaveLength(1);
      expect(data.logs[0].timestamp).toBe("2026-03-01 12:00:00");
      expect(data.total).toBe(1);
    });

    it("filters by action array", async () => {
      await db.insertControllerLogEntries([
        { ...sampleEntry, action: "start" },
        { ...sampleEntry, action: "stop" },
        { ...sampleEntry, action: "adjust_amps" },
        { ...sampleEntry, action: "none" },
      ]);

      const data = await caller.log.chargeController({
        action: ["start", "stop"],
      });
      expect(data.logs).toHaveLength(2);
      const actions = data.logs.map((l) => l.action);
      expect(actions).toContain("start");
      expect(actions).toContain("stop");
    });

    it("combined filters work together", async () => {
      await insertLogWithTimestamp(
        db,
        { ...sampleEntry, vehicleId: "VIN_A", action: "start" },
        "2026-03-01 10:00:00",
      );
      await insertLogWithTimestamp(
        db,
        { ...sampleEntry, vehicleId: "VIN_A", action: "stop" },
        "2026-03-01 12:00:00",
      );
      await insertLogWithTimestamp(
        db,
        { ...sampleEntry, vehicleId: "VIN_B", action: "start" },
        "2026-03-01 11:00:00",
      );

      const data = await caller.log.chargeController({
        vehicleId: "VIN_A",
        from: "2026-03-01T00:00:00.000Z",
        to: "2026-03-01T23:59:59.000Z",
        action: ["start"],
      });
      expect(data.logs).toHaveLength(1);
      expect(data.logs[0].vehicleId).toBe("VIN_A");
      expect(data.logs[0].action).toBe("start");
    });
  });

  describe("log.vehicleUpdates", () => {
    it("returns empty list when no logs exist", async () => {
      const data = await caller.log.vehicleUpdates({});
      expect(data.readings).toEqual([]);
      expect(data.total).toBe(0);
    });

    it("filters by vehicleId", async () => {
      // Insert vehicle update logs via raw SQL using the actual schema columns
      const sqlite = testable(db).sqlite;
      const insertSql =
        `INSERT INTO vehicle_poll_logs (vehicle_id, vehicle_name, is_online, is_plugged_in, is_charging, battery_level, charge_limit, charge_amps, charge_amps_max, charge_power_kw, charger_voltage, energy_added_kwh, minutes_to_full) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      sqlite.prepare(insertSql).run(
        "VIN_A",
        "Car A",
        1,
        1,
        1,
        50,
        90,
        12,
        32,
        2.8,
        240,
        5.0,
        120,
      );
      sqlite.prepare(insertSql).run(
        "VIN_B",
        "Car B",
        1,
        0,
        0,
        80,
        90,
        0,
        32,
        0,
        0,
        0,
        0,
      );

      const data = await caller.log.vehicleUpdates({ vehicleId: "VIN_A" });
      expect(data.readings).toHaveLength(1);
      expect(data.total).toBe(1);
    });
  });

  describe("log.energyReads", () => {
    it("returns empty list when no readings exist", async () => {
      const data = await caller.log.energyReads({});
      expect(data.readings).toEqual([]);
      expect(data.total).toBe(0);
    });
  });
});
