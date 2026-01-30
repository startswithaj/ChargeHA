import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { buildChargeSchedule } from "@chargeha/shared/test-factories";
import { AppDatabase } from "../db/AppDatabase.ts";
import { TypedEventEmitter } from "./TypedEventEmitter.ts";
import type { NotificationService } from "./NotificationService.ts";
import type { ScheduleService } from "./ScheduleService.ts";
import { NotificationListener } from "./NotificationListener.ts";
import { Logger } from "../lib/Logger.ts";
import { MockListenerNotificationService } from "../test-helpers/MockListenerNotificationService.ts";
import { throwingMock } from "../test-helpers/throwingMock.ts";

describe("NotificationListener", () => {
  const testLogger = new Logger("Notifications", "error");

  let db: AppDatabase;
  let eventEmitter: TypedEventEmitter;
  let notificationService: MockListenerNotificationService;
  let activeCharge: ReturnType<typeof buildChargeSchedule> | null;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
    eventEmitter = new TypedEventEmitter();
    notificationService = new MockListenerNotificationService();
    activeCharge = null;
    const scheduleService = throwingMock<ScheduleService>("ScheduleService", {
      getActiveChargeForVehicle: () => Promise.resolve(activeCharge),
    });
    new NotificationListener(
      eventEmitter,
      notificationService as unknown as NotificationService,
      db,
      scheduleService,
      testLogger,
    );
  });

  afterEach(() => {
    db.close();
  });

  const VEH = { vehicleId: "VIN1", vehicleName: "Test Car" };

  describe("vehicle_plug_changed", () => {
    it("plugged in, at home", () => {
      eventEmitter.emit("vehicle_plug_changed", {
        ...VEH,
        isPluggedIn: true,
        isHome: true,
      });
      expect(notificationService.notifications).toHaveLength(1);
      const n = notificationService.notifications[0];
      expect(n.eventType).toBe("vehicle_plugged_in");
      expect(n.title).toBe("Vehicle Plugged In");
      expect(n.message).toBe("Test Car has been plugged in (at home).");
    });

    it("unplugged, away from home", () => {
      eventEmitter.emit("vehicle_plug_changed", {
        ...VEH,
        isPluggedIn: false,
        isHome: false,
      });
      const n = notificationService.notifications[0];
      expect(n.eventType).toBe("vehicle_unplugged");
      expect(n.title).toBe("Vehicle Unplugged");
      expect(n.message).toBe(
        "Test Car has been unplugged (away from home).",
      );
    });

    it("plugged in, location unknown", () => {
      eventEmitter.emit("vehicle_plug_changed", {
        ...VEH,
        isPluggedIn: true,
        isHome: null,
      });
      expect(notificationService.notifications[0].message).toBe(
        "Test Car has been plugged in.",
      );
    });
  });

  describe("vehicle_error", () => {
    it("non-sleep fetch error → error notification", () => {
      eventEmitter.emit("vehicle_error", {
        ...VEH,
        error: "Connection refused",
        source: "fetch",
      });
      const n = notificationService.notifications[0];
      expect(n.eventType).toBe("error");
      expect(n.title).toBe("Vehicle Fetch Failed");
      expect(n.message).toBe(
        "Failed to fetch state for Test Car: Connection refused",
      );
    });

    it("sleep error → vehicle_sleep notification", () => {
      eventEmitter.emit("vehicle_error", {
        ...VEH,
        error: "vehicle is offline or asleep",
        source: "fetch",
      });
      const n = notificationService.notifications[0];
      expect(n.eventType).toBe("vehicle_sleep");
      expect(n.title).toBe("Vehicle Asleep");
    });

    it("did not respond → vehicle_sleep", () => {
      eventEmitter.emit("vehicle_error", {
        ...VEH,
        error: "Vehicle did not respond",
        source: "fetch",
      });
      expect(notificationService.notifications[0].eventType).toBe(
        "vehicle_sleep",
      );
    });

    it("command error → Vehicle Command Failed", () => {
      eventEmitter.emit("vehicle_error", {
        ...VEH,
        error: "rejected by vehicle",
        source: "command",
      });
      const n = notificationService.notifications[0];
      expect(n.eventType).toBe("error");
      expect(n.title).toBe("Vehicle Command Failed");
    });

    it("null error is ignored", () => {
      eventEmitter.emit("vehicle_error", {
        ...VEH,
        error: null,
        source: "command",
      });
      expect(notificationService.notifications).toHaveLength(0);
    });
  });

  describe("controller charge events", () => {
    it("charge_started — schedule", () => {
      eventEmitter.emit("controller_charge_started", {
        ...VEH,
        actionDetail: "Start charging at 32A",
        reason: "schedule",
      });
      const n = notificationService.notifications[0];
      expect(n.eventType).toBe("charge_started");
      expect(n.title).toBe("Scheduled Charging Started");
      expect(n.message).toBe(
        "Test Car started charging. Start charging at 32A",
      );
    });

    it("charge_started — solar", () => {
      eventEmitter.emit("controller_charge_started", {
        ...VEH,
        actionDetail: "Start charging at 6A (solar tracking)",
        reason: "solar_tracking",
      });
      expect(notificationService.notifications[0].title).toBe(
        "Solar Charging Started",
      );
    });

    it("charge_started — charge_now falls back to generic title", () => {
      eventEmitter.emit("controller_charge_started", {
        ...VEH,
        actionDetail: "Start charging at 32A (charge_now)",
        reason: "charge_now",
      });
      expect(notificationService.notifications[0].title).toBe(
        "Charging Started",
      );
    });

    it("charge_stopped without context", () => {
      eventEmitter.emit("controller_charge_stopped", {
        ...VEH,
        actionDetail: "Solar dropped",
        reason: "grace_period",
      });
      const n = notificationService.notifications[0];
      expect(n.eventType).toBe("charge_stopped");
      expect(n.title).toBe("Charging Stopped");
      expect(n.message).toBe("Test Car stopped charging. Solar dropped");
    });

    it("charge_stopped with schedule limit context", () => {
      eventEmitter.emit("controller_charge_stopped", {
        ...VEH,
        actionDetail: "Reached limit",
        reason: "schedule",
        scheduleLimitContext: { scheduleLimitPct: 80, batteryLevel: 80 },
      });
      expect(notificationService.notifications[0].message).toContain(
        "Stopped at 80%. Reached schedule limit (80%)",
      );
    });

    it("charge_stopped with reason=battery_at_limit routes to Charge Complete", () => {
      eventEmitter.emit("controller_charge_stopped", {
        ...VEH,
        actionDetail: "Stop — battery at charge limit",
        reason: "battery_at_limit",
        batteryLevel: 100,
        chargeLimit: 100,
      });
      const n = notificationService.notifications[0];
      expect(n.eventType).toBe("charge_complete");
      expect(n.title).toBe("Charge Complete");
      expect(n.message).toBe(
        "Test Car reached its charge limit of 100% (currently 100%).",
      );
    });

    it("external_charge", () => {
      eventEmitter.emit("controller_external_charge", VEH);
      const n = notificationService.notifications[0];
      expect(n.eventType).toBe("external_charge_detected");
      expect(n.title).toBe("External Charging Detected");
    });

    it("blockout_charge piggybacks on external_charge_detected", () => {
      eventEmitter.emit("controller_blockout_charge", {
        ...VEH,
        startTime: "00:00",
        endTime: "06:00",
      });
      const n = notificationService.notifications[0];
      expect(n.eventType).toBe("external_charge_detected");
      expect(n.title).toBe("Charging During Blockout");
    });

    it("low_solar includes grace period minutes", () => {
      eventEmitter.emit("controller_low_solar", {
        ...VEH,
        gracePeriodMinutes: 5,
      });
      const n = notificationService.notifications[0];
      expect(n.eventType).toBe("low_solar");
      expect(n.title).toBe("Grace Period Started — Low Solar");
      expect(n.message).toBe(
        "Test Car is entering a 5-minute grace period. If solar does not return above the minimum amps, charging will stop.",
      );
    });
  });

  describe("schedule_activated", () => {
    it("includes plugged + at home", () => {
      eventEmitter.emit("controller_schedule_activated", {
        ...VEH,
        scheduleType: "charge",
        startTime: "00:00",
        endTime: "06:00",
        isPluggedIn: true,
        isHome: true,
      });
      expect(notificationService.notifications[0].message).toBe(
        "Charge schedule (00:00-06:00) is now active for Test Car. Vehicle is plugged in, at home.",
      );
    });

    it("blockout type label, unplugged + away", () => {
      eventEmitter.emit("controller_schedule_activated", {
        ...VEH,
        scheduleType: "blockout",
        startTime: "16:00",
        endTime: "20:00",
        isPluggedIn: false,
        isHome: false,
      });
      expect(notificationService.notifications[0].message).toBe(
        "Blockout schedule (16:00-20:00) is now active for Test Car. Vehicle is unplugged, away from home.",
      );
    });

    it("location unknown", () => {
      eventEmitter.emit("controller_schedule_activated", {
        ...VEH,
        scheduleType: "charge",
        startTime: "00:00",
        endTime: "06:00",
        isPluggedIn: true,
        isHome: null,
      });
      expect(notificationService.notifications[0].message).toBe(
        "Charge schedule (00:00-06:00) is now active for Test Car. Vehicle is plugged in.",
      );
    });
  });

  describe("energy poll", () => {
    it("does not notify on first failure (under threshold)", async () => {
      eventEmitter.emit("energy_poll_failure", { error: "boom" });
      // Wait for async handler
      await new Promise((r) => setTimeout(r, 10));
      expect(notificationService.notifications).toHaveLength(0);
    });

    it("notifies once threshold reached", async () => {
      await db.setConfig("energy_error_threshold", "3");
      await [0, 1, 2].reduce(async (prev) => {
        await prev;
        eventEmitter.emit("energy_poll_failure", { error: "boom" });
        await new Promise((r) => setTimeout(r, 5));
      }, Promise.resolve());
      expect(notificationService.notifications).toHaveLength(1);
      expect(notificationService.notifications[0].eventType).toBe("error");
      expect(notificationService.notifications[0].title).toBe(
        "Energy Source Offline",
      );
    });

    it("notifies recovery after outage", async () => {
      await db.setConfig("energy_error_threshold", "1");
      // Seed a prior success so lastSuccessAt is set
      eventEmitter.emit("energy_poll_success", {});
      eventEmitter.emit("energy_poll_failure", { error: "boom" });
      await new Promise((r) => setTimeout(r, 5));
      eventEmitter.emit("energy_poll_success", {});
      expect(notificationService.notifications).toHaveLength(2);
      expect(notificationService.notifications[1].eventType).toBe(
        "energy_recovered",
      );
    });
  });

  describe("vehicle_mode_changed", () => {
    it("charge_now", () => {
      eventEmitter.emit("vehicle_mode_changed", { ...VEH, mode: "charge_now" });
      const n = notificationService.notifications[0];
      expect(n.eventType).toBe("mode_changed");
      expect(n.title).toBe("Charge Now Activated");
      expect(n.message).toBe(
        "Test Car will charge at full rate until unplugged. Schedules and solar tracking are bypassed.",
      );
    });

    it("stop", () => {
      eventEmitter.emit("vehicle_mode_changed", { ...VEH, mode: "stop" });
      const n = notificationService.notifications[0];
      expect(n.title).toBe("Stop Mode Activated");
      expect(n.message).toBe(
        "Test Car will not charge until it is next unplugged and replugged. Schedules and solar tracking are bypassed.",
      );
    });

    it("auto", () => {
      eventEmitter.emit("vehicle_mode_changed", { ...VEH, mode: "auto" });
      const n = notificationService.notifications[0];
      expect(n.title).toBe("Auto Mode Activated");
      expect(n.message).toBe(
        "Test Car is back on auto. Schedules and solar tracking will resume.",
      );
    });
  });

  describe("safety_trip", () => {
    it("emits safety_trip notification with cycle count", () => {
      eventEmitter.emit("safety_trip", {
        ...VEH,
        cycles: 4,
        windowMinutes: 60,
      });
      const n = notificationService.notifications[0];
      expect(n.eventType).toBe("safety_trip");
      expect(n.title).toBe("Safety Trip — Charging Disabled");
      expect(n.message).toContain("4 start/stop cycles in 60 minutes");
    });
  });

  describe("vehicle_arrived_home", () => {
    it("not plugged in, SOC below schedule target → fires reminder", async () => {
      activeCharge = buildChargeSchedule({
        vehicleId: "VIN1",
        chargeLimitPct: 80,
      });
      eventEmitter.emit("vehicle_arrived_home", {
        ...VEH,
        isPluggedIn: false,
        soc: 62,
        chargeLimit: 90,
      });
      // Flush one microtask so the async handler's awaited schedule lookup resolves
      await Promise.resolve();
      expect(notificationService.notifications).toHaveLength(1);
      const n = notificationService.notifications[0];
      expect(n.eventType).toBe("arrived_home_not_plugged_in");
      expect(n.title).toBe("Plug car in reminder - 62%");
      expect(n.message).toBe(
        "Test Car arrived home at 62%, target is 80%. Not plugged in.",
      );
    });

    it("plugged in → silent", async () => {
      activeCharge = buildChargeSchedule({
        vehicleId: "VIN1",
        chargeLimitPct: 80,
      });
      eventEmitter.emit("vehicle_arrived_home", {
        ...VEH,
        isPluggedIn: true,
        soc: 40,
        chargeLimit: 80,
      });
      // Flush one microtask so the async handler's awaited schedule lookup resolves
      await Promise.resolve();
      expect(notificationService.notifications).toHaveLength(0);
    });

    it("SOC at or above schedule target → silent", async () => {
      activeCharge = buildChargeSchedule({
        vehicleId: "VIN1",
        chargeLimitPct: 80,
      });
      eventEmitter.emit("vehicle_arrived_home", {
        ...VEH,
        isPluggedIn: false,
        soc: 80,
        chargeLimit: 80,
      });
      // Flush one microtask so the async handler's awaited schedule lookup resolves
      await Promise.resolve();
      expect(notificationService.notifications).toHaveLength(0);
    });

    it("no active schedule → falls back to vehicle's own charge limit", async () => {
      activeCharge = null;
      eventEmitter.emit("vehicle_arrived_home", {
        ...VEH,
        isPluggedIn: false,
        soc: 50,
        chargeLimit: 80,
      });
      // Flush one microtask so the async handler's awaited schedule lookup resolves
      await Promise.resolve();
      expect(notificationService.notifications).toHaveLength(1);
      const n = notificationService.notifications[0];
      expect(n.title).toBe("Plug car in reminder - 50%");
      expect(n.message).toContain("target is 80%");
    });
  });
});
