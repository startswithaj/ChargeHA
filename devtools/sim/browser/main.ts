import {
  computeVehicleStats,
  runSimulation,
} from "@chargeha/shared/simulation";
import type { SimResult } from "@chargeha/shared/simulation";

declare const Chart: any;

const VOLTAGE = 230;

// ---- Chart rendering ----

const VEHICLE_COLORS = ["#8b5cf6", "#06b6d4"];
const VEHICLE_BG = ["rgba(139,92,246,0.15)", "rgba(6,182,212,0.15)"];
const BATTERY_COLORS = ["#10b981", "#0891b2"];
const BATTERY_BG = ["rgba(16,185,129,0.1)", "rgba(8,145,178,0.1)"];

let mainChart: any = null;
let batteryChartInstance: any = null;

function renderChart(results: SimResult[], vehicleCount: number) {
  const labels = results.map((r) => r.time);
  const solar = results.map((r) => r.solarW);
  const home = results.map((r) => r.homeW);
  const excess = results.map((r) => r.excessW);

  const vehicleNames = vehicleCount === 1 ? ["EV 1"] : ["EV 1", "EV 2"];

  const vehicleDatasets = vehicleNames.map((name, i) => ({
    label: `${name} Power (W)`,
    data: results.map((r) => r.vehicles[i]?.chargePowerW ?? 0),
    borderColor: VEHICLE_COLORS[i],
    backgroundColor: VEHICLE_BG[i],
    fill: true,
    pointRadius: 0,
    borderWidth: 2,
  }));

  const batteryDatasets = vehicleNames.map((name, i) => ({
    label: `${name} Battery %`,
    data: results.map((r) => r.vehicles[i]?.batteryLevel ?? 0),
    borderColor: BATTERY_COLORS[i],
    backgroundColor: BATTERY_BG[i],
    fill: true,
    pointRadius: 0,
    borderWidth: 2,
  }));

  const statsHtml = computeVehicleStats(results, vehicleNames).map((s) =>
    `<div class="stat"><b>${s.name}</b>: ${s.starts} starts, ${s.stops} stops, battery ${
      s.finalBattery.toFixed(1)
    }%</div>`
  ).join("");

  const statsEl = document.getElementById("statsContainer")!;
  statsEl.innerHTML = statsHtml;
  statsEl.style.display = "flex";

  // Main chart
  const chartEl = document.getElementById("chart") as HTMLCanvasElement;
  chartEl.style.display = "block";
  if (mainChart) mainChart.destroy();
  mainChart = new Chart(chartEl.getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Solar (W)",
          data: solar,
          borderColor: "#f59e0b",
          backgroundColor: "rgba(245,158,11,0.08)",
          fill: true,
          pointRadius: 0,
          borderWidth: 2,
        },
        ...vehicleDatasets,
        {
          label: "Excess (W)",
          data: excess,
          borderColor: "#22c55e",
          backgroundColor: "rgba(34,197,94,0.05)",
          fill: true,
          pointRadius: 0,
          borderWidth: 1,
        },
        {
          label: "Home (W)",
          data: home,
          borderColor: "#ef4444",
          borderWidth: 1,
          pointRadius: 0,
          borderDash: [4, 2],
        },
      ],
    },
    options: {
      responsive: false,
      scales: {
        x: { ticks: { maxTicksLimit: 30, font: { size: 10 } } },
        y: { title: { display: true, text: "Watts" } },
      },
      plugins: { legend: { position: "bottom" } },
      interaction: { mode: "index", intersect: false },
    },
  });

  // Battery chart
  const battEl = document.getElementById("batteryChart") as HTMLCanvasElement;
  battEl.style.display = "block";
  if (batteryChartInstance) batteryChartInstance.destroy();
  batteryChartInstance = new Chart(battEl.getContext("2d"), {
    type: "line",
    data: { labels, datasets: batteryDatasets },
    options: {
      responsive: false,
      scales: {
        x: { ticks: { maxTicksLimit: 30, font: { size: 10 } } },
        y: {
          min: 0,
          max: 100,
          title: { display: true, text: "Battery %" },
        },
      },
      plugins: { legend: { position: "bottom" } },
      interaction: { mode: "index", intersect: false },
    },
  });
}

