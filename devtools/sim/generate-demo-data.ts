/**
 * Generates the demo-mode time series: 90 unique simulated days, downsampled to
 * 15-minute buckets, stored DATELESS and TZ-LESS — each day keyed by a relative
 * offset (0 = most recent) and each reading by local time-of-day ("08:15").
 *
 * The demo runtime assigns real dates at load time (date = today − offset) so the
 * data is always "the last 90 days ending today" for whoever opens it, with no
 * rebuild needed. Aggregation (stats day/month/year) happens in-browser over this
 * series — there is no database here, just the simulation dumped to JSON.
 *
 * Run: deno task gen:demo-data
 */
import { runSimulation } from "../../packages/shared/simulation/mod.ts";
import { DEFAULT_SOLAR_CONFIG } from "../../packages/shared/simulation/mod.ts";
import type { SimulationOptions } from "../../packages/shared/simulation/mod.ts";

const DEMO_DAYS = 90;
const BUCKET_MINUTES = 15;
const OUT_DIR = "packages/client/public/demo";
const OUT_FILE = `${OUT_DIR}/series.json.gz`;

export const DEMO_VEHICLES = [
  {
    id: "SIM-DEMO-001",
    name: "Model 3 SR+",
    capacityKwh: 60,
    start: 55,
    limit: 80,
    priority: 1,
  },
  {
    id: "SIM-DEMO-002",
    name: "Model Y LR",
    capacityKwh: 75,
    start: 45,
    limit: 90,
    priority: 2,
  },
] as const;

interface DemoChargeEntry {
  vehicleId: string;
  w: number;
  amps: number;
  soc: number;
  solarC: number;
  gridC: number;
}

interface DemoReading {
  time: string;
  solarW: number;
  homeW: number;
  gridW: number;
  charge: DemoChargeEntry[];
}

interface DemoLog {
  time: string;
  vehicleId: string;
  vehicleName: string;
  action: string;
  detail: string;
  amps: number | null;
  checksJson: string;
}

interface DemoDay {
  offset: number;
  readings: DemoReading[];
  logs: DemoLog[];
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** Local wall-clock time-of-day for a minute index, e.g. 495 -> "08:15". */
const timeOfDay = (minute: number): string =>
  `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;

const simOptions = (seed: number): SimulationOptions => ({
  seed,
  vehicleCount: 2,
  waterfall: false,
  minGenKw: "1",
  graceMin: "6",
  cooldownMin: "15",
  peakSolarKw: DEFAULT_SOLAR_CONFIG.peakKw,
  minExcessKw: "",
  cloudiness: DEFAULT_SOLAR_CONFIG.cloudiness,
  storms: DEFAULT_SOLAR_CONFIG.storms,
  homeLoad: DEFAULT_SOLAR_CONFIG.homeBaseW,
  sunrise: DEFAULT_SOLAR_CONFIG.sunrise,
  sunset: DEFAULT_SOLAR_CONFIG.sunset,
  ev1Start: DEMO_VEHICLES[0].start,
  ev2Start: DEMO_VEHICLES[1].start,
  ev1CapacityKwh: DEMO_VEHICLES[0].capacityKwh,
  ev2CapacityKwh: DEMO_VEHICLES[1].capacityKwh,
});

interface ChargingVehicle {
  vehicleId: string;
  w: number;
  amps: number;
  soc: number;
}

/** Split available solar excess across charging vehicles, in priority order. */
const allocateSolar = (
  charging: ChargingVehicle[],
  excessW: number,
): DemoChargeEntry[] =>
  charging.reduce(
    (acc, v) => {
      const solarC = Math.min(v.w, acc.remaining);
      return {
        remaining: acc.remaining - solarC,
        rows: [
          ...acc.rows,
          {
            vehicleId: v.vehicleId,
            w: v.w,
            amps: v.amps,
            soc: v.soc,
            solarC: Math.round(solarC),
            gridC: Math.round(v.w - solarC),
          },
        ],
      };
    },
    { remaining: excessW, rows: [] as DemoChargeEntry[] },
  ).rows;

const buildDay = (offset: number): DemoDay => {
  const out = runSimulation(simOptions(69 + offset));
  const buckets = out.results.filter((r) => r.minute % BUCKET_MINUTES === 0);

  const readings = buckets.map((r): DemoReading => {
    const charging = r.vehicles
      .map((v, i) => ({
        vehicleId: DEMO_VEHICLES[i].id,
        w: v.isCharging ? Math.round(v.chargePowerW) : 0,
        amps: v.chargeAmps,
        soc: Math.round(v.batteryLevel),
        isCharging: v.isCharging && v.chargePowerW > 0,
      }))
      .filter((v) => v.isCharging);

    const totalChargeW = charging.reduce((s, v) => s + v.w, 0);
    return {
      time: timeOfDay(r.minute),
      solarW: r.solarW,
      homeW: r.homeW + totalChargeW,
      gridW: r.gridW + totalChargeW,
      charge: allocateSolar(charging, Math.max(0, -r.gridW)),
    };
  });

  const logs = out.events.map((e): DemoLog => {
    const idx = e.vehicleId === "SIM_V1" ? 0 : 1;
    return {
      time: timeOfDay(e.minute),
      vehicleId: DEMO_VEHICLES[idx].id,
      vehicleName: DEMO_VEHICLES[idx].name,
      action: e.action,
      detail: e.detail,
      amps: e.targetAmps,
      checksJson: e.checksJson,
    };
  });

  return { offset, readings, logs };
};

const series = {
  bucketMinutes: BUCKET_MINUTES,
  vehicles: DEMO_VEHICLES.map((v) => ({
    id: v.id,
    name: v.name,
    capacityKwh: v.capacityKwh,
    chargeLimitPercent: v.limit,
    priority: v.priority,
  })),
  days: Array.from({ length: DEMO_DAYS }, (_, i) => buildDay(i)),
};

const json = JSON.stringify(series);
const rawBytes = new TextEncoder().encode(json);

// gzip so the committed artifact is small (~300 KB vs ~5.5 MB); the demo runtime
// decompresses it in-browser via DecompressionStream("gzip").
const gzStream = new Blob([rawBytes]).stream().pipeThrough(
  new CompressionStream("gzip"),
);
const gzBytes = new Uint8Array(await new Response(gzStream).arrayBuffer());

await Deno.mkdir(OUT_DIR, { recursive: true });
await Deno.writeFile(OUT_FILE, gzBytes);

const rawKb = Math.round(rawBytes.length / 1024);
const gzKb = Math.round(gzBytes.length / 1024);
console.log(
  `Wrote ${OUT_FILE} — ${DEMO_DAYS} days, ${
    series.days[0].readings.length
  } buckets/day, ${gzKb} KB gzipped (${rawKb} KB raw)`,
);
