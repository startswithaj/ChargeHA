import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, FlaskConical, Sun } from "lucide-react";
import { Button, Select, Slider, Switch, Text } from "@radix-ui/themes";
import type { VehicleWithState } from "@chargeha/shared";
import {
  useBatteryConfig,
  useSolarConfig,
  useSolarConfigMutation,
} from "../../../hooks/useSectionConfig.ts";
import { useDraftConfig } from "../../../hooks/useDraftConfig.ts";
import { useEnergyData } from "../../../hooks/useEnergyData.ts";
import { useSchedules } from "../../../hooks/useSchedules.ts";
import { trpc } from "../../../trpc.ts";
import { SolarSimulation } from "../../SolarSimulation/SolarSimulation.tsx";
import {
  NumberInput,
  SettingsRow,
  SettingsSection,
} from "./SettingsLayout.tsx";

const AMP_THRESHOLD_HELP =
  // deno-lint-ignore custom-plugin-refs/no-plugin-refs
  "Amp changes smaller than or equal to this are delayed until the target has been stable for the settle time below. Larger changes apply immediately. Reducing this number will increase the number of calls to the Tesla API and may exceed Tesla's monthly free quota.";

const AMP_SETTLE_HELP =
  // deno-lint-ignore custom-plugin-refs/no-plugin-refs
  "How long a small amp change must remain stable before it is applied. Reducing this number will increase the number of calls to the Tesla API and may exceed Tesla's monthly free quota.";

type SolarFields = NonNullable<ReturnType<typeof useSolarConfig>["data"]>;
type SetSolarField = <K extends keyof SolarFields>(
  k: K,
  v: SolarFields[K],
) => void;

function buildLegacyConfig(
  fields: SolarFields,
  batteryConfig: {
    batteryPriorityEnabled?: boolean;
    batteryPriorityLimit?: number;
  } | undefined,
): Record<string, string> {
  return {
    solar_tracking_enabled: fields.solarTrackingEnabled ? "true" : "false",
    solar_tracking_mode: fields.solarTrackingMode,
    solar_reference: fields.solarReference,
    solar_margin_kw: String(fields.solarMarginKw),
    min_solar_generation_kw: String(fields.minSolarGenerationKw),
    min_excess_solar_kw: fields.minExcessSolarKw != null
      ? String(fields.minExcessSolarKw)
      : "",
    three_phase_charger: fields.threePhaseCharger ? "true" : "false",
    consumption_excludes_charging: fields.consumptionExcludesCharging
      ? "true"
      : "false",
    grace_period_minutes: String(fields.gracePeriodMinutes),
    cooldown_period_minutes: String(fields.cooldownPeriodMinutes),
    battery_priority_enabled: batteryConfig?.batteryPriorityEnabled
      ? "true"
      : "false",
    battery_priority_limit: String(batteryConfig?.batteryPriorityLimit ?? 80),
  };
}

function SolarMainRows(
  { fields, setField, kwToAmps }: {
    fields: SolarFields;
    setField: SetSolarField;
    kwToAmps: (kw: number) => number;
  },
) {
  return (
    <>
      <SettingsRow
        label="Solar tracking enabled"
        help="When enabled, ChargeHA automatically adjusts EV charging amps based on available solar power. When disabled, vehicles only charge via manual control or schedules."
      >
        <Switch
          size="2"
          checked={fields.solarTrackingEnabled}
          onCheckedChange={(v) => setField("solarTrackingEnabled", v)}
        />
      </SettingsRow>
      <SettingsRow
        label="Mode"
        help="Solar Only stops charging when solar drops below the minimum charging rate. Solar + Grid continues at minimum amps from the grid during temporary solar dips, but still stops when there is no solar generation."
      >
        <Select.Root
          value={fields.solarTrackingMode}
          onValueChange={(v) =>
            setField("solarTrackingMode", v as "solar_only" | "solar_grid")}
        >
          <Select.Trigger style={{ minWidth: 180 }} />
          <Select.Content>
            <Select.Item value="solar_only">Solar Only</Select.Item>
            <Select.Item value="solar_grid">Solar + Grid</Select.Item>
          </Select.Content>
        </Select.Root>
      </SettingsRow>
      <SettingsRow
        label="Reference"
        help="Excess Solar calculates available power from your grid export (surplus after home use). Gross Solar uses total panel output and subtracts home consumption — better when your meter doesn't report export separately."
      >
        <Select.Root
          value={fields.solarReference}
          onValueChange={(v) =>
            setField("solarReference", v as "excess" | "gross")}
        >
          <Select.Trigger style={{ minWidth: 180 }} />
          <Select.Content>
            <Select.Item value="excess">Excess Solar</Select.Item>
            <Select.Item value="gross">Gross Solar</Select.Item>
          </Select.Content>
        </Select.Root>
      </SettingsRow>
      <SettingsRow
        label="Solar margin"
        help="Reserve solar for your household before allocating to the car. Positive values keep a buffer for home use. Negative values allow a small amount of grid import."
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            minWidth: 200,
          }}
        >
          <Slider
            min={-2}
            max={5}
            step={0.1}
            value={[fields.solarMarginKw]}
            onValueChange={([v]) =>
              setField("solarMarginKw", parseFloat(v.toFixed(1)))}
            style={{ flex: 1 }}
          />
          <Text
            size="2"
            weight="medium"
            style={{ minWidth: 55, textAlign: "right" }}
          >
            {fields.solarMarginKw.toFixed(1)} kW
            <Text size="1" color="gray">
              ({kwToAmps(fields.solarMarginKw)}A)
            </Text>
          </Text>
        </div>
      </SettingsRow>
    </>
  );
}

