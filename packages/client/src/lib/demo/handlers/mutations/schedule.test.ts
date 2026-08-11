import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDemoState,
  initDemoState,
  resetDemoState,
  updateDemoState,
} from "../../demoState.ts";
import { clearPersisted } from "../../demoPersistence.ts";
import { scheduleMutations } from "./schedule.ts";
import { isActiveNow } from "../schedule.ts";

describe("demo schedule.createOneOff", () => {
  // Tuesday 2026-08-11 14:00 local — the demo clock reads host-local time
  const TUESDAY_AFTERNOON = new Date(2026, 7, 11, 14, 0);

  beforeEach(async () => {
    resetDemoState();
    clearPersisted();
    vi.useFakeTimers();
    vi.setSystemTime(TUESDAY_AFTERNOON);
    await initDemoState();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetDemoState();
    clearPersisted();
  });

  const createOneOff = (
    overrides: Partial<{
      vehicleId: string;
      startTime: string;
      durationMinutes: number;
      chargeAmps: number;
      chargeLimitPct: number;
    }> = {},
  ) =>
    scheduleMutations["schedule.createOneOff"]({
      vehicleId: "v1",
      startTime: "23:30",
      durationMinutes: 180,
      chargeAmps: 16,
      chargeLimitPct: 80,
      ...overrides,
    });

  it("stores a dated charge schedule with the derived end time", () => {
    const { schedule } = createOneOff();

    expect(schedule.scheduleType).toBe("charge");
    expect(schedule.startTime).toBe("23:30");
    expect(schedule.endTime).toBe("02:30");
    if (schedule.scheduleType !== "charge") throw new Error("expected charge");
    expect(schedule.oneOffDate).toBe("2026-08-11");
    expect(getDemoState().schedules).toHaveLength(1);
  });

  it("replaces an existing pending one-off for the same vehicle", () => {
    createOneOff();
    const second = createOneOff({ durationMinutes: 60 });

    const stored = getDemoState().schedules;
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(second.schedule.id);
    expect(stored[0].endTime).toBe("00:30");
  });

  it("leaves another vehicle's one-off in place", () => {
    createOneOff();
    createOneOff({ vehicleId: "v2" });
    expect(getDemoState().schedules).toHaveLength(2);
  });

  it("leaves recurring schedules in place", () => {
    updateDemoState((m) => ({
      ...m,
      schedules: [{
        id: "recurring",
        vehicleId: "v1",
        scheduleType: "charge",
        startTime: "08:00",
        endTime: "12:00",
        days: ["mon"],
        chargeAmps: 10,
        chargeLimitPct: 70,
        enabled: true,
      }],
    }));

    createOneOff();
    createOneOff();

    const stored = getDemoState().schedules;
    expect(stored).toHaveLength(2);
    expect(stored.some((s) => s.id === "recurring")).toBe(true);
  });

  it("is inactive before its window and active inside it", () => {
    createOneOff();
    const stored = getDemoState().schedules[0];

    expect(isActiveNow(stored, new Date(2026, 7, 11, 22, 0))).toBe(false);
    expect(isActiveNow(stored, new Date(2026, 7, 11, 23, 45))).toBe(true);
    // Past midnight, when the weekday no longer matches its days
    expect(isActiveNow(stored, new Date(2026, 7, 12, 1, 0))).toBe(true);
    expect(isActiveNow(stored, new Date(2026, 7, 12, 3, 0))).toBe(false);
  });

  it("does not recur the following week", () => {
    createOneOff();
    const stored = getDemoState().schedules[0];
    expect(isActiveNow(stored, new Date(2026, 7, 18, 23, 45))).toBe(false);
  });
});
