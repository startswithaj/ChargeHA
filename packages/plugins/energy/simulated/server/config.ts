import { z } from "zod";
import {
  defineSection,
  type SectionKeys,
  type SectionType,
} from "@chargeha/shared/configSections";
import { DEFAULT_SOLAR_CONFIG } from "@chargeha/shared/simulation";

// ── Simulated Energy plugin config section ──────────────────────────────────
// Knobs mirror the Simulator's SolarConfig. Keys: simulated_energy.{key}

export const simulatedEnergyConfigDef = defineSection({
  peakKw: {
    key: "simulated_energy.peak_kw",
    schema: z.string(),
    default: String(DEFAULT_SOLAR_CONFIG.peakKw),
  },
  cloudiness: {
    key: "simulated_energy.cloudiness",
    schema: z.string(),
    default: String(DEFAULT_SOLAR_CONFIG.cloudiness),
  },
  storms: {
    key: "simulated_energy.storms",
    schema: z.string(),
    default: String(DEFAULT_SOLAR_CONFIG.storms),
  },
  homeBaseW: {
    key: "simulated_energy.home_base_w",
    schema: z.string(),
    default: String(DEFAULT_SOLAR_CONFIG.homeBaseW),
  },
  sunrise: {
    key: "simulated_energy.sunrise",
    schema: z.string(),
    default: String(DEFAULT_SOLAR_CONFIG.sunrise),
  },
  sunset: {
    key: "simulated_energy.sunset",
    schema: z.string(),
    default: String(DEFAULT_SOLAR_CONFIG.sunset),
  },
  seed: {
    key: "simulated_energy.seed",
    schema: z.string(),
    default: String(DEFAULT_SOLAR_CONFIG.seed),
  },
});

export type SimulatedEnergyConfig = SectionType<
  typeof simulatedEnergyConfigDef
>;

export type SimulatedEnergyConfigKey = SectionKeys<
  typeof simulatedEnergyConfigDef
>;
