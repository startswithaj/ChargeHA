import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Button, Heading, Text, Tooltip } from "@radix-ui/themes";
import { X } from "lucide-react";
import {
  type ControllerEvent,
  DEFAULT_SOLAR_CONFIG,
  makeDefaultVehicleConfig,
  runSimulation,
  type SimResult,
  type SimulationOutput,
  type VehicleConfig,
} from "@chargeha/shared/simulation";
import styles from "./Simulator.module.css";

// Loaded lazily via dynamic import
type ChartJs = typeof import("chart.js");
// lazy singleton cache for dynamic import
// deno-lint-ignore custom-no-let/no-let
let chartModulePromise: Promise<ChartJs> | null = null;
function loadChartJs(): Promise<ChartJs> {
  if (!chartModulePromise) {
    chartModulePromise = import("chart.js").then((m) => {
      m.Chart.register(
        m.LineController,
        m.LineElement,
        m.PointElement,
        m.LinearScale,
        m.CategoryScale,
        m.Filler,
        m.Legend,
        m.Tooltip,
      );
      return m;
    });
  }
  return chartModulePromise;
}

interface SimConfig {
  seed: number;
  vehicles: VehicleConfig[];
  waterfall: boolean;
  minGenKw: string;
  graceMin: string;
  cooldownMin: string;
  peakSolarKw: number;
  minExcessKw: string;
  cloudiness: number;
  storms: number;
  homeLoad: number;
  sunrise: number;
  sunset: number;
  batteryCapacityKwh: number;
  batteryMaxRateKw: number;
  batteryStartSoc: number;
  batteryPriorityEnabled: boolean;
  batteryPriorityLimit: number;
}

const DEFAULT_VEHICLES: VehicleConfig[] = [
  makeDefaultVehicleConfig({
    id: "SIM_V1",
    name: "EV 1",
    priority: 1,
    batteryStart: 40,
  }),
  makeDefaultVehicleConfig({
    id: "SIM_V2",
    name: "EV 2",
    priority: 2,
    batteryStart: 60,
  }),
];

const DEFAULTS: SimConfig = {
  seed: DEFAULT_SOLAR_CONFIG.seed,
  vehicles: DEFAULT_VEHICLES,
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
  batteryCapacityKwh: 0,
  batteryMaxRateKw: 5,
  batteryStartSoc: 50,
  batteryPriorityEnabled: false,
  batteryPriorityLimit: 20,
};

const VOLTAGE = 230;

/** Distinct colors per charging point, cycling if there are more points than colors. */
const VEHICLE_COLORS = [
  "#8b5cf6",
  "#06b6d4",
  "#f97316",
  "#ec4899",
  "#84cc16",
];
const VEHICLE_BG = [
  "rgba(139,92,246,0.15)",
  "rgba(6,182,212,0.15)",
  "rgba(249,115,22,0.15)",
  "rgba(236,72,153,0.15)",
  "rgba(132,204,22,0.15)",
];
const BATTERY_COLORS = [
  "#10b981",
  "#0891b2",
  "#ea580c",
  "#db2777",
  "#65a30d",
];
const BATTERY_BG = [
  "rgba(16,185,129,0.1)",
  "rgba(8,145,178,0.1)",
  "rgba(234,88,12,0.1)",
  "rgba(219,39,119,0.1)",
  "rgba(101,163,13,0.1)",
];

type ChartInstanceRef = React.MutableRefObject<
  InstanceType<typeof import("chart.js").Chart> | null
>;

