import { vi } from "vitest";
import type {
  BlockoutSchedule,
  ChargeSchedule,
  DayOfWeek,
} from "@chargeha/shared";
import type { useSchedules } from "../../../../hooks/useSchedules.ts";
import type { useVehicles } from "../../../../hooks/useVehicles.ts";

type UseSchedulesReturn = ReturnType<typeof useSchedules>;
type UseVehiclesReturn = ReturnType<typeof useVehicles>;
type Vehicle = UseVehiclesReturn["vehicles"][number];

export function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: "VIN1",
    name: "Test Car",
    mode: "auto",
    adapterType: "tesla",
    priority: 1,
    state: null,
    ...overrides,
  } as unknown as Vehicle;
}

export function makeVehiclesReturn(
  overrides: Partial<UseVehiclesReturn> = {},
): UseVehiclesReturn {
  return {
    vehicles: [makeVehicle()],
    loading: false,
    error: null,
    commandPending: {},
    vehicleErrors: {},
    startCharging: vi.fn(),
    stopCharging: vi.fn(),
    setAmps: vi.fn(),
    changeMode: vi.fn(),
    refreshVehicles: vi.fn(),
    ...overrides,
  } as unknown as UseVehiclesReturn;
}

export function makeSchedulesReturn(
  overrides: Partial<UseSchedulesReturn> = {},
): UseSchedulesReturn {
  return {
    schedules: [],
    chargeSchedules: [],
    blockoutSchedules: [],
    loading: false,
    addSchedule: vi.fn(),
    updateSchedule: vi.fn(),
    toggleSchedule: vi.fn(),
    removeSchedule: vi.fn(),
    ...overrides,
  } as unknown as UseSchedulesReturn;
}

export const chargeSchedule: ChargeSchedule = {
  id: "sched-1",
  vehicleId: "VIN1",
  scheduleType: "charge",
  startTime: "00:00",
  endTime: "06:00",
  days: ["mon", "tue", "wed"] as DayOfWeek[],
  chargeAmps: 16,
  chargeLimitPct: 80,
  enabled: true,
};

export const blockoutSchedule: BlockoutSchedule = {
  id: "sched-blockout-1",
  vehicleId: null,
  scheduleType: "blockout",
  startTime: "17:00",
  endTime: "21:00",
  days: ["mon", "tue", "wed", "thu", "fri"] as DayOfWeek[],
  enabled: true,
};
