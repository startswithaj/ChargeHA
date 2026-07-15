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
    key: "peak_kw",
    schema: z.string(),
    default: String(DEFAULT_SOLAR_CONFIG.peakKw),
  },
  cloudiness: {
    key: "cloudiness",
    schema: z.string(),
    default: String(DEFAULT_SOLAR_CONFIG.cloudiness),
  },
  storms: {
    key: "storms",
    schema: z.string(),
    default: String(DEFAULT_SOLAR_CONFIG.storms),
  },
  homeBaseW: {
    key: "home_base_w",
    schema: z.string(),
    default: String(DEFAULT_SOLAR_CONFIG.homeBaseW),
  },
  sunrise: {
    key: "sunrise",
    schema: z.string(),
    default: String(DEFAULT_SOLAR_CONFIG.sunrise),
  },
  sunset: {
    key: "sunset",
    schema: z.string(),
    default: String(DEFAULT_SOLAR_CONFIG.sunset),
  },
  seed: {
    key: "seed",
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
