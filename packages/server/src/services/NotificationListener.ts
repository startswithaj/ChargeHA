import type { AppDatabase } from "../db/AppDatabase.ts";
import type { EventMap, TypedEventEmitter } from "./TypedEventEmitter.ts";
import type { NotificationService } from "./NotificationService.ts";
import type { ScheduleService } from "./ScheduleService.ts";
import type { Logger } from "../lib/Logger.ts";
import type { DecisionReason } from "@chargeha/shared/engine";

const DEFAULT_ENERGY_ERROR_THRESHOLD = 6;

/** Single listener: subscribes to all event-bus signals that should produce
 *  user-facing notifications and forwards them to NotificationService. */
export class NotificationListener {
  private energyConsecutiveFailures = 0;
  private energyOutageNotified = false;
  private energyLastSuccessAt: Date | null = null;

  constructor(
    eventEmitter: TypedEventEmitter,
    private readonly notificationService: NotificationService,
    private readonly db: AppDatabase,
    private readonly scheduleService: ScheduleService,
    private readonly logger: Logger,
  ) {
    eventEmitter.subscribe(
      "vehicle_plug_changed",
      (d) => this.onPlugChanged(d),
    );
    eventEmitter.subscribe(
      "vehicle_arrived_home",
      (d) => this.onArrivedHome(d),
    );
    eventEmitter.subscribe("vehicle_error", (d) => this.onVehicleError(d));
    eventEmitter.subscribe(
      "vehicle_mode_changed",
      (d) => this.onModeChanged(d),
    );

    eventEmitter.subscribe(
      "controller_charge_started",
      (d) => this.onChargeStarted(d),
    );
    eventEmitter.subscribe(
      "controller_charge_stopped",
      (d) => this.onChargeStopped(d),
    );
    eventEmitter.subscribe(
      "controller_external_charge",
      (d) => this.onExternalCharge(d),
    );
    eventEmitter.subscribe(
      "controller_blockout_charge",
      (d) => this.onBlockoutCharge(d),
    );
    eventEmitter.subscribe(
      "controller_low_solar",
      (d) => this.onLowSolar(d),
    );
    eventEmitter.subscribe(
      "controller_schedule_activated",
      (d) => this.onScheduleActivated(d),
    );

    eventEmitter.subscribe("energy_poll_success", () => this.onEnergySuccess());
    eventEmitter.subscribe(
      "energy_poll_failure",
      (d) => this.onEnergyFailure(d.error),
    );

    eventEmitter.subscribe("safety_trip", (d) => this.onSafetyTrip(d));
  }

  // ── Vehicle lifecycle ───────────────────────────────────────────────────

  private onPlugChanged(data: EventMap["vehicle_plug_changed"]): void {
    const action = data.isPluggedIn ? "plugged in" : "unplugged";
    this.logger.info(`${data.vehicleName} ${action} — sending notification`);
    this.notificationService.notify(
      data.isPluggedIn ? "vehicle_plugged_in" : "vehicle_unplugged",
      data.isPluggedIn ? "Vehicle Plugged In" : "Vehicle Unplugged",
      `${data.vehicleName} has been ${action}${locationSuffix(data.isHome)}.`,
      vehicleOpts(data),
    );
  }

  private async onArrivedHome(
    data: EventMap["vehicle_arrived_home"],
  ): Promise<void> {
    if (data.isPluggedIn) return;

    const sched = await this.scheduleService.getActiveChargeForVehicle(
      data.vehicleId,
    );
    const target = sched?.chargeLimitPct ?? data.chargeLimit;
    if (data.soc >= target) return;

    this.logger.info(
      `${data.vehicleName} arrived home at ${data.soc}% (target ${target}%) without cable — sending reminder`,
    );
    this.notificationService.notify(
      "arrived_home_not_plugged_in",
      `Plug car in reminder - ${data.soc}%`,
      `${data.vehicleName} arrived home at ${data.soc}%, target is ${target}%. Not plugged in.`,
      vehicleOpts(data),
    );
  }

