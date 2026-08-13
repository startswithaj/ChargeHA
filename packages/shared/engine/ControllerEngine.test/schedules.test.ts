import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { ControllerEngine } from "../ControllerEngine.ts";
import { makeInput } from "../test-helpers/controller-engine.ts";
import type { EngineSchedule } from "../types.ts";
import type { VehicleChargeState } from "../../types.ts";

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

  describe("schedules — overlap merging", () => {
    // The charging point is CP1 with car V1 plugged into it, matching what
    // ChargingPointManager.resolveVehicle produces for a smart charger.
    const point = { id: "CP1", vehicleId: "V1", name: "EV 1" };
    const sched = (
      overrides: Partial<EngineSchedule> & { id: string },
    ): EngineSchedule => ({
      vehicleId: null,
      chargerId: null,
      scheduleType: "charge",
      startTime: "00:00",
      endTime: "06:00",
      days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      chargeAmps: 32,
      chargeLimitPct: null,
      enabled: true,
      ...overrides,
    });
    const decide = (
      schedules: EngineSchedule[],
      state: Partial<VehicleChargeState>,
      at: string,
    ) =>
      new ControllerEngine().decide({
        ...makeInput({
          vehicle: { ...point, state },
          configOverrides: { timezone: "UTC" },
        }),
        now: new Date(at),
        schedules,
      }).decisions.get("CP1");

    const chargerSched = sched({ id: "s-charger", chargerId: "CP1" });
    const vehicleSched = sched({
      id: "s-vehicle",
      vehicleId: "V1",
      chargeAmps: 10,
      chargeLimitPct: 80,
    });

    it("produces the identical decision in both source orderings", () => {
      const at = "2026-01-01T03:00:00Z";
      const forward = decide([chargerSched, vehicleSched], {}, at);
      const reversed = decide([vehicleSched, chargerSched], {}, at);
      expect(forward).toEqual(reversed);
    });

    it("takes window and amps from the charger schedule", () => {
      const d = decide(
        [vehicleSched, chargerSched],
        {},
        "2026-01-01T03:00:00Z",
      );
      expect(d?.action).toBe("start");
      expect(d?.targetAmps).toBe(32);
      expect(d?.detail).toContain("schedule 00:00-06:00 merged, limit 80%");
    });

    it("still stops at the vehicle schedule's charge limit", () => {
      const d = decide(
        [chargerSched, vehicleSched],
        { batteryLevel: 85, isCharging: true, chargeAmps: 32 },
        "2026-01-01T03:00:00Z",
      );
      // Limit reached at 85% >= 80%, so the schedule step no longer decides.
      expect(d?.reason).not.toBe("schedule");
      expect(d?.scheduleLimitContext?.scheduleLimitPct).toBe(80);
    });

    it("applies the strictest limit when both schedules carry one", () => {
      const strictCharger = sched({
        id: "s-charger",
        chargerId: "CP1",
        chargeLimitPct: 70,
      });
      const d = decide(
        [strictCharger, vehicleSched],
        { batteryLevel: 75, isCharging: true, chargeAmps: 32 },
        "2026-01-01T03:00:00Z",
      );
      expect(d?.scheduleLimitContext?.scheduleLimitPct).toBe(70);
    });

    describe("partial overlap", () => {
      // Charger 00:00-06:00 @32A, vehicle 03:00-09:00 @10A limit 80%.
      const late = sched({
        id: "s-vehicle",
        vehicleId: "V1",
        startTime: "03:00",
        endTime: "09:00",
        chargeAmps: 10,
        chargeLimitPct: 80,
      });
      const both = [chargerSched, late];

      it("charger only before the shared window — no limit applies", () => {
        const d = decide(both, { batteryLevel: 85 }, "2026-01-01T01:00:00Z");
        expect(d?.action).toBe("start");
        expect(d?.targetAmps).toBe(32);
        expect(d?.scheduleLimitContext).toBeUndefined();
      });

      it("merged inside the shared window — charger amps, vehicle limit", () => {
        const running = { batteryLevel: 50, isCharging: true, chargeAmps: 10 };
        const d = decide(both, running, "2026-01-01T04:00:00Z");
        expect(d?.action).toBe("adjust_amps");
        expect(d?.targetAmps).toBe(32);
        const limited = decide(
          both,
          { batteryLevel: 85 },
          "2026-01-01T04:00:00Z",
        );
        expect(limited?.scheduleLimitContext?.scheduleLimitPct).toBe(80);
      });

      it("vehicle only after the shared window — its own amps and limit", () => {
        const d = decide(both, { batteryLevel: 50 }, "2026-01-01T07:00:00Z");
        expect(d?.action).toBe("start");
        expect(d?.targetAmps).toBe(10);
        expect(d?.detail).toContain("schedule 03:00-09:00");
        expect(d?.detail).not.toContain("merged");
      });
    });

    it("leaves non-overlapping schedules exactly as they were", () => {
      const early = sched({
        id: "s-charger",
        chargerId: "CP1",
        endTime: "02:00",
      });
      const later = sched({
        id: "s-vehicle",
        vehicleId: "V1",
        startTime: "03:00",
        endTime: "05:00",
        chargeAmps: 10,
        chargeLimitPct: 80,
      });
      const d = decide([later, early], {}, "2026-01-01T01:00:00Z");
      expect(d?.detail).toBe("Start charging at 32A (schedule 00:00-02:00)");
    });

    it("resolves two charger-keyed schedules deterministically", () => {
      // Same start, so the longer window wins the window and amps.
      const shortWindow = sched({
        id: "s-b",
        chargerId: "CP1",
        endTime: "04:00",
        chargeAmps: 10,
      });
      const longWindow = sched({
        id: "s-a",
        chargerId: "CP1",
        endTime: "06:00",
      });
      const forward = decide(
        [shortWindow, longWindow],
        {},
        "2026-01-01T03:00:00Z",
      );
      const reversed = decide(
        [longWindow, shortWindow],
        {},
        "2026-01-01T03:00:00Z",
      );
      expect(forward).toEqual(reversed);
      expect(forward?.targetAmps).toBe(32);
      expect(forward?.detail).toContain("schedule 00:00-06:00 merged");
    });

    it("resolves two vehicle-keyed schedules deterministically", () => {
      const a = sched({
        id: "s-a",
        vehicleId: "V1",
        chargeAmps: 16,
        chargeLimitPct: 90,
      });
      const b = sched({
        id: "s-b",
        vehicleId: "V1",
        startTime: "01:00",
        chargeAmps: 24,
        chargeLimitPct: 70,
      });
      const forward = decide([a, b], {}, "2026-01-01T03:00:00Z");
      const reversed = decide([b, a], {}, "2026-01-01T03:00:00Z");
      expect(forward).toEqual(reversed);
      // Earliest start wins the window and amps; strictest limit still applies.
      expect(forward?.targetAmps).toBe(16);
      expect(forward?.detail).toContain("merged, limit 70%");
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
