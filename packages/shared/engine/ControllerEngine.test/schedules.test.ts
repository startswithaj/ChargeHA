import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { ControllerEngine } from "../ControllerEngine.ts";
import { makeInput } from "../test-helpers/controller-engine.ts";

describe("ControllerEngine — schedules", () => {
  describe("schedules", () => {
    it("charges at schedule amps when charge schedule is active", () => {
      const engine = new ControllerEngine();
      const now = new Date("2026-01-01T03:00:00Z");
      const output = engine.decide({
        ...makeInput({ configOverrides: { timezone: "UTC" } }),
        now,
        schedules: [{
          id: "s1",
          vehicleId: null,
          chargerId: null,
          scheduleType: "charge",
          startTime: "02:00",
          endTime: "06:00",
          days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
          chargeAmps: 16,
          chargeLimitPct: null,
          enabled: true,
        }],
      });
      const d = output.decisions.get("V1");
      expect(d?.action).toBe("start");
      expect(d?.targetAmps).toBe(16);
    });

    it("stops when blockout schedule is active", () => {
      const engine = new ControllerEngine();
      const now = new Date("2026-01-01T03:00:00Z");
      const output = engine.decide({
        ...makeInput({
          vehicle: { state: { isCharging: true, chargeAmps: 10 } },
          configOverrides: { timezone: "UTC" },
        }),
        now,
        schedules: [{
          id: "s1",
          vehicleId: null,
          chargerId: null,
          scheduleType: "blockout",
          startTime: "02:00",
          endTime: "06:00",
          days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
          chargeAmps: null,
          chargeLimitPct: null,
          enabled: true,
        }],
      });
      expect(output.decisions.get("V1")?.action).toBe("stop");
    });

    it("falls through to solar when schedule charge limit is reached", () => {
      const engine = new ControllerEngine();
      const now = new Date("2026-01-01T03:00:00Z");
      const output = engine.decide({
        ...makeInput({
          vehicle: { state: { batteryLevel: 85 } },
          energyOverrides: { gridPowerW: -5000 },
          configOverrides: { timezone: "UTC" },
        }),
        now,
        schedules: [{
          id: "s1",
          vehicleId: null,
          chargerId: null,
          scheduleType: "charge",
          startTime: "02:00",
          endTime: "06:00",
          days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
          chargeAmps: 16,
          chargeLimitPct: 80,
          enabled: true,
        }],
      });
      const d = output.decisions.get("V1");
      // Schedule limit reached at 85% >= 80%, falls through to solar tracking
      expect(d?.action).toBe("start");
      expect(d?.scheduleLimitContext?.scheduleLimitPct).toBe(80);
    });
  });

  describe("schedule — branches", () => {
    it("adjusts amps when schedule amps differ from current", () => {
      const engine = new ControllerEngine();
      const now = new Date("2026-01-01T03:00:00Z");
      const output = engine.decide({
        ...makeInput({
          vehicle: { state: { isCharging: true, chargeAmps: 10 } },
          configOverrides: { timezone: "UTC" },
        }),
        now,
        schedules: [{
          id: "s1",
          vehicleId: null,
          chargerId: null,
          scheduleType: "charge",
          startTime: "02:00",
          endTime: "06:00",
          days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
          chargeAmps: 16,
          chargeLimitPct: null,
          enabled: true,
        }],
      });
      expect(output.decisions.get("V1")?.action).toBe("adjust_amps");
    });

    it("returns none when already at schedule amps", () => {
      const engine = new ControllerEngine();
      const now = new Date("2026-01-01T03:00:00Z");
      const output = engine.decide({
        ...makeInput({
          vehicle: { state: { isCharging: true, chargeAmps: 16 } },
          configOverrides: { timezone: "UTC" },
        }),
        now,
        schedules: [{
          id: "s1",
          vehicleId: null,
          chargerId: null,
          scheduleType: "charge",
          startTime: "02:00",
          endTime: "06:00",
          days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
          chargeAmps: 16,
          chargeLimitPct: null,
          enabled: true,
        }],
      });
      expect(output.decisions.get("V1")?.action).toBe("none");
    });
  });

  describe("schedules — time matching", () => {
    it("does not match when day is wrong", () => {
      const engine = new ControllerEngine();
      const now = new Date("2026-01-01T03:00:00Z"); // Thursday
      const output = engine.decide({
        ...makeInput({ configOverrides: { timezone: "UTC" } }),
        now,
        schedules: [{
          id: "s1",
          vehicleId: null,
          chargerId: null,
          scheduleType: "charge",
          startTime: "02:00",
          endTime: "06:00",
          days: ["mon", "tue", "wed"],
          chargeAmps: 16,
          chargeLimitPct: null,
          enabled: true,
        }],
      });
      expect(output.decisions.get("V1")?.detail).not.toContain("schedule");
    });

    it("matches overnight schedule spanning midnight", () => {
      const engine = new ControllerEngine();
      const now = new Date("2026-01-01T23:30:00Z");
      const output = engine.decide({
        ...makeInput({ configOverrides: { timezone: "UTC" } }),
        now,
        schedules: [{
          id: "s1",
          vehicleId: null,
          chargerId: null,
          scheduleType: "charge",
          startTime: "22:00",
          endTime: "06:00",
          days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
          chargeAmps: 10,
          chargeLimitPct: null,
          enabled: true,
        }],
      });
      expect(output.decisions.get("V1")?.action).toBe("start");
      expect(output.decisions.get("V1")?.targetAmps).toBe(10);
    });

    it("uses local time when no timezone configured", () => {
      const engine = new ControllerEngine();
      const now = new Date();
      const hours = now.getHours();
      const output = engine.decide({
        ...makeInput({ configOverrides: { timezone: "" } }),
        now,
        schedules: [{
          id: "s1",
          vehicleId: null,
          chargerId: null,
          scheduleType: "charge",
          startTime: `${String(hours).padStart(2, "0")}:00`,
          endTime: `${String((hours + 1) % 24).padStart(2, "0")}:00`,
          days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
          chargeAmps: 12,
          chargeLimitPct: null,
          enabled: true,
        }],
      });
      expect(output.decisions.get("V1")?.action).toBe("start");
    });
  });
});
