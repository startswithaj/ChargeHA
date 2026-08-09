import type { ChargerKind, ChargeSchedule } from "@chargeha/shared";
import type { ScheduleNotice } from "./ScheduleNotice.tsx";
import {
  type ConflictPoint,
  findScheduleConflicts,
  formatDays,
  formatWindows,
  type ScheduleConflict,
} from "./scheduleConflicts.ts";

/** Mirrors the resolution kinds ChargingPointManager.resolveVehicle returns.
 *  Not exported from shared, so declared here as ChargerCard.tsx does. */
export type ResolutionKind = "linked" | "inferred" | "ambiguous" | "none";

export interface NoticePoint extends ConflictPoint {
  kind: ChargerKind;
  vehicleResolution: ResolutionKind;
}

/** A charger-keyed schedule carries no chargeLimitPct (no battery
 *  visibility), so the vehicle's limit is the strictest one the engine
 *  merges in — see selectActiveChargeSchedule. */
const limitClause = (c: ScheduleConflict): string =>
  c.vehicleLimitPct === null
    ? `${c.vehicleName}'s schedule sets no charge limit`
    : `${c.vehicleName}'s ${c.vehicleLimitPct}% limit still stops the charge`;

const pointNames = (points: NoticePoint[]): string =>
  points.map((p) => p.name).join(", ");

/** Charger-keyed group: the car plugged in here may have its own schedule, and
 *  then both drive this one charger. */
export function chargerNotices(
  point: NoticePoint,
  chargeSchedules: ChargeSchedule[],
): ScheduleNotice[] {
  return findScheduleConflicts([point], chargeSchedules).map((c, index) => ({
    id: `conflict-${c.pointId}-${index}`,
    severity: "warning" as const,
    title: `Two schedules can drive ${c.pointName}`,
    message: `${c.vehicleName} is plugged in here right now, so its schedule ` +
      `applies to this charger too. On ${formatDays(c.days)}, ` +
      `${formatWindows(c.windows)}, both are active: this charger's ` +
      `schedule sets the current (${c.chargerAmps}A) and ${limitClause(c)}. ` +
      `Outside that window each one runs on its own.`,
  }));
}

function runningNotice(
  vehicleName: string,
  points: NoticePoint[],
): ScheduleNotice {
  return {
    id: "vehicle-running",
    severity: "info",
    title: `These schedules are running through ${pointNames(points)}`,
    message:
      `${vehicleName} is plugged into ${pointNames(points)} right now, so ` +
      `ChargeHA applies these schedules there.`,
  };
}

function ambiguousNotice(
  vehicleName: string,
  points: NoticePoint[],
): ScheduleNotice {
  return {
    id: "vehicle-ambiguous",
    severity: "warning",
    title: "These schedules are not running right now",
    message:
      `More than one vehicle is plugged into ${pointNames(points)} and ` +
      `none is assigned to it, so ChargeHA cannot tell which car it is ` +
      `charging and every vehicle schedule does nothing. Assign ` +
      `${vehicleName} to that charger in Settings to fix this.`,
  };
}

function idleNotice(vehicleName: string): ScheduleNotice {
  return {
    id: "vehicle-idle",
    severity: "info",
    title: "These schedules are idle right now",
    message: `No charging point resolves to ${vehicleName} at the moment, so ` +
      `nothing is applying them. They take effect once ${vehicleName} is ` +
      `plugged in at a charger ChargeHA controls.`,
  };
}

/** Vehicle-keyed group: a vehicle schedule only drives a charger while some
 *  charging point resolves to that vehicle (ChargingPointManager.resolveVehicle
 *  — an assignment wins while that car is plugged in, otherwise exactly one
 *  plugged-in car is inferred, and several is ambiguous and resolves to
 *  nothing).
 *
 *  Callers gate this on the vehicle being tied to a smart charger; a
 *  vehicle_api point is linked by construction and has nothing to report.
 *
 *  Every notice is about this instant, because resolution is: the wording has
 *  to stay in the present tense so it cannot read as a permanent claim. */
export function vehicleNotices(
  vehicleId: string,
  vehicleName: string,
  points: NoticePoint[],
): ScheduleNotice[] {
  const smart = points.filter((p) => p.kind === "smart");
  const running = smart.filter((p) => p.resolvedVehicleId === vehicleId);
  if (running.length > 0) return [runningNotice(vehicleName, running)];
  const ambiguous = smart.filter((p) => p.vehicleResolution === "ambiguous");
  if (ambiguous.length > 0) return [ambiguousNotice(vehicleName, ambiguous)];
  return [idleNotice(vehicleName)];
}