function SolarThresholdRows(
  { fields, setField, kwToAmps }: {
    fields: SolarFields;
    setField: SetSolarField;
    kwToAmps: (kw: number) => number;
  },
) {
  return (
    <>
      <SettingsRow
        label="Min solar generation"
        help="Minimum total solar production before charging can start. Prevents charging during low-light periods like dawn and dusk. If production drops below this while charging, the grace period applies (drops to min amps, then stops if it doesn't recover). If solar drops to zero, charging stops immediately with no grace period."
      >
        <NumberInput
          value={String(fields.minSolarGenerationKw)}
          onChange={(v) =>
            setField("minSolarGenerationKw", parseFloat(v) || 0.2)}
          suffix="kW"
          step={0.1}
          min={0}
          max={10}
        />
        <Text size="1" color="gray">
          ({kwToAmps(fields.minSolarGenerationKw)}A)
        </Text>
      </SettingsRow>
      <SettingsRow
        label="Min excess solar"
        help="Minimum surplus solar (after home consumption) required to start charging. Once charging, the normal grace period handles fluctuations. Leave empty to disable."
      >
        <NumberInput
          value={fields.minExcessSolarKw != null
            ? String(fields.minExcessSolarKw)
            : ""}
          onChange={(v) =>
            setField(
              "minExcessSolarKw",
              v === "" ? null : (parseFloat(v) || 0),
            )}
          suffix="kW"
          step={0.1}
          min={0}
          max={20}
          placeholder="Disabled"
        />
        {fields.minExcessSolarKw != null && (
          <Text size="1" color="gray">
            ({kwToAmps(fields.minExcessSolarKw)}A)
          </Text>
        )}
      </SettingsRow>
      <SettingsRow
        label="Grace period"
        help="How long to keep charging at minimum amps when solar drops temporarily. Avoids frequent start/stop cycles. After this period, charging stops (Solar Only) or continues at minimum from grid (Solar + Grid)."
      >
        <NumberInput
          value={String(fields.gracePeriodMinutes)}
          onChange={(v) => setField("gracePeriodMinutes", parseInt(v) || 6)}
          suffix="min"
          step={1}
          min={0}
          max={30}
        />
      </SettingsRow>
      <SettingsRow
        label="Cooldown period"
        help="After stopping due to insufficient solar, wait this long before restarting. Prevents rapid on/off cycling when solar is fluctuating near the threshold."
      >
        <NumberInput
          value={String(fields.cooldownPeriodMinutes)}
          onChange={(v) => setField("cooldownPeriodMinutes", parseInt(v) || 15)}
          suffix="min"
          step={1}
          min={0}
          max={60}
        />
      </SettingsRow>
    </>
  );
}

