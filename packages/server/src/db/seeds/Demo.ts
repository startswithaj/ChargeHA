import type { AppDatabase } from "../AppDatabase.ts";

/**
 * Demo seed profile — populates the database with realistic-looking data
 * so the dashboard, stats, and logs pages look populated.
 *
 * All timestamps are relative (last 48 hours) so data always looks fresh.
 */

// ---- Vehicle IDs ----
const VEHICLE_1_ID = "SIM-DEMO-001";
const VEHICLE_1_NAME = "Model 3 SR+";
const VEHICLE_2_ID = "SIM-DEMO-002";
const VEHICLE_2_NAME = "Model Y LR";

// ---- Helpers ----

/** Return a UTC ISO string offset from now by `hoursAgo` hours. */
function hoursAgo(hours: number): string {
  const d = new Date(Date.now() - hours * 3600_000);
  return d.toISOString().replace("T", " ").slice(0, 19);
}

/** Return the UTC hour (0-23) for a timestamp `hoursAgo` hours from now. */
function utcHourAt(hoursAgoVal: number): number {
  const d = new Date(Date.now() - hoursAgoVal * 3600_000);
  return d.getUTCHours();
}

/**
 * Estimate sunrise/sunset in UTC for a southern-hemisphere location (~Sydney).
 * March: sunrise ~20:00 UTC prev day (06:00 AEDT), sunset ~08:00 UTC (18:00 AEDT).
 * We simplify to approximate values.
 */
const SUNRISE_UTC = 20; // 06:00 AEDT = 20:00 UTC (previous day conceptually, but hour 20)
const SUNSET_UTC = 8; // 18:00 AEDT = 08:00 UTC

/** Check if a UTC hour is during daytime (handling the day boundary wrap). */
function isDaytime(utcHour: number, minute: number): boolean {
  const frac = utcHour + minute / 60;
  // Daytime wraps around midnight UTC: 20:00 UTC .. 08:00 UTC next day
  return frac >= SUNRISE_UTC || frac <= SUNSET_UTC;
}

/** Get solar production for a given UTC hour/minute. */
function getSolarW(utcHour: number, minute: number): number {
  // Handle the wrap: if hour >= SUNRISE_UTC, map to 0..12; if <= SUNSET_UTC, map to 12..24
  if (!isDaytime(utcHour, minute)) return 0;

  const rawHour = utcHour + minute / 60;
  // Normalize to a contiguous range starting at sunrise
  const fractionalHour = rawHour >= SUNRISE_UTC
    ? rawHour - SUNRISE_UTC
    : (24 - SUNRISE_UTC) + rawHour;
  const dayLength = (24 - SUNRISE_UTC) + SUNSET_UTC; // ~12 hours
  const progress = fractionalHour / dayLength;
  const base = Math.sin(progress * Math.PI) * 6500; // Peak ~6.5kW

  const jitter = 1 + (Math.random() * 0.16 - 0.08);
  return Math.max(0, Math.round(base * jitter));
}

