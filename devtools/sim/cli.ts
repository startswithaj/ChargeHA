/**
 * Runs the charge sim and outputs per-minute data + summary stats to stdout.
 * Useful for analysing controller behaviour (amp changes, start/stop frequency).
 *
 * Run: deno run -A devtools/sim/cli.ts
 *      deno run -A devtools/sim/cli.ts --vehicles=2
 *      deno run -A devtools/sim/cli.ts --csv
 *      deno run -A devtools/sim/cli.ts --waterfall
 *      deno run -A devtools/sim/cli.ts --seed=123
 */

import {
  computeVehicleStats,
  runSimulation,
} from "../../packages/shared/simulation/mod.ts";
import type { SimResult } from "../../packages/shared/simulation/mod.ts";

const csv = Deno.args.includes("--csv");
const vehicleCount = Deno.args.includes("--vehicles=2") ? 2 : 1;
const waterfall = Deno.args.includes("--waterfall");
const seedArg = Deno.args.find((a) => a.startsWith("--seed="));
const seed = seedArg ? parseInt(seedArg.split("=")[1]) : 42;

const VEHICLE_NAMES = ["EV 1", "EV 2"].slice(0, vehicleCount);

const { results } = runSimulation({
  seed,
  vehicleCount,
  waterfall,
  minGenKw: "1",
  graceMin: "6",
  cooldownMin: "15",
  peakSolarKw: 8,
  minExcessKw: "",
  cloudiness: 30,
  storms: 0,
  homeLoad: 1500,
  sunrise: 6.5,
  sunset: 18,
  ev1Start: 40,
  ev2Start: 60,
  ev1CapacityKwh: 75,
  ev2CapacityKwh: 75,
});

function printCsv(results: SimResult[]): void {
  const vehicleHeaders = VEHICLE_NAMES.flatMap((name) => [
    `${name}_amps`,
    `${name}_powerW`,
    `${name}_charging`,
    `${name}_battery`,
  ]);
  console.log(
    ["time", "solarW", "homeW", "gridW", "excessW", ...vehicleHeaders].join(
      ",",
    ),
  );

  results.forEach((r) => {
    const vehicleCols = VEHICLE_NAMES.flatMap((_, i) => {
      const v = r.vehicles[i];
      return [
        v.chargeAmps,
        v.chargePowerW,
        v.isCharging ? 1 : 0,
        v.batteryLevel.toFixed(1),
      ];
    });
    console.log(
      [r.time, r.solarW, r.homeW, r.gridW, r.excessW, ...vehicleCols].join(","),
    );
  });
}

function printSummary(): void {
  const stats = computeVehicleStats(results, VEHICLE_NAMES);

  console.log("=== Simulation Summary ===\n");

  for (const s of stats) {
    const chargingHours = (s.chargingMinutes / 60).toFixed(1);
    const callsPerHour = s.chargingMinutes > 0
      ? (s.totalCalls / (s.chargingMinutes / 60)).toFixed(1)
      : "0";

    console.log(`${s.name}:`);
    console.log(`  Starts:          ${s.starts}`);
    console.log(`  Stops:           ${s.stops}`);
    console.log(`  Amp adjustments: ${s.ampChanges}`);
    console.log(`  Total API calls: ${s.totalCalls}`);
    console.log(
      `  Calls/hour:      ${callsPerHour} (during ${chargingHours}h charging)`,
    );
    console.log(`  Final battery:   ${s.finalBattery.toFixed(1)}%`);
    console.log();
  }

  for (const s of stats) {
    console.log(`--- ${s.name} amp changes ---`);
    for (const entry of s.ampChangeLog) {
      const direction = entry.to > entry.from ? "+" : "";
      const delta = entry.to - entry.from;
      console.log(
        `  ${entry.time}  ${entry.from}A → ${entry.to}A (${direction}${delta})`,
      );
    }
    console.log();
  }
}

if (csv) {
  printCsv(results);
} else {
  printSummary();
}
