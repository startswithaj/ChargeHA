import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertExists } from "@std/assert";
import { expect } from "@std/expect";
import { FakeTime } from "@std/testing/time";
import { AppDatabase } from "../AppDatabase.ts";
import type { UpsertChargerInput } from "../types.ts";

describe("ChargerRepository", () => {
  let db: AppDatabase;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
  });

  afterEach(() => {
    db.close();
  });

  const baseCharger: UpsertChargerInput = {
    id: "CHG1",
    name: "Garage Charger",
    chargerAdapterType: "simulated",
    chargerConfig: "{}",
    mode: "auto",
    priority: 1,
    vehicleId: null,
  };

  describe("upsertCharger", () => {
    it("inserts a new charger", async () => {
      await db.chargers.upsertCharger(baseCharger);

      const charger = await db.chargers.getCharger("CHG1");
      assertExists(charger);
      expect(charger.name).toBe("Garage Charger");
      expect(charger.chargerAdapterType).toBe("simulated");
      expect(charger.mode).toBe("auto");
      expect(charger.priority).toBe(1);
      expect(charger.vehicleId).toBeNull();
    });

    it("updates the existing row on conflict and bumps updatedAt", async () => {
      const fakeTime = new FakeTime();
      try {
        await db.chargers.upsertCharger(baseCharger);
        const inserted = await db.chargers.getCharger("CHG1");
        assertExists(inserted);

        fakeTime.tick(1000);
        await db.chargers.upsertCharger({
          ...baseCharger,
          name: "Renamed Charger",
          mode: "stop",
        });

        const updated = await db.chargers.getCharger("CHG1");
        assertExists(updated);
        expect(updated.name).toBe("Renamed Charger");
        expect(updated.mode).toBe("stop");
        expect(updated.updatedAt).not.toBe(inserted.updatedAt);
      } finally {
        fakeTime.restore();
      }
    });
  });

  describe("getChargers", () => {
    it("returns chargers ordered by priority", async () => {
      await db.chargers.upsertCharger({
        ...baseCharger,
        id: "LOW",
        priority: 10,
      });
      await db.chargers.upsertCharger({
        ...baseCharger,
        id: "HIGH",
        priority: 1,
      });

      const chargers = await db.chargers.getChargers();
      expect(chargers.map((c) => c.id)).toEqual(["HIGH", "LOW"]);
    });
  });

  describe("getCharger", () => {
    it("returns null for a missing charger", async () => {
      expect(await db.chargers.getCharger("MISSING")).toBeNull();
    });
  });

  describe("updateChargerMode", () => {
    it("updates the mode of an existing charger", async () => {
      await db.chargers.upsertCharger(baseCharger);
      await db.chargers.updateChargerMode("CHG1", "charge_now");

      const charger = await db.chargers.getCharger("CHG1");
      assertExists(charger);
      expect(charger.mode).toBe("charge_now");
    });
  });

  describe("updateChargerPriority", () => {
    it("updates the priority of an existing charger", async () => {
      await db.chargers.upsertCharger(baseCharger);
      await db.chargers.updateChargerPriority("CHG1", 7);

      const charger = await db.chargers.getCharger("CHG1");
      assertExists(charger);
      expect(charger.priority).toBe(7);
    });
  });

  describe("deleteCharger", () => {
    it("removes the charger", async () => {
      await db.chargers.upsertCharger(baseCharger);
      await db.chargers.deleteCharger("CHG1");

      expect(await db.chargers.getCharger("CHG1")).toBeNull();
    });
  });

  describe("resequencePriorities", () => {
    it("renumbers 1..n preserving order after a delete", async () => {
      await db.chargers.upsertCharger({
        ...baseCharger,
        id: "C1",
        priority: 3,
      });
      await db.chargers.upsertCharger({
        ...baseCharger,
        id: "C2",
        priority: 1,
      });
      await db.chargers.upsertCharger({
        ...baseCharger,
        id: "C3",
        priority: 2,
      });

      await db.chargers.deleteCharger("C3");
      await db.chargers.resequencePriorities();

      const chargers = await db.chargers.getChargers();
      expect(chargers.map((c) => c.id)).toEqual(["C2", "C1"]);
      expect(chargers.map((c) => c.priority)).toEqual([1, 2]);
    });
  });
});
