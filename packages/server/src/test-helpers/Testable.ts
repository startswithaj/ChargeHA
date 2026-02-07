/**
 * Typed test wrappers for accessing private class members without `as any` casts.
 *
 * Each Testable* interface explicitly lists the private members exposed for testing.
 * The overloaded testable() function returns `PublicOf<T> & TestableInterface` so both
 * public and exposed private members are accessible with full type safety.
 *
 * PublicOf<T> is a mapped type that strips private/protected members (keyof T only
 * includes public members), avoiding the TypeScript limitation where intersecting a
 * class with private members and an interface re-declaring those members yields `never`.
 */

import type { DatabaseDriver as Database } from "@chargeha/shared/database-driver";
import type { EnergyPoller } from "../services/EnergyPoller.ts";
import type { ChargeController } from "../services/ChargeController.ts";
import type {
  ControllerConfig,
  VehicleControlState,
} from "@chargeha/shared/engine";
import type { EnergyData, VehicleChargeState } from "@chargeha/shared";
import type { ScheduleRow, VehicleRow } from "../db/types.ts";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { DataRecorder } from "../services/DataRecorder.ts";
import type { Overseer } from "../services/Overseer.ts";

// ---------------------------------------------------------------------------
// Helper: extract only public members from a class type
// ---------------------------------------------------------------------------

type PublicOf<T> = { [K in keyof T]: T[K] };

// ---------------------------------------------------------------------------
// Testable interfaces — one per class, listing only the exposed privates
// ---------------------------------------------------------------------------

export interface TestableEnergyPoller {
  poll(): Promise<void>;
}

export interface TestableChargeController {
  loop(): Promise<void>;
  loadConfig(): Promise<ControllerConfig>;
  engine: { getControlState(vehicleId: string): VehicleControlState };
  computePollingMode(
    vehicle: VehicleRow,
    schedules: ScheduleRow[],
    energy: EnergyData | null,
    config: ControllerConfig,
    state: VehicleChargeState | null,
    now: Date,
    wasSuspended: boolean,
  ): boolean;
}

export interface TestableAppDatabase {
  sqlite: Database;
}

export interface TestableDataRecorder {
  record(): Promise<void>;
  tick(): Promise<void>;
  tickCount: number;
  scheduleNext(): void;
  recordVehicleCharges(ratePerKwh: number | null): Promise<void>;
}

export interface TestableOverseer {
  check(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Overloaded testable() — returns PublicOf<T> & TestableInterface
// ---------------------------------------------------------------------------

export function testable(
  instance: EnergyPoller,
): PublicOf<EnergyPoller> & TestableEnergyPoller;
export function testable(
  instance: ChargeController,
): PublicOf<ChargeController> & TestableChargeController;
export function testable(
  instance: AppDatabase,
): PublicOf<AppDatabase> & TestableAppDatabase;
export function testable(
  instance: DataRecorder,
): PublicOf<DataRecorder> & TestableDataRecorder;
export function testable(
  instance: Overseer,
): PublicOf<Overseer> & TestableOverseer;
export function testable(instance: unknown): unknown {
  return instance;
}