async function seedConfigAndVehicles(db: AppDatabase): Promise<void> {
  await db.setConfig("home_latitude", "-33.8688");
  await db.setConfig("home_longitude", "151.2093");
  await db.setConfig("charging_enabled", "true");
  await db.setConfig("solar_tracking_enabled", "true");
  await db.setConfig("solar_tracking_mode", "solar_only");
  await db.setConfig("solar_reference", "excess");
  await db.setConfig("energy_adapter_type", "fronius_local");
  await db.setPluginConfig("fronius_local.host", "192.168.1.100");
  await db.setConfig("timezone", "Australia/Sydney");

  await db.upsertVehicle({
    id: VEHICLE_1_ID,
    name: VEHICLE_1_NAME,
    adapterType: "simulated",
    priority: 1,
    config: JSON.stringify({
      batteryCapacityKwh: 60,
      maxChargeRateKw: 11,
      voltage: 230,
      phases: 1,
      initialSocPercent: 72,
      chargeLimitPercent: 80,
      vehicleName: VEHICLE_1_NAME,
    }),
    mode: "auto",
  });

  await db.upsertVehicle({
    id: VEHICLE_2_ID,
    name: VEHICLE_2_NAME,
    adapterType: "simulated",
    priority: 2,
    config: JSON.stringify({
      batteryCapacityKwh: 75,
      maxChargeRateKw: 11,
      voltage: 230,
      phases: 1,
      initialSocPercent: 45,
      chargeLimitPercent: 90,
      vehicleName: VEHICLE_2_NAME,
    }),
    mode: "auto",
  });

  await db.createSchedule({
    id: "sched-demo-charge",
    vehicleId: VEHICLE_1_ID,
    scheduleType: "charge",
    startTime: "06:00",
    endTime: "18:00",
    days: ["mon", "tue", "wed", "thu", "fri"],
    chargeAmps: 16,
    chargeLimitPct: 80,
    enabled: true,
  });

  await db.createSchedule({
    id: "sched-demo-blockout",
    vehicleId: null,
    scheduleType: "blockout",
    startTime: "17:00",
    endTime: "21:00",
    days: ["mon", "tue", "wed", "thu", "fri"],
    chargeAmps: null,
    chargeLimitPct: null,
    enabled: true,
  });
}

function seedEnergyReadings(
  sqlite: ReturnType<AppDatabase["getDriver"]>,
  totalReadings: number,
): void {
  Array.from({ length: totalReadings + 1 }, (_, idx) => totalReadings - idx)
    .forEach((i) => {
      const hoursBack = i / 60;
      const ts = hoursAgo(hoursBack);
      const utcH = utcHourAt(hoursBack);
      const d = new Date(Date.now() - hoursBack * 3600_000);
      const minute = d.getUTCMinutes();
      const solarW = getSolarW(utcH, minute);
      const baseLoad = 400 + Math.random() * 400;
      const dayBonus = isDaytime(utcH, minute) ? 200 + Math.random() * 300 : 0;
      const homeConsumptionW = Math.round(baseLoad + dayBonus);
      const gridW = homeConsumptionW - solarW;
      sqlite.prepare(
        `INSERT INTO energy_readings (timestamp, solar_production_w, grid_power_w, home_consumption_w, battery_power_w, battery_soc)
            VALUES (?, ?, ?, ?, NULL, NULL)`,
      ).run(ts, solarW, gridW, homeConsumptionW);
    });
}

