import type { meterValuesReq, SampledValue } from "./OcppMessages.ts";
import type { OcppLiveData } from "./OcppTypes.ts";

// A 3-phase charger sends one sample per phase, so taking the first match
// reads a third of actual. Rules follow HA's OCPP process_phases.

const PHASES_L123 = ["L1", "L2", "L3"] as const;
const PHASES_L_N = ["L1-N", "L2-N", "L3-N"] as const;
const PHASES_L_L = ["L1-L2", "L2-L3", "L3-L1"] as const;
const SQRT3 = Math.sqrt(3);

const ENERGY_REGISTER = "Energy.Active.Import.Register";

// Parsed once here, so nothing downstream re-parses or re-checks finiteness.
interface ParsedSample {
  value: number;
  phase: string | undefined;
  unit: string | undefined;
}

// `total` is the sample that carried no `phase`; `phases` is keyed by the raw
// OCPP phase label.
interface MeasurandGroup {
  unit: string | undefined;
  total: number | null;
  phases: Map<string, number>;
}

// `shielded` means "do not write this key": the payload said nothing about
// the installation, so it must not disturb what we already hold.
interface Reading {
  value: number | null;
  unit: string | undefined;
  shielded: boolean;
}

const NO_READING: Reading = { value: null, unit: undefined, shielded: false };

// An absent measurand means Energy.Active.Import.Register (OCPP 1.6).
const measurandOf = (sample: SampledValue): string =>
  sample.measurand ?? ENERGY_REGISTER;

function groupSamples(samples: SampledValue[]): Map<string, MeasurandGroup> {
  const byName = samples.reduce(
    (acc, sample) => {
      const name = measurandOf(sample);
      return acc.set(name, [...(acc.get(name) ?? []), sample]);
    },
    new Map<string, SampledValue[]>(),
  );
  return new Map(
    [...byName].map(([name, list]) => [name, buildGroup(list)]),
  );
}

function buildGroup(samples: SampledValue[]): MeasurandGroup {
  // Dropped outright: an NaN would poison the sum and take its healthy
  // sibling phases with it.
  const usable = samples.flatMap((s): ParsedSample[] => {
    const value = parseFloat(s.value);
    return Number.isFinite(value)
      ? [{ value, phase: s.phase, unit: s.unit }]
      : [];
  });
  const unphased = usable.filter((s) => s.phase === undefined);
  return {
    unit: usable.at(-1)?.unit,
    // Last wins: a batched MeterValues is oldest first, so the tail is the
    // freshest reading (as the Map below also does for repeated labels).
    total: unphased.at(-1)?.value ?? null,
    phases: new Map(
      usable.flatMap((s) =>
        s.phase === undefined ? [] : [[s.phase, s.value] as const]
      ),
    ),
  };
}

// An absent phase is dropped; a zero survives, to be dropped only by averaging.
const valuesFor = (
  group: MeasurandGroup,
  phases: readonly string[],
): number[] =>
  phases.flatMap((phase) => {
    const value = group.phases.get(phase);
    return value === undefined ? [] : [value];
  });

// A charger limited to 16 A draws it on each ACTIVE phase, so 16/16/0 is 16,
// not 10.67. All-zero is still a reading, so it returns 0.
function averageNonZero(values: number[]): number | null {
  if (values.length === 0) return null;
  const nonZero = values.filter((value) => value !== 0);
  if (nonZero.length === 0) return 0;
  return nonZero.reduce((a, b) => a + b, 0) / nonZero.length;
}

const sumOf = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((a, b) => a + b, 0);

// One selector for average, sum and additive totals, so they cannot disagree.
// The L-N fallback is for chargers that misuse those labels.
function linePhaseValues(group: MeasurandGroup): number[] {
  const line = valuesFor(group, PHASES_L123);
  return line.length > 0 ? line : valuesFor(group, PHASES_L_N);
}

