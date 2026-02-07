import type { AppDatabase } from "../db/AppDatabase.ts";

type VehiclePollLogInput = Parameters<AppDatabase["insertVehiclePollLog"]>[0];

export class MockDb {
  inserts: VehiclePollLogInput[] = [];
  shouldReject = false;

  insertVehiclePollLog(input: VehiclePollLogInput): Promise<void> {
    this.inserts.push(input);
    return this.shouldReject
      ? Promise.reject(new Error("db down"))
      : Promise.resolve();
  }
}