function SolarHardwareRows(
  { fields, setField }: {
    fields: SolarFields;
    setField: SetSolarField;
  },
) {
  return (
    <>
      <SettingsRow
        label="Grid voltage"
        help="Your region's nominal mains voltage. Used to convert available solar watts to charging amps."
      >
        <Select.Root
          size="2"
          value={String(fields.gridVoltage)}
          onValueChange={(v) => setField("gridVoltage", Number(v))}
        >
          <Select.Trigger />
          <Select.Content>
            <Select.Item value="230">230V</Select.Item>
            <Select.Item value="240">240V</Select.Item>
            <Select.Item value="120">120V</Select.Item>
          </Select.Content>
        </Select.Root>
      </SettingsRow>
      <SettingsRow
        label="Three-phase charger"
        help="Enable if your charger is wired for 3-phase power. The solar algorithm divides available watts by voltage x phases to calculate amps — if the car misreports phases as 1, the controller will overshoot by 3x without this setting."
      >
        <Switch
          size="2"
          checked={fields.threePhaseCharger}
          onCheckedChange={(v) => setField("threePhaseCharger", v)}
        />
      </SettingsRow>
      <SettingsRow
        label="Consumption excludes charging"
        help="Enable if your EV charger is wired outside the energy meter's monitoring loop."
      >
        <Switch
          size="2"
          checked={fields.consumptionExcludesCharging}
          onCheckedChange={(v) => setField("consumptionExcludesCharging", v)}
        />
      </SettingsRow>
    </>
  );
}

function AdvancedRows(
  { fields, setField }: {
    fields: SolarFields;
    setField: SetSolarField;
  },
) {
  return (
    <>
      <SettingsRow label="Amp change threshold" help={AMP_THRESHOLD_HELP}>
        <NumberInput
          value={String(fields.ampDebounceThreshold)}
          onChange={(v) => setField("ampDebounceThreshold", parseInt(v) || 2)}
          suffix="A"
          step={1}
          min={1}
          max={5}
        />
      </SettingsRow>
      <SettingsRow label="Amp settle time" help={AMP_SETTLE_HELP}>
        <NumberInput
          value={String(fields.ampDebounceSettleMinutes)}
          onChange={(v) =>
            setField("ampDebounceSettleMinutes", parseInt(v) || 3)}
          suffix="min"
          step={1}
          min={1}
          max={10}
        />
      </SettingsRow>
    </>
  );
}

export function SolarTrackingSettings() {
  const { data: config } = useSolarConfig();
  const { data: batteryConfig } = useBatteryConfig();
  const mutation = useSolarConfigMutation();
  const { fields, setField, isDirty, save, saveStatus } = useDraftConfig(
    config,
    mutation,
  );
  const [showSimulation, setShowSimulation] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const simulationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showSimulation && simulationRef.current) {
      simulationRef.current.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  }, [showSimulation]);
  const { data: energyData } = useEnergyData();
  const voltage = fields?.gridVoltage ?? 230;
  const kwToAmps = (kw: number) =>
    Math.round(((kw * 1000) / voltage) * 10) / 10;
  const currentEnergy = energyData?.realtime ?? null;
  const { schedules } = useSchedules();
  const { data: vehiclesData } = trpc.vehicle.list.useQuery();
  const vehicles = useMemo(
    () => (vehiclesData?.vehicles ?? []) as VehicleWithState[],
    [vehiclesData],
  );

  if (!fields) return null;

  const legacyConfig = buildLegacyConfig(fields, batteryConfig);

  return (
    <>
      <SettingsSection
        icon={<Sun size={18} />}
        title="Solar Tracking"
        description="Controls how solar energy is allocated to EV charging."
        saveStatus={saveStatus}
        isDirty={isDirty}
        onSave={save}
        action={
          <Button
            size="1"
            variant={showSimulation ? "solid" : "soft"}
            onClick={() => setShowSimulation((v) => !v)}
          >
            <FlaskConical size={12} />
            Simulate
          </Button>
        }
      >
        <SolarMainRows
          fields={fields}
          setField={setField}
          kwToAmps={kwToAmps}
        />
        <SolarThresholdRows
          fields={fields}
          setField={setField}
          kwToAmps={kwToAmps}
        />
        <SolarHardwareRows fields={fields} setField={setField} />

        <div
          style={{
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid var(--gray-a4)",
          }}
        >
          <Button
            size="1"
            variant="ghost"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced
              ? <ChevronDown size={14} />
              : <ChevronRight size={14} />}
            Advanced
          </Button>
        </div>

        {showAdvanced && <AdvancedRows fields={fields} setField={setField} />}
      </SettingsSection>

      {showSimulation && (
        <div ref={simulationRef}>
          <SolarSimulation
            config={legacyConfig}
            vehicles={vehicles}
            currentEnergy={currentEnergy}
            schedules={schedules}
          />
        </div>
      )}
    </>
  );
}