const aggregateCurrent = (group: MeasurandGroup): number | null =>
  averageNonZero(linePhaseValues(group));

// Power.* and Energy.*: the installation total is the sum of its phases.
const aggregateAdditive = (group: MeasurandGroup): number | null =>
  sumOf(linePhaseValues(group));

function aggregateVoltage(group: MeasurandGroup): number | null {
  const neutral = valuesFor(group, PHASES_L_N);
  if (neutral.length > 0) return averageNonZero(neutral);
  const lineToLine = averageNonZero(valuesFor(group, PHASES_L_L));
  // Line-to-line is √3 larger for the same supply, and downstream assumes
  // line-to-neutral.
  if (lineToLine !== null) return lineToLine / SQRT3;
  // For chargers that label line-to-neutral volts as bare L1/L2/L3.
  return averageNonZero(valuesFor(group, PHASES_L123));
}

// A lone neutral sample is not a reading of the installation, so it must not
// overwrite the one we already have.
const neutralOnly = (group: MeasurandGroup): boolean =>
  group.phases.size > 0 &&
  [...group.phases.keys()].every((phase) => phase === "N");

function readGroup(
  groups: Map<string, MeasurandGroup>,
  measurand: string,
  aggregate: (group: MeasurandGroup) => number | null,
): Reading {
  const group = groups.get(measurand);
  if (group === undefined) return NO_READING;
  if (neutralOnly(group)) {
    return { value: null, unit: group.unit, shielded: true };
  }
  // An unphased sample wins: chargers exist that send both a total and its
  // phases, and counting both double-counts. Field behaviour, not OCPP 1.6.
  return {
    value: group.total ?? aggregate(group),
    unit: group.unit,
    shielded: false,
  };
}

// For the adapter's tier-3 power derivation. Null on a single unphased
// current: nothing to sum, so the adapter scales by phase count instead.
function currentSum(groups: Map<string, MeasurandGroup>): number | null {
  const group = groups.get("Current.Import");
  if (group === undefined || group.total !== null) return null;
  if (neutralOnly(group)) return null;
  return sumOf(linePhaseValues(group));
}

// OCPP allows the kilo prefix on Power.Active.Import (W/kW) and
// Energy.Active.Import.Register (Wh/kWh).
const scaleUnit = (value: number, unit: string | undefined): number =>
  unit?.startsWith("k") ? value * 1000 : value;

// `derivePowerW` is fallback tier 2 (no power measurand → register rate).
// Tier 3, current × voltage, stays in the adapter.
export function readMeterValueFields(
  mv: ReturnType<typeof meterValuesReq.parse>,
  derivePowerW: (energyRegisterWh: number | null) => number | null,
): Partial<OcppLiveData> {
  const groups = groupSamples(
    mv.meterValue.flatMap((entry) => entry.sampledValue),
  );
  const power = readGroup(groups, "Power.Active.Import", aggregateAdditive);
  const current = readGroup(groups, "Current.Import", aggregateCurrent);
  const voltage = readGroup(groups, "Voltage", aggregateVoltage);
  const register = readGroup(groups, ENERGY_REGISTER, aggregateAdditive);
  // Normalised like power, or a kWh charger reads 1000x low. After
  // aggregation: one measurand's phases share a unit, so scaling once is
  // lossless.
  const energyRegisterWh = register.value === null
    ? null
    : scaleUnit(register.value, register.unit);
  const powerW = power.value === null
    ? derivePowerW(energyRegisterWh)
    : scaleUnit(power.value, power.unit);
  const currentFields = {
    currentA: current.value,
    currentSumA: currentSum(groups),
  };
  // A shielded reading omits its key rather than writing null, so it cannot
  // wipe the good reading we already hold.
  return {
    ...(power.shielded ? {} : { powerW }),
    ...(current.shielded ? {} : currentFields),
    ...(voltage.shielded ? {} : { voltageV: voltage.value }),
    ...(register.shielded ? {} : { energyRegisterWh }),
  };
}