function renderSimCharts(
  {
    chartJs,
    results,
    vehicleNames,
    showHomeBattery,
    powerChartRef,
    batteryChartRef,
    powerChartInstance,
    batteryChartInstance,
  }: {
    chartJs: ChartJs;
    results: SimResult[];
    vehicleNames: string[];
    showHomeBattery: boolean;
    powerChartRef: React.RefObject<HTMLCanvasElement>;
    batteryChartRef: React.RefObject<HTMLCanvasElement>;
    powerChartInstance: ChartInstanceRef;
    batteryChartInstance: ChartInstanceRef;
  },
) {
  const { Chart: ChartCtor } = chartJs;

  if (powerChartInstance.current) powerChartInstance.current.destroy();
  const powerCtx = powerChartRef.current?.getContext("2d");
  if (powerCtx) {
    powerChartInstance.current = new ChartCtor(powerCtx, {
      type: "line",
      data: buildPowerChartData(
        chartJs,
        results,
        vehicleNames,
        showHomeBattery,
      ),
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { maxTicksLimit: 30, font: { size: 10 } } },
          y: { title: { display: true, text: "Watts" } },
        },
        plugins: { legend: { position: "bottom" } },
        interaction: { mode: "index", intersect: false },
      },
    });
  }

  if (batteryChartInstance.current) batteryChartInstance.current.destroy();
  const battCtx = batteryChartRef.current?.getContext("2d");
  if (battCtx) {
    batteryChartInstance.current = new ChartCtor(battCtx, {
      type: "line",
      data: buildBatteryChartData(results, vehicleNames, showHomeBattery),
      options: {
        responsive: true,
        maintainAspectRatio: false,
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
}

function SimResultsBlock(
  { output, powerChartRef, batteryChartRef }: {
    output: SimulationOutput;
    powerChartRef: React.RefObject<HTMLCanvasElement>;
    batteryChartRef: React.RefObject<HTMLCanvasElement>;
  },
) {
  return (
    <>
      <div className={styles.chartContainer} style={{ height: 400 }}>
        <canvas ref={powerChartRef} className={styles.chartCanvas} />
      </div>
      <div className={styles.chartContainer} style={{ height: 200 }}>
        <canvas ref={batteryChartRef} className={styles.chartCanvas} />
      </div>
      <EventsTable events={output.events} />
    </>
  );
}

async function runAndCollect(
  { runConfig, chartJsRef, setRunning, setError, setOutput, setElapsed }: {
    runConfig: SimConfig;
    chartJsRef: React.MutableRefObject<ChartJs | null>;
    setRunning: (b: boolean) => void;
    setError: (e: string | null) => void;
    setOutput: (o: SimulationOutput | null) => void;
    setElapsed: (n: number | null) => void;
  },
) {
  setRunning(true);
  setError(null);
  try {
    const chartJs = await loadChartJs();
    chartJsRef.current = chartJs;
    const start = performance.now();
    const result = runSimulation(runConfig);
    const ms = Math.round(performance.now() - start);
    setOutput(result);
    setElapsed(ms);
  } catch (e) {
    setError(String(e));
    console.error(e);
  } finally {
    setRunning(false);
  }
}

/** Add/remove/edit charging points within the simulator config. */
function useChargingPoints(
  setConfig: React.Dispatch<React.SetStateAction<SimConfig>>,
) {
  const addChargingPoint = useCallback(() => {
    setConfig((prev) => {
      const n = prev.vehicles.length + 1;
      return {
        ...prev,
        vehicles: [
          ...prev.vehicles,
          makeDefaultVehicleConfig({
            id: `SIM_V${n}_${Date.now()}`,
            name: `EV ${n}`,
            priority: n,
            batteryStart: 50,
          }),
        ],
      };
    });
  }, [setConfig]);

  const removeChargingPoint = useCallback((id: string) => {
    setConfig((prev) => ({
      ...prev,
      vehicles: prev.vehicles.filter((v) => v.id !== id),
    }));
  }, [setConfig]);

  const updateChargingPoint = useCallback(
    <K extends keyof VehicleConfig>(
      id: string,
      key: K,
      value: VehicleConfig[K],
    ) => {
      setConfig((prev) => ({
        ...prev,
        vehicles: prev.vehicles.map((v) =>
          v.id === id ? { ...v, [key]: value } : v
        ),
      }));
    },
    [setConfig],
  );

  return { addChargingPoint, removeChargingPoint, updateChargingPoint };
}

/** Runs the simulation and drives the charts off the result: run/random-seed
 *  handlers, in-flight state, and the chart-render effect. */
function useSimRun(config: SimConfig, setConfig: (c: SimConfig) => void) {
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<SimulationOutput | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const {
    powerChartRef,
    batteryChartRef,
    powerChartInstance,
    batteryChartInstance,
    chartJsRef,
  } = useChartRefs();

  const handleRun = useCallback(async (configOverride?: Partial<SimConfig>) => {
    const runConfig = configOverride
      ? { ...config, ...configOverride }
      : config;
    if (configOverride) setConfig(runConfig);
    await runAndCollect({
      runConfig,
      chartJsRef,
      setRunning,
      setError,
      setOutput,
      setElapsed,
    });
  }, [config, setConfig, chartJsRef]);

  const randomSeed = useCallback(() => {
    handleRun({ seed: Math.floor(Math.random() * 10000) });
  }, [handleRun]);

  const vehicleNames = config.vehicles.map((v) => v.name);

  useRenderSimCharts({
    output,
    vehicleNames,
    batteryCapacityKwh: config.batteryCapacityKwh,
    chartJsRef,
    powerChartRef,
    batteryChartRef,
    powerChartInstance,
    batteryChartInstance,
  });

  return {
    running,
    output,
    elapsed,
    error,
    handleRun,
    randomSeed,
    vehicleNames,
    powerChartRef,
    batteryChartRef,
  };
}

function useRenderSimCharts(
  { output, vehicleNames, batteryCapacityKwh, chartJsRef, ...refs }: {
    output: SimulationOutput | null;
    vehicleNames: string[];
    batteryCapacityKwh: number;
    chartJsRef: React.MutableRefObject<ChartJs | null>;
    powerChartRef: React.RefObject<HTMLCanvasElement>;
    batteryChartRef: React.RefObject<HTMLCanvasElement>;
    powerChartInstance: ChartInstanceRef;
    batteryChartInstance: ChartInstanceRef;
  },
) {
  // Render charts after React has mounted the canvas elements
  useEffect(() => {
    if (!output || !chartJsRef.current) return;
    renderSimCharts({
      chartJs: chartJsRef.current,
      results: output.results,
      vehicleNames,
      showHomeBattery: batteryCapacityKwh > 0,
      ...refs,
    });
    // vehicleNames is derived fresh each render from config.vehicles; compare by
    // its joined value so reordering/renaming re-renders without an extra ref.
    // Refs (chartJsRef, powerChartRef, etc.) are intentionally omitted — they
    // are stable across renders and reading .current in the effect is safe.
  }, [output, vehicleNames.join(","), batteryCapacityKwh]);
}

function useChartRefs() {
  const powerChartRef = useRef<HTMLCanvasElement>(null);
  const batteryChartRef = useRef<HTMLCanvasElement>(null);
  const powerChartInstance = useRef<
    InstanceType<typeof import("chart.js").Chart> | null
  >(null);
  const batteryChartInstance = useRef<
    InstanceType<typeof import("chart.js").Chart> | null
  >(null);
  const chartJsRef = useRef<ChartJs | null>(null);
  return {
    powerChartRef,
    batteryChartRef,
    powerChartInstance,
    batteryChartInstance,
    chartJsRef,
  };
}

function buildNoteLines(config: SimConfig): string {
  const rateLines = config.vehicles.map((v) => {
    const maxChargeW = v.chargeAmpsMax * VOLTAGE;
    const rate = (maxChargeW / v.batteryCapacityKwh / 10).toFixed(1);
    return `${v.name}: ${maxChargeW}W max, ${rate}%/hr at max`;
  });
  return rateLines.join(" · ");
}

function ActionRow(
  { running, handleRun, randomSeed, elapsed, output, error }: {
    running: boolean;
    handleRun: () => void;
    randomSeed: () => void;
    elapsed: number | null;
    output: SimulationOutput | null;
    error: string | null;
  },
) {
  return (
    <div className={styles.actions}>
      <Button onClick={handleRun} disabled={running}>
        {running ? "Running..." : "Run Simulation"}
      </Button>
      <Button variant="soft" onClick={randomSeed}>Random Seed</Button>
      <Tooltip content="The seed controls the random cloud and home load patterns. Same seed = same results. Random seed lets you explore different weather scenarios.">
        <Text size="1" color="gray" style={{ cursor: "help" }}>&#9432;</Text>
      </Tooltip>
      {elapsed !== null && (
        <Text size="2" color="gray">
          Done in {elapsed}ms ({output?.results.length} ticks)
        </Text>
      )}
      {error && <Text size="2" color="red">{error}</Text>}
    </div>
  );
}

function homeBatteryPowerDataset(results: SimResult[]) {
  return {
    // Display-only: batteryW is +discharge/-charge (matches gridPowerW's
    // import-positive convention). Flipped here so the chart reads
    // +charge/-discharge, which is not how the engine interprets the value.
    label: "Home Battery (W, + charge / - discharge)",
    data: results.map((r) => -r.batteryW),
    borderColor: "#a855f7",
    borderWidth: 1,
    pointRadius: 0,
    borderDash: [2, 2],
  };
}

function homeBatterySocDataset(results: SimResult[]) {
  return {
    label: "Home Battery %",
    data: results.map((r) => r.batterySoc),
    borderColor: "#a855f7",
    backgroundColor: "rgba(168,85,247,0.1)",
    fill: true,
    pointRadius: 0,
    borderWidth: 2,
  };
}

function buildPowerChartData(
  _chartJs: ChartJs,
  results: SimResult[],
  vehicleNames: string[],
  showHomeBattery: boolean,
) {
  const labels = results.map((r) => r.time);
  return {
    labels,
    datasets: [
      {
        label: "Solar (W)",
        data: results.map((r) => r.solarW),
        borderColor: "#f59e0b",
        backgroundColor: "rgba(245,158,11,0.08)",
        fill: true,
        pointRadius: 0,
        borderWidth: 2,
      },
      ...vehicleNames.map((name, i) => ({
        label: `${name} Power (W)`,
        data: results.map((r) => r.vehicles[i]?.chargePowerW ?? 0),
        borderColor: VEHICLE_COLORS[i % VEHICLE_COLORS.length],
        backgroundColor: VEHICLE_BG[i % VEHICLE_BG.length],
        fill: true,
        pointRadius: 0,
        borderWidth: 2,
      })),
      {
        label: "Excess (W)",
        data: results.map((r) => r.excessW),
        borderColor: "#22c55e",
        backgroundColor: "rgba(34,197,94,0.05)",
        fill: true,
        pointRadius: 0,
        borderWidth: 1,
      },
      {
        label: "Home (W)",
        data: results.map((r) => r.homeW),
        borderColor: "#ef4444",
        borderWidth: 1,
        pointRadius: 0,
        borderDash: [4, 2],
      },
      ...(showHomeBattery ? [homeBatteryPowerDataset(results)] : []),
    ],
  };
}

function buildBatteryChartData(
  results: SimResult[],
  vehicleNames: string[],
  showHomeBattery: boolean,
) {
  const labels = results.map((r) => r.time);
  return {
    labels,
    datasets: [
      ...vehicleNames.map((name, i) => ({
        label: `${name} Battery %`,
        data: results.map((r) => r.vehicles[i]?.batteryLevel ?? 0),
        borderColor: BATTERY_COLORS[i % BATTERY_COLORS.length],
        backgroundColor: BATTERY_BG[i % BATTERY_BG.length],
        fill: true,
        pointRadius: 0,
        borderWidth: 2,
      })),
      ...(showHomeBattery ? [homeBatterySocDataset(results)] : []),
    ],
  };
}

export function Simulator() {
  const [config, setConfig] = useState<SimConfig>(DEFAULTS);

  const set = useCallback(
    <K extends keyof SimConfig>(key: K, value: SimConfig[K]) => {
      setConfig((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const { addChargingPoint, removeChargingPoint, updateChargingPoint } =
    useChargingPoints(setConfig);

  const {
    running,
    output,
    elapsed,
    error,
    handleRun,
    randomSeed,
    vehicleNames,
    powerChartRef,
    batteryChartRef,
  } = useSimRun(config, setConfig);

  const noteLines = output ? buildNoteLines(config) : null;

  return (
    <div className={styles.simulator}>
      <Heading size="5">Charge Controller Simulator</Heading>
      <Text size="2" color="gray">
        Runs the real charge controller decision engine against a simulated
        solar day. Results reflect exactly how the controller would behave with
        the configured solar profile and vehicle setup.
      </Text>

      <SimControls
        config={config}
        set={set}
        addChargingPoint={addChargingPoint}
        removeChargingPoint={removeChargingPoint}
        updateChargingPoint={updateChargingPoint}
      />

      <ActionRow
        running={running}
        handleRun={() => handleRun()}
        randomSeed={randomSeed}
        elapsed={elapsed}
        output={output}
        error={error}
      />

      {noteLines && <div className={styles.simNote}>{noteLines}</div>}

      {output && (
        <SimStats results={output.results} vehicleNames={vehicleNames} />
      )}

      {output && (
        <SimResultsBlock
          output={output}
          powerChartRef={powerChartRef}
          batteryChartRef={batteryChartRef}
        />
      )}
    </div>
  );
}

// ---- Sub-components ----

function SolarProfileSection(
  { config, set }: {
    config: SimConfig;
    set: <K extends keyof SimConfig>(key: K, value: SimConfig[K]) => void;
  },
) {
  return (
    <>
      <div className={styles.sectionLabel}>Solar Profile</div>
      <div className={styles.controls}>
        <NumInput
          label="Peak Solar (kW)"
          value={config.peakSolarKw}
          onChange={(v) => set("peakSolarKw", v)}
          step={1}
          min={1}
        />
        <NumInput
          label="Cloudiness %"
          value={config.cloudiness}
          onChange={(v) => set("cloudiness", v)}
          step={1}
          min={0}
          max={100}
        />
        <NumInput
          label="Storm Events"
          value={config.storms}
          onChange={(v) => set("storms", v)}
          step={1}
          min={0}
          max={5}
        />
        <NumInput
          label="Home Load (W)"
          value={config.homeLoad}
          onChange={(v) => set("homeLoad", v)}
          step={100}
          min={0}
        />
        <NumInput
          label="Sunrise"
          value={config.sunrise}
          onChange={(v) => set("sunrise", v)}
          step={0.5}
          min={4}
          max={9}
        />
        <NumInput
          label="Sunset"
          value={config.sunset}
          onChange={(v) => set("sunset", v)}
          step={0.5}
          min={15}
          max={21}
        />
      </div>
    </>
  );
}

function ChargingPointRow(
  { vehicle, canRemove, update, remove }: {
    vehicle: VehicleConfig;
    canRemove: boolean;
    update: <K extends keyof VehicleConfig>(
      key: K,
      value: VehicleConfig[K],
    ) => void;
    remove: () => void;
  },
) {
  return (
    <div className={styles.chargingPoint}>
      <div className={styles.control}>
        <label>Name</label>
        <input
          className={styles.chargingPointName}
          type="text"
          aria-label="Name"
          value={vehicle.name}
          onChange={(e) => update("name", e.target.value)}
        />
      </div>
      <NumInput
        label="Priority"
        value={vehicle.priority}
        onChange={(v) => update("priority", v)}
        step={1}
        min={1}
      />
      <NumInput
        label="Battery Start %"
        value={vehicle.batteryStart}
        onChange={(v) => update("batteryStart", v)}
        step={5}
        min={0}
        max={100}
      />
      <NumInput
        label="Charge Limit %"
        value={vehicle.chargeLimit}
        onChange={(v) => update("chargeLimit", v)}
        step={5}
        min={1}
        max={100}
      />
      <NumInput
        label="Battery (kWh)"
        value={vehicle.batteryCapacityKwh}
        onChange={(v) => update("batteryCapacityKwh", v)}
        step={5}
        min={10}
        max={200}
      />
      <NumInput
        label="Min Amps"
        value={vehicle.chargeAmpsMin}
        onChange={(v) => update("chargeAmpsMin", v)}
        step={1}
        min={1}
        max={32}
      />
      <NumInput
        label="Max Amps"
        value={vehicle.chargeAmpsMax}
        onChange={(v) => update("chargeAmpsMax", v)}
        step={1}
        min={1}
        max={32}
      />
      <Tooltip
        content={canRemove
          ? "Remove charging point"
          : "At least one charging point is required"}
      >
        <Button
          size="1"
          variant="soft"
          color="red"
          disabled={!canRemove}
          onClick={remove}
          aria-label={`Remove ${vehicle.name}`}
        >
          <X size={14} />
        </Button>
      </Tooltip>
    </div>
  );
}

function ChargingPointsSection(
  { vehicles, addChargingPoint, removeChargingPoint, updateChargingPoint }: {
    vehicles: VehicleConfig[];
    addChargingPoint: () => void;
    removeChargingPoint: (id: string) => void;
    updateChargingPoint: <K extends keyof VehicleConfig>(
      id: string,
      key: K,
      value: VehicleConfig[K],
    ) => void;
  },
) {
  return (
    <>
      <div className={styles.sectionLabel}>Charging Points</div>
      <div className={styles.chargingPoints}>
        {vehicles.map((v) => (
          <ChargingPointRow
            key={v.id}
            vehicle={v}
            canRemove={vehicles.length > 1}
            update={(key, value) => updateChargingPoint(v.id, key, value)}
            remove={() => removeChargingPoint(v.id)}
          />
        ))}
      </div>
      <Button size="1" variant="soft" onClick={addChargingPoint}>
        + Add Charging Point
      </Button>
    </>
  );
}

function HomeBatterySection(
  { config, set }: {
    config: SimConfig;
    set: <K extends keyof SimConfig>(key: K, value: SimConfig[K]) => void;
  },
) {
  return (
    <>
      <div className={styles.sectionLabel}>Home Battery</div>
      <div className={styles.controls}>
        <NumInput
          label="Capacity (kWh)"
          value={config.batteryCapacityKwh}
          onChange={(v) => set("batteryCapacityKwh", v)}
          step={1}
          min={0}
          max={50}
        />
        <NumInput
          label="Max Rate (kW)"
          value={config.batteryMaxRateKw}
          onChange={(v) => set("batteryMaxRateKw", v)}
          step={0.5}
          min={0}
          max={20}
          help="The inverter's charge/discharge power limit — how fast the battery can charge or discharge, independent of its capacity."
        />
        <NumInput
          label="Start SoC %"
          value={config.batteryStartSoc}
          onChange={(v) => set("batteryStartSoc", v)}
          step={5}
          min={0}
          max={100}
        />
        <div className={styles.control}>
          <label>Battery Priority</label>
          <select
            value={config.batteryPriorityEnabled ? "on" : "off"}
            onChange={(e) =>
              set("batteryPriorityEnabled", e.target.value === "on")}
          >
            <option value="off">Off</option>
            <option value="on">On</option>
          </select>
        </div>
        {config.batteryPriorityEnabled && (
          <NumInput
            label="Priority Limit %"
            value={config.batteryPriorityLimit}
            onChange={(v) => set("batteryPriorityLimit", v)}
            step={5}
            min={0}
            max={100}
          />
        )}
      </div>
    </>
  );
}

function SimControls({
  config,
  set,
  addChargingPoint,
  removeChargingPoint,
  updateChargingPoint,
}: {
  config: SimConfig;
  set: <K extends keyof SimConfig>(key: K, value: SimConfig[K]) => void;
  addChargingPoint: () => void;
  removeChargingPoint: (id: string) => void;
  updateChargingPoint: <K extends keyof VehicleConfig>(
    id: string,
    key: K,
    value: VehicleConfig[K],
  ) => void;
}) {
  return (
    <>
      <div className={styles.controls}>
        <NumInput
          label="Seed"
          value={config.seed}
          onChange={(v) => set("seed", v)}
          step={1}
        />
        <div className={styles.control}>
          <label>Allocation</label>
          <select
            value={config.waterfall ? "waterfall" : "equal"}
            onChange={(e) => set("waterfall", e.target.value === "waterfall")}
          >
            <option value="equal">Equal</option>
            <option value="waterfall">Waterfall (priority)</option>
          </select>
        </div>
      </div>

      <div className={styles.sectionLabel}>Controller</div>
      <div className={styles.controls}>
        <StrInput
          label="Min Generation (kW)"
          value={config.minGenKw}
          onChange={(v) => set("minGenKw", v)}
        />
        <StrInput
          label="Grace (min)"
          value={config.graceMin}
          onChange={(v) => set("graceMin", v)}
        />
        <StrInput
          label="Cooldown (min)"
          value={config.cooldownMin}
          onChange={(v) => set("cooldownMin", v)}
        />
        <StrInput
          label="Min Excess Solar (kW)"
          value={config.minExcessKw}
          onChange={(v) => set("minExcessKw", v)}
          placeholder="Disabled"
        />
      </div>

      <SolarProfileSection config={config} set={set} />
      <ChargingPointsSection
        vehicles={config.vehicles}
        addChargingPoint={addChargingPoint}
        removeChargingPoint={removeChargingPoint}
        updateChargingPoint={updateChargingPoint}
      />
      <HomeBatterySection config={config} set={set} />
    </>
  );
}

function NumInput({
  label,
  value,
  onChange,
  step,
  min,
  max,
  help,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  help?: string;
}) {
  const [draft, setDraft] = useState(String(value));

  // Sync draft when value changes externally (e.g. random seed)
  useEffect(() => setDraft(String(value)), [value]);

  return (
    <div className={styles.control}>
      <label>
        {label}
        {help && (
          <Tooltip content={help}>
            <Text size="1" color="gray" style={{ cursor: "help" }}>
              &#9432;
            </Text>
          </Tooltip>
        )}
      </label>
      <input
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Number(draft);
          if (draft !== "" && !Number.isNaN(n)) onChange(n);
          else setDraft(String(value));
        }}
        step={step}
        min={min}
        max={max}
      />
    </div>
  );
}

function StrInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className={styles.control}>
      <label>{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ width: 90 }}
      />
    </div>
  );
}

function SimStats({
  results,
  vehicleNames,
}: {
  results: SimResult[];
  vehicleNames: string[];
}) {
  return (
    <div className={styles.statsRow}>
      {vehicleNames.map((name, i) => {
        // state transition counters, each iteration depends on previous
        // deno-lint-ignore custom-no-let/no-let
        let starts = 0;
        // deno-lint-ignore custom-no-let/no-let
        let stops = 0;
        // deno-lint-ignore custom-no-let/no-let
        let wasCharging = false;
        // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
        for (const r of results) {
          const charging = (r.vehicles[i]?.chargePowerW ?? 0) > 0;
          if (charging && !wasCharging) starts++;
          if (!charging && wasCharging) stops++;
          wasCharging = charging;
        }
        const battery = results[results.length - 1].vehicles[i]?.batteryLevel ??
          0;
        return (
          <div key={name} className={styles.stat}>
            <b>{name}</b>: {starts} starts, {stops} stops, battery{" "}
            {battery.toFixed(1)}%
          </div>
        );
      })}
    </div>
  );
}

function EventsTable({ events }: { events: ControllerEvent[] }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (events.length === 0) return null;

  return (
    <div className={styles.eventsSection}>
      <Heading size="3">Events ({events.length})</Heading>
      <table className={styles.eventsTable}>
        <thead>
          <tr>
            <th>Time</th>
            <th>Vehicle</th>
            <th>Action</th>
            <th>Detail</th>
            <th>Amps</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event, idx) => {
            const isExpanded = expandedIdx === idx;
            const ACTION_CLASS_MAP: Record<string, string> = {
              start: styles.actionStart,
              stop: styles.actionStop,
            };
            const actionClass = ACTION_CLASS_MAP[event.action] ??
              styles.actionAdjust;

            // try/catch parse with fallback
            // deno-lint-ignore custom-no-let/no-let
            let checks: Array<{ check: string; result: string }> = [];
            try {
              checks = JSON.parse(event.checksJson);
            } catch (e) {
              console.warn("Failed to parse checksJson:", e);
            }

            return (
              <Fragment key={idx}>
                <tr
                  className={styles.eventRow}
                  onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                >
                  <td>{event.time}</td>
                  <td>{event.vehicleName}</td>
                  <td className={actionClass}>{event.action}</td>
                  <td>{event.detail}</td>
                  <td>
                    {event.targetAmps !== null ? `${event.targetAmps}A` : "-"}
                  </td>
                </tr>
                {isExpanded && checks.length > 0 && (
                  <tr className={styles.checksRow}>
                    <td colSpan={5}>
                      <div className={styles.checksList}>
                        {checks.map((c, ci) => (
                          <div key={ci} className={styles.checkItem}>
                            <span className={styles.checkName}>{c.check}</span>
                            <span className={styles.checkResult}>
                              {c.result}
                            </span>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