  private onVehicleError(data: EventMap["vehicle_error"]): void {
    if (!data.error) return;
    const opts = vehicleOpts(data);

    if (isSleepError(data.error)) {
      this.logger.debug(
        `${data.vehicleName} asleep/offline — sending notification`,
      );
      this.notificationService.notify(
        "vehicle_sleep",
        "Vehicle Asleep",
        `${data.vehicleName} is asleep or offline.`,
        opts,
      );
      return;
    }

    if (data.source === "fetch") {
      this.logger.warn(
        `${data.vehicleName} fetch error — sending notification: ${data.error}`,
      );
      this.notificationService.notify(
        "error",
        "Vehicle Fetch Failed",
        `Failed to fetch state for ${data.vehicleName}: ${data.error}`,
        opts,
      );
      return;
    }

    this.logger.warn(
      `${data.vehicleName} command error — sending notification: ${data.error}`,
    );
    this.notificationService.notify(
      "error",
      "Vehicle Command Failed",
      `Command failed for ${data.vehicleName}: ${data.error}`,
      opts,
    );
  }

  private onModeChanged(data: EventMap["vehicle_mode_changed"]): void {
    const { title, message } = modeNotification(data.vehicleName, data.mode);
    this.notificationService.notify(
      "mode_changed",
      title,
      message,
      vehicleOpts(data),
    );
  }

  // ── Charge lifecycle ────────────────────────────────────────────────────

  private onChargeStarted(data: EventMap["controller_charge_started"]): void {
    this.logger.info(
      `${data.vehicleName} charge started — sending notification`,
    );
    this.notificationService.notify(
      "charge_started",
      chargeStartTitle(data.reason),
      `${data.vehicleName} started charging. ${data.actionDetail}`,
      vehicleOpts(data),
    );
  }

  private onChargeStopped(data: EventMap["controller_charge_stopped"]): void {
    this.logger.info(
      `${data.vehicleName} charge stopped — sending notification`,
    );

    if (
      data.reason === "battery_at_limit" &&
      data.batteryLevel != null && data.chargeLimit != null
    ) {
      this.notificationService.notify(
        "charge_complete",
        "Charge Complete",
        `${data.vehicleName} reached its charge limit of ${data.chargeLimit}% (currently ${data.batteryLevel}%).`,
        vehicleOpts(data),
      );
      return;
    }

    const ctx = data.scheduleLimitContext;
    const prefix = ctx
      ? `Stopped at ${ctx.batteryLevel}%. Reached schedule limit (${ctx.scheduleLimitPct}%). `
      : "";
    this.notificationService.notify(
      "charge_stopped",
      "Charging Stopped",
      `${data.vehicleName} stopped charging. ${prefix}${data.actionDetail}`,
      vehicleOpts(data),
    );
  }

  private onExternalCharge(
    data: EventMap["controller_external_charge"],
  ): void {
    this.logger.info(
      `${data.vehicleName} external charge detected — sending notification`,
    );
    this.notificationService.notify(
      "external_charge_detected",
      "External Charging Detected",
      `${data.vehicleName} started charging outside of ChargeHA control.`,
      vehicleOpts(data),
    );
  }

  private onBlockoutCharge(
    data: EventMap["controller_blockout_charge"],
  ): void {
    this.notificationService.notify(
      "external_charge_detected",
      "Charging During Blockout",
      `${data.vehicleName} is charging during a blockout period (${data.startTime}-${data.endTime}). Charging was not started by ChargeHA.`,
      vehicleOpts(data),
    );
  }

  private onLowSolar(data: EventMap["controller_low_solar"]): void {
    this.notificationService.notify(
      "low_solar",
      "Grace Period Started — Low Solar",
      `${data.vehicleName} is entering a ${data.gracePeriodMinutes}-minute grace period. If solar does not return above the minimum amps, charging will stop.`,
      vehicleOpts(data),
    );
  }