function seedChargeReadings(
  sqlite: ReturnType<AppDatabase["getDriver"]>,
  totalReadings: number,
): void {
  Array.from({ length: totalReadings + 1 }, (_, idx) => totalReadings - idx)
    .forEach((i) => {
      const hoursBack = i / 60;
      const ts = hoursAgo(hoursBack);
      const utcH = utcHourAt(hoursBack);
      const d = new Date(Date.now() - hoursBack * 3600_000);
      const minute = d.getUTCMinutes();
      const solarW = getSolarW(utcH, minute);
      if (solarW < 1500) return;
      const excess = Math.max(0, solarW - 500);
      const chargeW = Math.min(excess, 16 * 230);
      if (chargeW < 5 * 230) return;
      const chargeAmps = Math.round(chargeW / 230);
      const solarContribution = Math.min(chargeW, excess);
      const gridContribution = Math.max(0, chargeW - solarContribution);
      const batteryLevel = Math.min(80, 30 + Math.round(i * 0.02));
      sqlite.prepare(
        `INSERT INTO vehicle_charge_readings (timestamp, vehicle_id, charge_power_w, charge_amps, battery_level, solar_contribution_w, grid_contribution_w, is_home)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      ).run(
        ts,
        VEHICLE_1_ID,
        chargeW,
        chargeAmps,
        batteryLevel,
        solarContribution,
        gridContribution,
      );
    });
}

const CONTROLLER_LOG_ENTRIES: ReadonlyArray<
  { hoursBack: number; action: string; detail: string; amps: number | null }
> = [
  {
    hoursBack: 42,
    action: "start",
    detail: "Solar excess detected, starting charge",
    amps: 8,
  },
  {
    hoursBack: 41,
    action: "adjust_amps",
    detail: "Solar increased, adjusting amps up",
    amps: 12,
  },
  {
    hoursBack: 40,
    action: "adjust_amps",
    detail: "Peak solar, max charge rate",
    amps: 16,
  },
  {
    hoursBack: 38,
    action: "adjust_amps",
    detail: "Solar decreasing, reducing amps",
    amps: 10,
  },
  {
    hoursBack: 37,
    action: "stop",
    detail: "Insufficient solar, stopping charge",
    amps: null,
  },
  {
    hoursBack: 36,
    action: "none",
    detail: "No action needed, below minimum solar",
    amps: null,
  },
  {
    hoursBack: 18,
    action: "start",
    detail: "Solar excess detected, starting charge",
    amps: 7,
  },
  {
    hoursBack: 17,
    action: "adjust_amps",
    detail: "Solar increased, adjusting amps up",
    amps: 14,
  },
  {
    hoursBack: 16,
    action: "adjust_amps",
    detail: "Peak solar, max charge rate",
    amps: 16,
  },
  {
    hoursBack: 14,
    action: "adjust_amps",
    detail: "Solar decreasing, reducing amps",
    amps: 11,
  },
  {
    hoursBack: 13,
    action: "adjust_amps",
    detail: "Solar decreasing further",
    amps: 7,
  },
  {
    hoursBack: 12.5,
    action: "stop",
    detail: "Insufficient solar, stopping charge",
    amps: null,
  },
  {
    hoursBack: 6,
    action: "start",
    detail: "Solar excess detected, starting charge",
    amps: 6,
  },
  {
    hoursBack: 5,
    action: "adjust_amps",
    detail: "Solar increased, adjusting amps up",
    amps: 12,
  },
  {
    hoursBack: 4,
    action: "adjust_amps",
    detail: "Peak solar, max charge rate",
    amps: 16,
  },
  {
    hoursBack: 3,
    action: "adjust_amps",
    detail: "Solar decreasing, reducing amps",
    amps: 9,
  },
  {
    hoursBack: 2,
    action: "stop",
    detail: "Insufficient solar, stopping charge",
    amps: null,
  },
];

function seedControllerLogs(
  sqlite: ReturnType<AppDatabase["getDriver"]>,
): void {
  CONTROLLER_LOG_ENTRIES.forEach((entry) => {
    const ts = hoursAgo(entry.hoursBack);
    const inputs = JSON.stringify({
      solarProductionW: entry.amps ? entry.amps * 230 + 500 : 200,
      gridPowerW: entry.amps ? -((entry.amps * 230 + 500) - 800) : 600,
      homeConsumptionW: 800,
      batteryLevel: 55,
      isHome: true,
    });
    const checks = JSON.stringify({
      chargingEnabled: true,
      solarTrackingEnabled: true,
      isHome: true,
      isPluggedIn: true,
      belowChargeLimit: true,
      inSchedule: entry.action !== "none",
      inBlockout: false,
    });

    sqlite.prepare(
      `INSERT INTO controller_logs (timestamp, vehicle_id, vehicle_name, mode, inputs_json, checks_json, action, action_detail, target_amps)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      ts,
      VEHICLE_1_ID,
      VEHICLE_1_NAME,
      "auto",
      inputs,
      checks,
      entry.action,
      entry.detail,
      entry.amps,
    );
  });
}

export async function seed(db: AppDatabase): Promise<void> {
  const sqlite = db.getDriver();
  await seedConfigAndVehicles(db);
  const totalReadings = 48 * 60;
  seedEnergyReadings(sqlite, totalReadings);
  seedChargeReadings(sqlite, totalReadings);
  seedControllerLogs(sqlite);
}
