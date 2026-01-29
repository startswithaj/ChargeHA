import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import { AppDatabase } from "../../db/AppDatabase.ts";
import { appRouter } from "../root.ts";
import { createCallerFactory } from "../trpc.ts";
import type { TrpcContext } from "../trpc.ts";
import { TariffService } from "../../services/TariffService.ts";
import type { Logger } from "../../lib/Logger.ts";
import { throwingMock } from "../../test-helpers/throwingMock.ts";

describe("Tariffs tRPC Router", () => {
  type DayCode = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

  const VALID_TARIFF = {
    label: "Off-Peak",
    startTime: "22:00",
    endTime: "06:00",
    days: ["mon", "tue", "wed", "thu", "fri"] as [DayCode, ...DayCode[]],
    ratePerKwh: 15,
  };

  const createCaller = createCallerFactory(appRouter);

  const mockLogger: Logger = {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  } as unknown as Logger;

  let db: AppDatabase;
  let caller: ReturnType<typeof createCaller>;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
    const tariffService = new TariffService(db, mockLogger);
    caller = createCaller(throwingMock<TrpcContext>("TrpcContext", {
      db,
      tariffService,
      logger: mockLogger,
    }));
  });

  afterEach(() => {
    db.close();
  });

  describe("tariff.list", () => {
    it("returns empty periods with default config", async () => {
      const data = await caller.tariff.list();
      expect(data.periods).toEqual([]);
      expect(data.defaultRatePerKwh).toBe(0);
      expect(data.currencySymbol).toBe("$");
      expect(data.currencyCode).toBe("AUD");
    });

    it("returns existing periods", async () => {
      await db.createTariffPeriod({
        label: "Peak",
        startTime: "14:00",
        endTime: "20:00",
        days: ["mon", "tue"],
        ratePerKwh: 45,
      });

      const data = await caller.tariff.list();
      expect(data.periods).toHaveLength(1);
      expect(data.periods[0].label).toBe("Peak");
    });
  });

  describe("tariff.defaultRate", () => {
    it("returns default rate and currency config", async () => {
      const data = await caller.tariff.defaultRate();
      expect(data.ratePerKwh).toBe(0);
      expect(data.currencySymbol).toBe("$");
      expect(data.currencyCode).toBe("AUD");
    });
  });

  describe("tariff.create", () => {
    it("creates a tariff period", async () => {
      const data = await caller.tariff.create(VALID_TARIFF);
      expect(data.period.label).toBe("Off-Peak");
      expect(data.period.startTime).toBe("22:00");
      expect(data.period.endTime).toBe("06:00");
      expect(data.period.days).toEqual(["mon", "tue", "wed", "thu", "fri"]);
      expect(data.period.ratePerKwh).toBe(15);
      expect(data.period.enabled).toBe(true);
    });

    it("accepts zero rate", async () => {
      const data = await caller.tariff.create({
        ...VALID_TARIFF,
        ratePerKwh: 0,
      });
      expect(data.period.ratePerKwh).toBe(0);
    });
  });

  describe("tariff.update", () => {
    it("updates a tariff period", async () => {
      const created = await caller.tariff.create(VALID_TARIFF);
      const data = await caller.tariff.update({
        id: created.period.id,
        label: "Super Off-Peak",
        ratePerKwh: 8,
      });
      expect(data.period.label).toBe("Super Off-Peak");
      expect(data.period.ratePerKwh).toBe(8);
      // Unchanged fields preserved
      expect(data.period.startTime).toBe("22:00");
    });

    it("toggles enabled state", async () => {
      const created = await caller.tariff.create(VALID_TARIFF);
      const data = await caller.tariff.update({
        id: created.period.id,
        enabled: false,
      });
      expect(data.period.enabled).toBe(false);
    });

    it("throws NOT_FOUND for nonexistent period", async () => {
      await expect(
        caller.tariff.update({ id: 999, label: "Test" }),
      ).rejects.toThrow("Tariff period not found");
    });
  });

  describe("tariff.delete", () => {
    it("deletes a tariff period", async () => {
      const created = await caller.tariff.create(VALID_TARIFF);
      const result = await caller.tariff.delete({ id: created.period.id });
      expect(result.success).toBe(true);

      // Verify deleted
      const list = await caller.tariff.list();
      expect(list.periods).toHaveLength(0);
    });

    it("throws NOT_FOUND for nonexistent period", async () => {
      await expect(
        caller.tariff.delete({ id: 999 }),
      ).rejects.toThrow("Tariff period not found");
    });
  });

  describe("tariff.updateDefaultRate", () => {
    it("updates default rate", async () => {
      const data = await caller.tariff.updateDefaultRate({
        ratePerKwh: 30,
      });
      expect(data.ratePerKwh).toBe(30);
    });

    it("updates currency config", async () => {
      const data = await caller.tariff.updateDefaultRate({
        ratePerKwh: 25,
        currencySymbol: "€",
        currencyCode: "EUR",
      });
      expect(data.ratePerKwh).toBe(25);
      expect(data.currencySymbol).toBe("€");
      expect(data.currencyCode).toBe("EUR");
    });
  });

  describe("tariff.currentRate", () => {
    it("returns null when no tariffs configured and default rate is 0", async () => {
      const data = await caller.tariff.currentRate();
      expect(data).toBeNull();
    });

    it("returns default rate when default is set but no periods exist", async () => {
      await db.setConfig("default_rate_per_kwh", "30");

      const data = await caller.tariff.currentRate();
      assertExists(data);
      expect(data.ratePerKwh).toBe(30);
      expect(data.label).toBe("Default");
    });

    it("returns matching period for an all-day all-week period", async () => {
      await db.createTariffPeriod({
        label: "Flat Rate",
        startTime: "00:00",
        endTime: "24:00",
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        ratePerKwh: 25,
      });

      const data = await caller.tariff.currentRate();
      assertExists(data);
      expect(data.ratePerKwh).toBe(25);
      expect(data.label).toBe("Flat Rate");
    });
  });

  describe("tariff.loadPreset", () => {
    it("loads flat rate preset", async () => {
      const data = await caller.tariff.loadPreset({ template: "flat" });
      expect(data.periods).toHaveLength(1);
      expect(data.periods[0].label).toBe("Flat Rate");
      expect(data.periods[0].ratePerKwh).toBe(0.30);
    });

    (["tou", "ev-tou"] as const).forEach((template) => {
      it(`loads ${template} preset`, async () => {
        const data = await caller.tariff.loadPreset({ template });
        expect(data.periods.length).toBeGreaterThan(1);
      });
    });

    it("replaces existing periods when loading preset", async () => {
      await caller.tariff.create(VALID_TARIFF);
      const data = await caller.tariff.loadPreset({ template: "flat" });
      expect(data.periods).toHaveLength(1);
      expect(data.periods[0].label).toBe("Flat Rate");
    });

    it("throws for unknown preset", async () => {
      await expect(
        caller.tariff.loadPreset({ template: "unknown" }),
      ).rejects.toThrow("Unknown preset template");
    });
  });
});