// ---- Wire up UI ----

// Run on page load
setTimeout(() => (window as any).runSim(), 100);

(window as any).runSim = async () => {
  const btn = document.getElementById("run") as HTMLButtonElement;
  const status = document.getElementById("status")!;
  btn.disabled = true;
  status.textContent = "Running simulation...";

  try {
    const intVal = (id: string, fallback: number) => {
      const v = parseInt(
        (document.getElementById(id) as HTMLInputElement).value,
      );
      return Number.isNaN(v) ? fallback : v;
    };
    const floatVal = (id: string, fallback: number) => {
      const v = parseFloat(
        (document.getElementById(id) as HTMLInputElement).value,
      );
      return Number.isNaN(v) ? fallback : v;
    };

    const seed = intVal("seed", 42);
    const vehicleCount = parseInt(
      (document.getElementById("vehicles") as HTMLSelectElement).value,
    );
    const waterfall =
      (document.getElementById("allocation") as HTMLSelectElement).value ===
        "waterfall";
    const minGenKw =
      (document.getElementById("minGen") as HTMLInputElement).value || "1";
    const graceMin =
      (document.getElementById("grace") as HTMLInputElement).value || "6";
    const cooldownMin =
      (document.getElementById("cooldown") as HTMLInputElement).value || "15";
    const peakSolarKw = intVal("peakSolar", 8);
    const minExcessKw =
      (document.getElementById("minExcess") as HTMLInputElement).value || "";
    const cloudiness = floatVal("cloudiness", 30);
    const storms = intVal("storms", 0);
    const homeLoad = intVal("homeLoad", 1500);
    const sunrise = floatVal("sunrise", 6.5);
    const sunset = floatVal("sunset", 18);
    const ev1Start = intVal("ev1Start", 40);
    const ev1CapacityKwh = intVal("ev1Capacity", 75);
    const ev2Start = intVal("ev2Start", 60);
    const ev2CapacityKwh = intVal("ev2Capacity", 75);
    const ampDebounceThreshold = intVal("ampDebounceThreshold", 2);
    const ampDebounceSettleMinutes = intVal("ampDebounceSettleMinutes", 3);

    const start = performance.now();
    const { results } = runSimulation({
      seed,
      vehicleCount,
      waterfall,
      minGenKw,
      graceMin,
      cooldownMin,
      peakSolarKw,
      minExcessKw,
      cloudiness,
      storms,
      homeLoad,
      sunrise,
      sunset,
      ev1Start,
      ev2Start,
      ev1CapacityKwh,
      ev2CapacityKwh,
      ampDebounceThreshold,
      ampDebounceSettleMinutes,
    });
    const elapsed = Math.round(performance.now() - start);

    const maxChargeW = 32 * VOLTAGE;
    const noteLines = [
      `Max charge rate: ${maxChargeW}W (32A × ${VOLTAGE}V, 1 phase)`,
      `EV 1: ${(maxChargeW / ev1CapacityKwh / 10).toFixed(1)}%/hr at max`,
      vehicleCount > 1
        ? `EV 2: ${(maxChargeW / ev2CapacityKwh / 10).toFixed(1)}%/hr at max`
        : null,
    ].filter(Boolean);
    document.getElementById("simNote")!.textContent = noteLines.join(" · ");

    renderChart(results, vehicleCount);
    status.textContent = `Done in ${elapsed}ms (${results.length} ticks)`;
  } catch (e) {
    status.textContent = `Error: ${e}`;
    console.error(e);
  } finally {
    btn.disabled = false;
  }
};
