import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Link,
  Select,
  Slider,
  Text,
} from "@radix-ui/themes";
import { RotateCcw } from "lucide-react";
import { useRouter } from "../../hooks/useRouter.ts";
import type { DayOfWeek, EnergyData, Schedule } from "@chargeha/shared";
import type { VehicleWithState } from "@chargeha/shared";
import {
  parseConfigToSolarConfig,
  simulateSolarAllocation,
  type SimulationResult,
  type SimVehicle,
  type VehicleAllocation,
} from "../../lib/simulateSolarAllocation.ts";
import { TimePicker } from "../TimePicker/TimePicker.tsx";
import styles from "./SolarSimulation.module.css";

interface SolarSimulationProps {
  config: Record<string, string>;
  vehicles: VehicleWithState[];
  currentEnergy: EnergyData | null;
  schedules: Schedule[];
}

type VehicleMode = "auto" | "charge_now" | "stop";
type SetOverride = (
  id: string,
  key: "batteryLevel" | "mode",
  value: number | string,
) => void;

const DAYS: { value: DayOfWeek; label: string }[] = [
  { value: "mon", label: "Mon" },
  { value: "tue", label: "Tue" },
  { value: "wed", label: "Wed" },
  { value: "thu", label: "Thu" },
  { value: "fri", label: "Fri" },
  { value: "sat", label: "Sat" },
  { value: "sun", label: "Sun" },
];

function getCurrentTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${
    String(Math.floor(now.getMinutes() / 15) * 15).padStart(2, "0")
  }`;
}

function getCurrentDay(): DayOfWeek {
  const days: DayOfWeek[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return days[new Date().getDay()];
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 28 }}
    >
      <Text size="2" style={{ minWidth: 130 }}>{label}</Text>
      <Slider
        size="1"
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        style={{ flex: 1 }}
      />
      <Text
        size="2"
        weight="medium"
        style={{ minWidth: 60, textAlign: "right" }}
      >
        {unit === "%"
          ? `${Math.round(value)}${unit}`
          : `${value.toFixed(1)} ${unit}`}
      </Text>
    </div>
  );
}

function DayPickerRow(
  { simulatedDay, setSimulatedDay }: {
    simulatedDay: DayOfWeek;
    setSimulatedDay: (d: DayOfWeek) => void;
  },
) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        minHeight: 28,
      }}
    >
      <Text size="2" style={{ minWidth: 130 }}>Day</Text>
      <div style={{ display: "flex", gap: 4 }}>
        {DAYS.map((d) => (
          <Button
            key={d.value}
            size="1"
            variant={simulatedDay === d.value ? "solid" : "soft"}
            onClick={() => setSimulatedDay(d.value)}
            style={{ minWidth: 38, padding: "0 6px" }}
          >
            {d.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function AllocationBadge({ allocation }: { allocation: VehicleAllocation }) {
  if (allocation.action === "charging") {
    return (
      <>
        <Badge
          color={allocation.scheduleName ? "blue" : "green"}
          size="1"
          variant="soft"
        >
          {allocation.scheduleName ? "Scheduled" : "Charging"}
        </Badge>
        <Text size="1">
          {allocation.allocatedAmps}A ({allocation.solarKw.toFixed(1)} kW solar
          {allocation.gridKw > 0 &&
            ` + ${allocation.gridKw.toFixed(1)} kW grid`})
        </Text>
      </>
    );
  }
  return (
    <>
      <Badge color="gray" size="1" variant="soft">Skipped</Badge>
      <Text size="1" color="gray">{allocation.reason}</Text>
    </>
  );
}

function VehicleSimRow(
  { v, allocation, setVehicleOverride }: {
    v: SimVehicle;
    allocation: VehicleAllocation;
    setVehicleOverride: SetOverride;
  },
) {
  return (
    <div className={styles.vehicleRow}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Badge variant="outline" size="1">#{v.priority}</Badge>
          <Text size="2" weight="medium">{v.name}</Text>
        </div>
        <Select.Root
          size="1"
          value={v.mode}
          onValueChange={(val) => setVehicleOverride(v.id, "mode", val)}
        >
          <Select.Trigger variant="ghost" style={{ minWidth: 100 }} />
          <Select.Content>
            <Select.Item value="auto">Auto</Select.Item>
            <Select.Item value="charge_now">Charge Now</Select.Item>
            <Select.Item value="stop">Stop</Select.Item>
          </Select.Content>
        </Select.Root>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Text size="1" color="gray" style={{ minWidth: 50 }}>Battery</Text>
        <Slider
          size="1"
          min={0}
          max={100}
          step={1}
          value={[v.batteryLevel]}
          onValueChange={([val]) =>
            setVehicleOverride(v.id, "batteryLevel", val)}
          style={{ flex: 1 }}
        />
        <Text size="1" style={{ minWidth: 70, textAlign: "right" }}>
          {v.batteryLevel}% → {v.chargeLimit}%
        </Text>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginTop: 2,
        }}
      >
        <AllocationBadge allocation={allocation} />
      </div>
    </div>
  );
}

function VehicleList(
  { simVehicles, result, setVehicleOverride }: {
    simVehicles: SimVehicle[];
    result: SimulationResult;
    setVehicleOverride: SetOverride;
  },
) {
  if (simVehicles.length === 0) {
    return (
      <Text size="2" color="gray">
        No vehicles with charge state available. Add a vehicle and wait for it
        to report state.
      </Text>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Text size="2" weight="medium" color="gray">Vehicles</Text>
      {simVehicles.map((v) => {
        const allocation = result.vehicles.find((a) => a.id === v.id);
        if (!allocation) return null;
        return (
          <VehicleSimRow
            key={v.id}
            v={v}
            allocation={allocation}
            setVehicleOverride={setVehicleOverride}
          />
        );
      })}
    </div>
  );
}

function SummaryBar(
  { solarKw, consumptionKw, result }: {
    solarKw: number;
    consumptionKw: number;
    result: SimulationResult;
  },
) {
  return (
    <div className={styles.summaryBar}>
      <div className={styles.resultTag}>
        <Text size="1" color="gray">Solar:</Text>
        <Text size="2" weight="medium">{solarKw.toFixed(1)} kW</Text>
      </div>
      <div className={styles.resultTag}>
        <Text size="1" color="gray">Home:</Text>
        <Text size="2" weight="medium">{consumptionKw.toFixed(1)} kW</Text>
      </div>
      <div className={styles.resultTag}>
        <Text size="1" color="gray">Excess:</Text>
        <Text size="2" weight="medium">
          {Math.max(0, solarKw - consumptionKw).toFixed(1)} kW
        </Text>
      </div>
      <div className={styles.resultTag}>
        <Text size="1" color="gray">EVs:</Text>
        <Text size="2" weight="medium">
          {result.totalChargingKw.toFixed(1)} kW
        </Text>
      </div>
      <div className={styles.resultTag}>
        <Text size="1" color="gray">Grid Import:</Text>
        <Text
          size="2"
          weight="medium"
          color={result.gridImportKw > 0 ? "orange" : undefined}
        >
          {result.gridImportKw.toFixed(1)} kW
        </Text>
      </div>
      <div className={styles.resultTag}>
        <Text size="1" color="gray">Grid Export:</Text>
        <Text
          size="2"
          weight="medium"
          color={result.gridExportKw > 0 ? "green" : undefined}
        >
          {result.gridExportKw.toFixed(1)} kW
        </Text>
      </div>
      {!result.meetsMinSolarGeneration && (
        <Badge color="red" size="1" variant="soft">Below min solar</Badge>
      )}
      {!result.meetsMinExcessSolar && (
        <Badge color="red" size="1" variant="soft">Below min excess</Badge>
      )}
      {result.batteryPriorityBlocking && (
        <Badge color="orange" size="1" variant="soft">Battery priority</Badge>
      )}
      {result.blockoutActive && (
        <Badge color="red" size="1" variant="soft">Blockout active</Badge>
      )}
    </div>
  );
}

function InputControls(
  {
    solarKw,
    setSolarKw,
    consumptionKw,
    setConsumptionKw,
    batterySoc,
    setBatterySoc,
    simulatedTime,
    setSimulatedTime,
    simulatedDay,
    setSimulatedDay,
    hasBattery,
  }: {
    solarKw: number;
    setSolarKw: (v: number) => void;
    consumptionKw: number;
    setConsumptionKw: (v: number) => void;
    batterySoc: number | null;
    setBatterySoc: (v: number | null) => void;
    simulatedTime: string;
    setSimulatedTime: (v: string) => void;
    simulatedDay: DayOfWeek;
    setSimulatedDay: (d: DayOfWeek) => void;
    hasBattery: boolean;
  },
) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <SliderRow
        label="Solar Production"
        value={solarKw}
        min={0}
        max={20}
        step={0.1}
        unit="kW"
        onChange={setSolarKw}
      />
      <SliderRow
        label="Home Consumption"
        value={consumptionKw}
        min={0}
        max={15}
        step={0.1}
        unit="kW"
        onChange={setConsumptionKw}
      />
      {hasBattery && (
        <SliderRow
          label="Battery SOC"
          value={batterySoc ?? 0}
          min={0}
          max={100}
          step={1}
          unit="%"
          onChange={(v) => setBatterySoc(v)}
        />
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          minHeight: 28,
        }}
      >
        <Text size="2" style={{ minWidth: 130 }}>Time</Text>
        <TimePicker value={simulatedTime} onChange={setSimulatedTime} />
      </div>
      <DayPickerRow
        simulatedDay={simulatedDay}
        setSimulatedDay={setSimulatedDay}
      />
    </div>
  );
}

function useSolarSimState(
  { config, vehicles, currentEnergy, schedules }: SolarSimulationProps,
) {
  const defaultSolar = currentEnergy
    ? currentEnergy.solarProductionW / 1000
    : 5;
  const defaultConsumption = currentEnergy
    ? currentEnergy.homeConsumptionW / 1000
    : 1.5;
  const defaultBatterySoc = currentEnergy?.batterySoc ?? null;

  const [solarKw, setSolarKw] = useState(Math.round(defaultSolar * 10) / 10);
  const [consumptionKw, setConsumptionKw] = useState(
    Math.round(defaultConsumption * 10) / 10,
  );
  const [batterySoc, setBatterySoc] = useState<number | null>(
    defaultBatterySoc,
  );
  const [simulatedTime, setSimulatedTime] = useState(getCurrentTime);
  const [simulatedDay, setSimulatedDay] = useState<DayOfWeek>(getCurrentDay);
  const [vehicleOverrides, setVehicleOverrides] = useState<
    Record<string, { batteryLevel?: number; mode?: VehicleMode }>
  >({});

  const solarConfig = useMemo(() => parseConfigToSolarConfig(config), [config]);

  const simVehicles: SimVehicle[] = useMemo(() => {
    return vehicles.map((v) => {
      const overrides = vehicleOverrides[v.id] ?? {};
      const s = v.state;
      return {
        id: v.id,
        name: v.name,
        priority: v.priority,
        mode: (overrides.mode ?? v.mode ?? "auto") as VehicleMode,
        batteryLevel: overrides.batteryLevel ?? s?.batteryLevel ?? 50,
        chargeLimit: s?.chargeLimit ?? 80,
        chargeAmpsMin: s?.chargeAmpsMin || 5,
        chargeAmpsMax: s?.chargeAmpsMax || 16,
        chargerVoltage: s?.chargerVoltage || 230,
        chargerPhases: solarConfig.threePhaseCharger
          ? 3
          : (s?.chargerPhases ?? 1),
      };
    });
  }, [vehicles, vehicleOverrides, solarConfig.threePhaseCharger]);

  const result = useMemo(
    () =>
      simulateSolarAllocation(solarConfig, simVehicles, {
        solarProductionKw: solarKw,
        homeConsumptionKw: consumptionKw,
        batterySoc,
        schedules,
        simulatedTime,
        simulatedDay,
      }),
    [
      solarConfig,
      simVehicles,
      solarKw,
      consumptionKw,
      batterySoc,
      schedules,
      simulatedTime,
      simulatedDay,
    ],
  );

  const handleReset = () => {
    setSolarKw(Math.round(defaultSolar * 10) / 10);
    setConsumptionKw(Math.round(defaultConsumption * 10) / 10);
    setBatterySoc(defaultBatterySoc);
    setVehicleOverrides({});
    setSimulatedTime(getCurrentTime());
    setSimulatedDay(getCurrentDay());
  };

  const setVehicleOverride: SetOverride = (id, key, value) => {
    setVehicleOverrides((prev) => ({
      ...prev,
      [id]: { ...prev[id], [key]: value },
    }));
  };

  const hasBattery = solarConfig.batteryPriorityEnabled ||
    currentEnergy?.batterySoc !== null;

  return {
    solarKw,
    setSolarKw,
    consumptionKw,
    setConsumptionKw,
    batterySoc,
    setBatterySoc,
    simulatedTime,
    setSimulatedTime,
    simulatedDay,
    setSimulatedDay,
    simVehicles,
    result,
    handleReset,
    setVehicleOverride,
    hasBattery,
  };
}

export function SolarSimulation(props: SolarSimulationProps) {
  const { navigate } = useRouter();
  const {
    solarKw,
    setSolarKw,
    consumptionKw,
    setConsumptionKw,
    batterySoc,
    setBatterySoc,
    simulatedTime,
    setSimulatedTime,
    simulatedDay,
    setSimulatedDay,
    simVehicles,
    result,
    handleReset,
    setVehicleOverride,
    hasBattery,
  } = useSolarSimState(props);

  return (
    <Card
      style={{
        borderLeft: "3px solid var(--amber-9)",
        background: "var(--amber-a2)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text size="3" weight="bold">Solar Charging Simulation</Text>
          <Button size="1" variant="ghost" onClick={handleReset}>
            <RotateCcw size={12} />
            Reset
          </Button>
        </div>
        <Text size="1" color="gray">
          Preview how your settings would affect charging — adjusting these
          knobs has no real effect, it's only for understanding the settings.
          For a full day-by-day simulation, visit the{" "}
          <Link
            onClick={() => navigate({ type: "app", page: "simulator" })}
            style={{ cursor: "pointer" }}
          >
            Simulator page
          </Link>.
        </Text>
        <InputControls
          solarKw={solarKw}
          setSolarKw={setSolarKw}
          consumptionKw={consumptionKw}
          setConsumptionKw={setConsumptionKw}
          batterySoc={batterySoc}
          setBatterySoc={setBatterySoc}
          simulatedTime={simulatedTime}
          setSimulatedTime={setSimulatedTime}
          simulatedDay={simulatedDay}
          setSimulatedDay={setSimulatedDay}
          hasBattery={hasBattery}
        />
        <VehicleList
          simVehicles={simVehicles}
          result={result}
          setVehicleOverride={setVehicleOverride}
        />
        <SummaryBar
          solarKw={solarKw}
          consumptionKw={consumptionKw}
          result={result}
        />
      </div>
    </Card>
  );
}
