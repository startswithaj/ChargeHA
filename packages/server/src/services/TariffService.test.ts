import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import { ServiceError } from "../lib/ServiceError.ts";
import { AppDatabase } from "../db/AppDatabase.ts";
import { TariffService } from "./TariffService.ts";
import { Logger } from "../lib/Logger.ts";

describe("TariffService", () => {
  const testLogger = new Logger("TariffService", "error");
  let db: AppDatabase;
  let tariffService: TariffService;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
    tariffService = new TariffService(db, testLogger);
  });

  afterEach(() => {
    db.close();
  });

  describe("resolveCurrentRate", () => {
    it("returns null when no tariffs configured and default rate is 0", async () => {
      const rate = await tariffService.resolveCurrentRate();
      expect(rate).toBeNull();
    });

    it("returns the default rate when no tariff periods exist", async () => {
      await db.setConfig("default_rate_per_kwh", "25");

      const rate = await tariffService.resolveCurrentRate();
      expect(rate).toBe(25);
    });

    it("returns the matching tariff period rate when periods are configured", async () => {
      await db.createTariffPeriod({
        label: "All Day",
        startTime: "00:00",
        endTime: "24:00",
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        ratePerKwh: 42,
      });

      const rate = await tariffService.resolveCurrentRate();
      expect(rate).toBe(42);
    });

    it("falls back to default rate when no period matches current time", async () => {
      // Create a period on a single day with a very narrow window
      await db.createTariffPeriod({
        label: "Narrow",
        startTime: "03:00",
        endTime: "03:01",
        days: ["mon"],
        ratePerKwh: 99,
      });
      await db.setConfig("default_rate_per_kwh", "15");

      const rate = await tariffService.resolveCurrentRate();
      expect(typeof rate).toBe("number");
      expect(rate).not.toBeNull();
    });

    it("uses configured timezone for tariff lookup, not server local time", async () => {
      const tz = "Australia/Sydney";
      await db.setConfig("timezone", tz);

      await Array.from({ length: 24 }).reduce(async (prev, _, h) => {
        await prev;
        const start = `${String(h).padStart(2, "0")}:00`;
        const end = `${String(h + 1 === 24 ? 0 : h + 1).padStart(2, "0")}:00`;
        await db.createTariffPeriod({
          label: `Hour ${h}`,
          startTime: start,
          endTime: end,
          days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
          ratePerKwh: h,
        });
      }, Promise.resolve());

      const rate = await tariffService.resolveCurrentRate();

      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour: "numeric",
        hour12: false,
      }).formatToParts(new Date());
      const expectedHour = Number(
        parts.find((p) => p.type === "hour")?.value ?? 0,
      );

      expect(rate).toBe(expectedHour);
    });

    it("caches tariff data and reuses it on subsequent calls", async () => {
      await db.setConfig("default_rate_per_kwh", "30");

      const rate1 = await tariffService.resolveCurrentRate();
      expect(rate1).toBe(30);

      await db.setConfig("default_rate_per_kwh", "50");

      const rate2 = await tariffService.resolveCurrentRate();
      expect(rate2).toBe(30);
    });

    it("uses server local time when no timezone is configured", async () => {
      // No timezone set — exercises the fallback branch in getTimezoneTimeParts
      await db.createTariffPeriod({
        label: "All Day",
        startTime: "00:00",
        endTime: "24:00",
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        ratePerKwh: 7,
      });

      const rate = await tariffService.resolveCurrentRate();
      expect(rate).toBe(7);
    });
  });

  describe("getTimezoneTimeParts fallbacks", () => {
    it("falls back to defaults when Intl returns no matching parts", async () => {
      // Mock Intl.DateTimeFormat to return empty parts — exercises the ?? 0 and ?? "" fallbacks
      const OriginalDateTimeFormat = Intl.DateTimeFormat;
      const MockDateTimeFormat = function (
        _locale?: string,
        _options?: Intl.DateTimeFormatOptions,
      ) {
        return {
          formatToParts: () => [
            { type: "literal", value: " " },
          ],
        };
      } as unknown as typeof Intl.DateTimeFormat;
      Object.defineProperty(MockDateTimeFormat, "prototype", {
        value: OriginalDateTimeFormat.prototype,
        writable: false,
      });
      MockDateTimeFormat.supportedLocalesOf =
        OriginalDateTimeFormat.supportedLocalesOf;
      Intl.DateTimeFormat = MockDateTimeFormat;

      try {
        await db.setConfig("timezone", "America/New_York");

        // Force a fresh cache so the tz is picked up
        await db.setConfig("default_rate_per_kwh", "5");

        // Create a new service to start with empty cache
        const svc = new TariffService(db, testLogger);
        const rate = await svc.resolveCurrentRate();
        // hours=0, minutes=0 → currentMinutes=0, weekday="" → fallback to DAY_ABBRS[now.getDay()]
        // Should still return a valid rate (5 from default)
        expect(rate).toBe(5);
      } finally {
        Intl.DateTimeFormat = OriginalDateTimeFormat;
      }
    });
  });

  describe("refreshCache error handling", () => {
    it("logs error and continues when DB query fails", async () => {
      // Close the DB to force an error on refresh
      db.close();

      // Create a new service with the closed DB — resolveCurrentRate should
      // catch the error and return null (cache stays empty)
      const rate = await tariffService.resolveCurrentRate();
      expect(rate).toBeNull();

      // Reopen so afterEach doesn't double-close
      db = new AppDatabase(":memory:");
      await db.init();
    });

    it("caches zero default rate when getConfig returns null", async () => {
      // Stub getConfig to return null — exercises the ?? 0 fallback in refreshCache
      const original = db.getConfig.bind(db);
      db.getConfig = (_key: string) => Promise.resolve(null);

      // Force a fresh cache fill — resolveCurrentRate calls refreshCacheIfStale
      const rate = await tariffService.resolveCurrentRate();
      expect(rate).toBeNull(); // no periods, default rate=0 → null

      db.getConfig = original;
    });
  });

  describe("list", () => {
    it("returns empty periods with default values when nothing configured", async () => {
      const result = await tariffService.list();
      expect(result.periods).toEqual([]);
      expect(result.defaultRatePerKwh).toBe(0);
      expect(result.currencySymbol).toBe("$");
      expect(result.currencyCode).toBe("AUD");
    });

    it("falls back to defaults when getConfig returns null", async () => {
      // Stub getConfig to return null for all keys — exercises ?? fallbacks
      const original = db.getConfig.bind(db);
      db.getConfig = (_key: string) => Promise.resolve(null);

      const result = await tariffService.list();
      expect(result.defaultRatePerKwh).toBe(0);
      expect(result.currencySymbol).toBe("$");
      expect(result.currencyCode).toBe("AUD");

      db.getConfig = original;
    });

    it("returns configured periods and currency", async () => {
      await db.createTariffPeriod({
        label: "Peak",
        startTime: "16:00",
        endTime: "21:00",
        days: ["mon", "tue", "wed", "thu", "fri"],
        ratePerKwh: 0.45,
      });
      await db.setConfig("default_rate_per_kwh", "0.30");
      await db.setConfig("currency_symbol", "€");
      await db.setConfig("currency_code", "EUR");

      const result = await tariffService.list();
      expect(result.periods.length).toBe(1);
      expect(result.periods[0].label).toBe("Peak");
      expect(result.defaultRatePerKwh).toBe(0.30);
      expect(result.currencySymbol).toBe("€");
      expect(result.currencyCode).toBe("EUR");
    });
  });

  describe("getDefaultRate", () => {
    it("returns zero rate and default currency when nothing configured", async () => {
      const result = await tariffService.getDefaultRate();
      expect(result.ratePerKwh).toBe(0);
      expect(result.currencySymbol).toBe("$");
      expect(result.currencyCode).toBe("AUD");
    });

    it("falls back to defaults when getConfig returns null", async () => {
      const original = db.getConfig.bind(db);
      db.getConfig = (_key: string) => Promise.resolve(null);

      const result = await tariffService.getDefaultRate();
      expect(result.ratePerKwh).toBe(0);
      expect(result.currencySymbol).toBe("$");
      expect(result.currencyCode).toBe("AUD");

      db.getConfig = original;
    });

    it("returns configured rate and currency", async () => {
      await db.setConfig("default_rate_per_kwh", "0.25");
      await db.setConfig("currency_symbol", "£");
      await db.setConfig("currency_code", "GBP");

      const result = await tariffService.getDefaultRate();
      expect(result.ratePerKwh).toBe(0.25);
      expect(result.currencySymbol).toBe("£");
      expect(result.currencyCode).toBe("GBP");
    });
  });

  describe("getCurrentRate", () => {
    it("returns null when no periods and default rate is 0", async () => {
      const result = await tariffService.getCurrentRate();
      expect(result).toBeNull();
    });

    it("returns default rate when only default rate is configured", async () => {
      await db.setConfig("default_rate_per_kwh", "0.30");

      const result = await tariffService.getCurrentRate();
      assertExists(result);
      expect(result.ratePerKwh).toBe(0.30);
      expect(result.label).toBe("Default");
      expect(result.currencySymbol).toBe("$");
    });

    it("returns matching period rate and label", async () => {
      await db.createTariffPeriod({
        label: "All Day",
        startTime: "00:00",
        endTime: "24:00",
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        ratePerKwh: 0.42,
      });

      const result = await tariffService.getCurrentRate();
      assertExists(result);
      expect(result.ratePerKwh).toBe(0.42);
      expect(result.label).toBe("All Day");
    });

    it("returns nextRate when a rate change is upcoming", async () => {
      // Create two periods: one covering now, one covering later today
      // Use 00:00 to split so we always know which is active
      const now = new Date();
      const fmt = new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "numeric",
        hour12: false,
      });
      const parts = fmt.formatToParts(now);
      const currentHour = Number(
        parts.find((p) => p.type === "hour")?.value ?? 0,
      );

      // Current period covers from midnight to current hour + 1
      const endHour = currentHour + 1;
      const nextStartHour = endHour;
      // Only set up if there's room in the day for a "next" period
      if (nextStartHour < 23) {
        await db.createTariffPeriod({
          label: "Now Period",
          startTime: "00:00",
          endTime: `${String(endHour).padStart(2, "0")}:00`,
          days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
          ratePerKwh: 0.20,
        });
        await db.createTariffPeriod({
          label: "Later Period",
          startTime: `${String(nextStartHour).padStart(2, "0")}:00`,
          endTime: "23:59",
          days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
          ratePerKwh: 0.50,
        });

        const result = await tariffService.getCurrentRate();
        assertExists(result);
        expect(result.ratePerKwh).toBe(0.20);
        assertExists(result.nextRate);
        expect(result.nextRate.ratePerKwh).toBe(0.50);
        expect(result.nextRate.label).toBe("Later Period");
        expect(result.nextRate.startsAt).toBeTruthy();
      }
    });

    it("returns null nextRate when rate stays constant all day", async () => {
      // Single period covering the entire day + default rate matches, so no change
      await db.createTariffPeriod({
        label: "Flat",
        startTime: "00:00",
        endTime: "24:00",
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        ratePerKwh: 0.30,
      });
      // Set default rate same as period rate so boundary transitions don't count
      await db.setConfig("default_rate_per_kwh", "0.30");

      const result = await tariffService.getCurrentRate();
      assertExists(result);
      expect(result.nextRate).toBeNull();
    });

    it("uses configured timezone", async () => {
      await db.setConfig("timezone", "Australia/Sydney");
      await db.createTariffPeriod({
        label: "All Day",
        startTime: "00:00",
        endTime: "24:00",
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        ratePerKwh: 0.35,
      });

      const result = await tariffService.getCurrentRate();
      assertExists(result);
      expect(result.ratePerKwh).toBe(0.35);
    });

    it("falls back to defaults when getConfig returns null", async () => {
      const original = db.getConfig.bind(db);
      db.getConfig = (_key: string) => Promise.resolve(null);

      // With getConfig returning null: default rate is 0, no enabled periods,
      // so getCurrentRate returns null
      const result = await tariffService.getCurrentRate();
      expect(result).toBeNull();

      db.getConfig = original;
    });

    it("handles disabled periods by ignoring them", async () => {
      // Create a disabled period and a default rate
      await db.createTariffPeriod({
        label: "Disabled",
        startTime: "00:00",
        endTime: "24:00",
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        ratePerKwh: 0.99,
        enabled: false,
      });
      await db.setConfig("default_rate_per_kwh", "0.10");

      const result = await tariffService.getCurrentRate();
      assertExists(result);
      // The disabled period shouldn't match, so default rate is used
      expect(result.ratePerKwh).toBe(0.10);
      expect(result.label).toBe("Default");
    });
  });

  describe("findNextRateChange (via getCurrentRate)", () => {
    it("finds tomorrow start time transition", async () => {
      // Set up: today has rate 0.20 all day, tomorrow starts a different rate
      // at 06:00 so the offset differs from today's end (avoids dedup collision)
      const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
      const now = new Date();
      const todayIdx = now.getDay();
      const tomorrowIdx = (todayIdx + 1) % 7;
      const todayDay = dayNames[todayIdx];
      const tomorrowDay = dayNames[tomorrowIdx];

      // Default matches today so the midnight boundary is not a transition
      await db.setConfig("default_rate_per_kwh", "0.20");

      await db.createTariffPeriod({
        label: "Today Rate",
        startTime: "00:00",
        endTime: "24:00",
        days: [todayDay as "mon"],
        ratePerKwh: 0.20,
      });

      // Tomorrow starts at 06:00 with a different rate
      await db.createTariffPeriod({
        label: "Tomorrow Rate",
        startTime: "06:00",
        endTime: "24:00",
        days: [tomorrowDay as "mon"],
        ratePerKwh: 0.50,
      });

      const result = await tariffService.getCurrentRate();
      assertExists(result);
      expect(result.ratePerKwh).toBe(0.20);
      // Should find tomorrow 06:00 rate change
      assertExists(result.nextRate);
      expect(result.nextRate.ratePerKwh).toBe(0.50);
      expect(result.nextRate.label).toBe("Tomorrow Rate");
    });

    it("handles overnight period end time wrapping to tomorrow", async () => {
      // Overnight period: 22:00-07:00 with wrap
      const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
      const now = new Date();
      const todayDay = dayNames[now.getDay()];

      // Create an overnight period that spans midnight
      await db.createTariffPeriod({
        label: "Overnight",
        startTime: "22:00",
        endTime: "07:00",
        days: [todayDay as "mon"],
        ratePerKwh: 0.08,
      });

      // And a daytime period
      await db.createTariffPeriod({
        label: "Daytime",
        startTime: "07:00",
        endTime: "22:00",
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        ratePerKwh: 0.40,
      });

      const result = await tariffService.getCurrentRate();
      assertExists(result);
      // Just verify it returns a valid result — the exact rate depends on the time
      expect(typeof result.ratePerKwh).toBe("number");
    });

    it("deduplicates candidates at the same time offset", async () => {
      // Two periods with the same start/end time on the same day create
      // duplicate candidates — the dedup logic should handle them
      const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
      const now = new Date();
      const todayDay = dayNames[now.getDay()];
      const tomorrowDay = dayNames[(now.getDay() + 1) % 7];

      await db.createTariffPeriod({
        label: "Period A",
        startTime: "00:00",
        endTime: "12:00",
        days: [todayDay as "mon", tomorrowDay as "mon"],
        ratePerKwh: 0.20,
      });
      await db.createTariffPeriod({
        label: "Period B",
        startTime: "12:00",
        endTime: "24:00",
        days: [todayDay as "mon", tomorrowDay as "mon"],
        ratePerKwh: 0.40,
      });

      const result = await tariffService.getCurrentRate();
      assertExists(result);
      // Should find a next rate change
      assertExists(result.nextRate);
    });
  });

  describe("create", () => {
    it("creates a tariff period and returns it", async () => {
      const result = await tariffService.create({
        label: "Peak",
        startTime: "16:00",
        endTime: "21:00",
        days: ["mon", "tue", "wed", "thu", "fri"],
        ratePerKwh: 0.45,
      });

      expect(result.period).toBeTruthy();
      expect(result.period.label).toBe("Peak");
      expect(result.period.startTime).toBe("16:00");
      expect(result.period.endTime).toBe("21:00");
      expect(result.period.ratePerKwh).toBe(0.45);
      expect(result.period.enabled).toBe(true);
    });

    it("creates a disabled tariff period", async () => {
      const result = await tariffService.create({
        label: "Disabled Peak",
        startTime: "16:00",
        endTime: "21:00",
        days: ["mon"],
        ratePerKwh: 0.50,
        enabled: false,
      });

      expect(result.period.enabled).toBe(false);
    });

    it("throws INTERNAL_SERVER_ERROR if period not found after create", async () => {
      // Stub getTariffPeriod to return null after create
      const original = db.getTariffPeriod.bind(db);
      db.getTariffPeriod = (_id: number) => {
        db.getTariffPeriod = original; // restore for cleanup
        return Promise.resolve(null);
      };

      try {
        await tariffService.create({
          label: "Ghost",
          startTime: "00:00",
          endTime: "12:00",
          days: ["mon"],
          ratePerKwh: 0.10,
        });
        expect(true).toBe(false); // should not reach
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceError);
        expect((error as ServiceError).code).toBe("INTERNAL_SERVER_ERROR");
      }
    });
  });

  describe("update", () => {
    it("updates an existing tariff period", async () => {
      const created = await tariffService.create({
        label: "Peak",
        startTime: "16:00",
        endTime: "21:00",
        days: ["mon"],
        ratePerKwh: 0.45,
      });

      const result = await tariffService.update(created.period.id, {
        label: "Updated Peak",
        ratePerKwh: 0.50,
      });

      expect(result.period.label).toBe("Updated Peak");
      expect(result.period.ratePerKwh).toBe(0.50);
    });

    it("throws NOT_FOUND when period does not exist", async () => {
      try {
        await tariffService.update(999, { label: "Nope" });
        expect(true).toBe(false); // should not reach
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceError);
        expect((error as ServiceError).code).toBe("NOT_FOUND");
      }
    });

    it("throws INTERNAL_SERVER_ERROR if period not found after update", async () => {
      const created = await tariffService.create({
        label: "Peak",
        startTime: "16:00",
        endTime: "21:00",
        days: ["mon"],
        ratePerKwh: 0.45,
      });

      // Stub getTariffPeriod: first call returns existing (existence check),
      // second call returns null (post-update fetch)
      const original = db.getTariffPeriod.bind(db);
      let callCount = 0;
      db.getTariffPeriod = (id: number) => {
        callCount++;
        if (callCount >= 2) {
          db.getTariffPeriod = original;
          return Promise.resolve(null);
        }
        return original(id);
      };

      try {
        await tariffService.update(created.period.id, { label: "Updated" });
        expect(true).toBe(false); // should not reach
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceError);
        expect((error as ServiceError).code).toBe("INTERNAL_SERVER_ERROR");
        expect((error as ServiceError).message).toContain("after update");
      }
    });
  });

  describe("delete", () => {
    it("deletes an existing tariff period", async () => {
      const created = await tariffService.create({
        label: "Peak",
        startTime: "16:00",
        endTime: "21:00",
        days: ["mon"],
        ratePerKwh: 0.45,
      });

      const result = await tariffService.delete(created.period.id);
      expect(result.success).toBe(true);

      // Verify it's gone
      const list = await tariffService.list();
      expect(list.periods.length).toBe(0);
    });

    it("throws NOT_FOUND when period does not exist", async () => {
      try {
        await tariffService.delete(999);
        expect(true).toBe(false); // should not reach
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceError);
        expect((error as ServiceError).code).toBe("NOT_FOUND");
      }
    });
  });

  describe("updateDefaultRate", () => {
    it("updates the default rate only", async () => {
      const result = await tariffService.updateDefaultRate({
        ratePerKwh: 0.35,
      });

      expect(result.ratePerKwh).toBe(0.35);
      expect(result.currencySymbol).toBe("$");
      expect(result.currencyCode).toBe("AUD");
    });

    it("updates rate with currency symbol and code", async () => {
      const result = await tariffService.updateDefaultRate({
        ratePerKwh: 0.25,
        currencySymbol: "€",
        currencyCode: "EUR",
      });

      expect(result.ratePerKwh).toBe(0.25);
      expect(result.currencySymbol).toBe("€");
      expect(result.currencyCode).toBe("EUR");
    });

    it("updates rate with only currency symbol", async () => {
      const result = await tariffService.updateDefaultRate({
        ratePerKwh: 0.30,
        currencySymbol: "£",
      });

      expect(result.ratePerKwh).toBe(0.30);
      expect(result.currencySymbol).toBe("£");
      expect(result.currencyCode).toBe("AUD");
    });

    it("updates rate with only currency code", async () => {
      const result = await tariffService.updateDefaultRate({
        ratePerKwh: 0.30,
        currencyCode: "GBP",
      });

      expect(result.ratePerKwh).toBe(0.30);
      expect(result.currencySymbol).toBe("$");
      expect(result.currencyCode).toBe("GBP");
    });

    it("falls back to defaults when getConfig returns null after write", async () => {
      const originalGet = db.getConfig.bind(db);
      const originalSet = db.setConfig.bind(db);
      // Let setConfig work normally but getConfig returns null (simulates
      // a read-after-write where the config key is not yet visible)
      db.getConfig = (_key: string) => Promise.resolve(null);
      // Prevent setConfig from actually writing so getConfig stays null
      db.setConfig = (_key: string, _value: string) => Promise.resolve();

      const result = await tariffService.updateDefaultRate({
        ratePerKwh: 0.50,
      });

      expect(result.currencySymbol).toBe("$");
      expect(result.currencyCode).toBe("AUD");

      db.getConfig = originalGet;
      db.setConfig = originalSet;
    });
  });

  describe("loadPreset", () => {
    it("loads the flat preset", async () => {
      const result = await tariffService.loadPreset("flat");
      expect(result.periods.length).toBe(1);
      expect(result.periods[0].label).toBe("Flat Rate");
      expect(result.periods[0].ratePerKwh).toBe(0.30);
    });

    it("loads the tou preset", async () => {
      const result = await tariffService.loadPreset("tou");
      expect(result.periods.length).toBe(4);
    });

    it("loads the ev-tou preset", async () => {
      const result = await tariffService.loadPreset("ev-tou");
      expect(result.periods.length).toBe(5);
      expect(result.periods[0].label).toBe("EV");
      expect(result.periods[0].ratePerKwh).toBe(0.08);
    });

    it("replaces existing periods when loading a preset", async () => {
      // Create an existing period
      await tariffService.create({
        label: "Old Period",
        startTime: "00:00",
        endTime: "12:00",
        days: ["mon"],
        ratePerKwh: 0.99,
      });

      const result = await tariffService.loadPreset("flat");
      // Old period should be deleted, only flat preset remains
      expect(result.periods.length).toBe(1);
      expect(result.periods[0].label).toBe("Flat Rate");
    });

    it("throws BAD_REQUEST for unknown preset", async () => {
      try {
        await tariffService.loadPreset("nonexistent");
        expect(true).toBe(false); // should not reach
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceError);
        expect((error as ServiceError).code).toBe("BAD_REQUEST");
        expect((error as ServiceError).message).toContain("nonexistent");
        expect((error as ServiceError).message).toContain("flat");
      }
    });
  });
});