  private onScheduleActivated(
    data: EventMap["controller_schedule_activated"],
  ): void {
    const typeLabel = data.scheduleType === "charge" ? "Charge" : "Blockout";
    const status = [
      data.isPluggedIn ? "plugged in" : "unplugged",
      locationLabel(data.isHome),
    ].filter(Boolean).join(", ");
    this.notificationService.notify(
      "schedule_activated",
      "Schedule Activated",
      `${typeLabel} schedule (${data.startTime}-${data.endTime}) is now active for ${data.vehicleName}. Vehicle is ${status}.`,
      vehicleOpts(data),
    );
  }

  // ── Energy ──────────────────────────────────────────────────────────────

  private onEnergySuccess(): void {
    if (this.energyOutageNotified && this.energyLastSuccessAt) {
      const minutes = Math.round(
        (Date.now() - this.energyLastSuccessAt.getTime()) / 60000,
      );
      const plural = minutes !== 1 ? "s" : "";
      this.notificationService.notify(
        "energy_recovered",
        "Energy Source Back Online",
        `Energy source recovered after ${minutes} minute${plural} of downtime.`,
      );
    }
    this.energyConsecutiveFailures = 0;
    this.energyOutageNotified = false;
    this.energyLastSuccessAt = new Date();
  }

  private async onEnergyFailure(error: string): Promise<void> {
    this.energyConsecutiveFailures++;
    const threshold = await this.getEnergyThreshold();
    if (
      this.energyConsecutiveFailures >= threshold && !this.energyOutageNotified
    ) {
      const lastSuccess = this.energyLastSuccessAt
        ? ` Last successful poll: ${this.energyLastSuccessAt.toISOString()}.`
        : "";
      this.notificationService.notify(
        "error",
        "Energy Source Offline",
        `Energy adapter has failed ${this.energyConsecutiveFailures} consecutive polls.${lastSuccess} Error: ${error}`,
      );
      this.energyOutageNotified = true;
    }
  }

  private async getEnergyThreshold(): Promise<number> {
    const raw = await this.db.getConfig("energy_error_threshold");
    if (raw) {
      const parsed = parseInt(raw, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return DEFAULT_ENERGY_ERROR_THRESHOLD;
  }

  // ── Safety ──────────────────────────────────────────────────────────────

  private onSafetyTrip(data: EventMap["safety_trip"]): void {
    this.notificationService.notify(
      "safety_trip",
      "Safety Trip — Charging Disabled",
      `${data.vehicleName} had ${data.cycles} start/stop cycles in ${data.windowMinutes} minutes. Charging has been automatically disabled to prevent oscillation. Re-enable from Settings when ready.`,
      { vehicleName: data.vehicleName, vehicleId: data.vehicleId },
    );
  }
}

function vehicleOpts(data: { vehicleId: string; vehicleName: string }) {
  return { vehicleName: data.vehicleName, vehicleId: data.vehicleId };
}

function locationSuffix(home: boolean | null): string {
  const label = locationLabel(home);
  return label ? ` (${label})` : "";
}

function modeNotification(
  vehicleName: string,
  mode: "auto" | "charge_now" | "stop",
): { title: string; message: string } {
  switch (mode) {
    case "charge_now":
      return {
        title: "Charge Now Activated",
        message:
          `${vehicleName} will charge at full rate until unplugged. Schedules and solar tracking are bypassed.`,
      };
    case "stop":
      return {
        title: "Stop Mode Activated",
        message:
          `${vehicleName} will not charge until it is next unplugged and replugged. Schedules and solar tracking are bypassed.`,
      };
    case "auto":
      return {
        title: "Auto Mode Activated",
        message:
          `${vehicleName} is back on auto. Schedules and solar tracking will resume.`,
      };
  }
}

function chargeStartTitle(reason: DecisionReason): string {
  if (reason === "schedule") return "Scheduled Charging Started";
  if (reason === "solar_tracking") return "Solar Charging Started";
  return "Charging Started";
}

function locationLabel(home: boolean | null): string | null {
  if (home === null) return null;
  return home ? "at home" : "away from home";
}

/** Detect sleep/offline errors that are normal behavior, not failures. */
function isSleepError(error: string): boolean {
  const lower = error.toLowerCase();
  return lower.includes("asleep") || lower.includes("offline") ||
    lower.includes("sleep") || lower.includes("did not respond");
}
