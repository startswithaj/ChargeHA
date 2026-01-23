import type { EnergyReading, SolarConfig } from "./types.ts";

/** Seeded PRNG (deterministic random numbers from a seed). */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed | 0;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    const t0 = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    const t = (t0 + Math.imul(t0 ^ (t0 >>> 7), 61 | t0)) ^ t0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

/** Generate a full 24-hour solar day at 1-minute resolution. */
export function generateSolarDay(config: SolarConfig): EnergyReading[] {
  const random = new Rng(config.seed);
  const readings: EnergyReading[] = [];
  // iterative cloud simulation state, each tick depends on previous
  // deno-lint-ignore custom-no-let/no-let
  let cloudFactor = 1.0;
  // deno-lint-ignore custom-no-let/no-let
  let cloudTarget = 1.0;
  // deno-lint-ignore custom-no-let/no-let
  let cloudVelocity = 0;
  const minutes = 24 * 60;

  // Cloud frequency scales with cloudiness (0-100%). Fully proportional — no floor.
  const cloudFrac = config.cloudiness / 100;
  const cloudChance = cloudFrac * 0.045;
  const clearChance = 0.08 - cloudFrac * 0.06;
  const homeVarianceW = config.homeBaseW * 0.33;

  // Pre-generate storm windows (sustained dark periods)
  const stormWindows: Array<{ start: number; end: number }> = [];
  if (config.storms > 0) {
    const solarMinutes = (config.sunset - config.sunrise) * 60;
    const slotSize = Math.floor(solarMinutes / (config.storms + 1));
    // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
    for (let i = 0; i < config.storms; i++) {
      const center = Math.floor(
        (config.sunrise * 60) + slotSize * (i + 1) +
          (random.next() - 0.5) * slotSize * 0.5,
      );
      const duration = 20 + Math.floor(random.next() * 40); // 20-60 min
      stormWindows.push({
        start: center - duration / 2,
        end: center + duration / 2,
      });
    }
  }

  // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
  for (let m = 0; m < minutes; m++) {
    const hourFrac = m / 60;
    const hour = Math.floor(hourFrac);
    const min = Math.floor((hourFrac % 1) * 60);
    const time = `${String(hour).padStart(2, "0")}:${
      String(min).padStart(2, "0")
    }`;

    // conditional assignment in solar curve calculation
    // deno-lint-ignore custom-no-let/no-let
    let baseSolarW = 0;
    if (hourFrac > config.sunrise && hourFrac < config.sunset) {
      const solarNoon = (config.sunrise + config.sunset) / 2;
      const halfDay = (config.sunset - config.sunrise) / 2;
      const dayFrac = (hourFrac - config.sunrise) /
        (config.sunset - config.sunrise);
      const sineFrac = Math.sin(dayFrac * Math.PI);
      const bellFrac = Math.exp(
        -0.5 * ((hourFrac - solarNoon) / (halfDay * 0.8)) ** 2,
      );
      baseSolarW = config.peakKw * 1000 * sineFrac * bellFrac;
    }

    const inStorm = stormWindows.some((w) => m >= w.start && m <= w.end);
    if (inStorm) {
      cloudTarget = 0.02 + random.next() * 0.08;
    } else if (random.next() < cloudChance) {
      cloudTarget = 0.1 + random.next() * 0.3;
    } else if (random.next() < clearChance) {
      cloudTarget = 0.85 + random.next() * 0.15;
    }
    cloudVelocity += (cloudTarget - cloudFactor) * 0.1;
    cloudVelocity *= 0.8;
    cloudFactor += cloudVelocity;
    cloudFactor = Math.max(0.05, Math.min(1.0, cloudFactor));

    const noise = 1 + (random.next() - 0.5) * (0.02 + 0.08 * cloudFrac);
    const solarW = Math.max(0, baseSolarW * cloudFactor * noise);
    const homeW = config.homeBaseW +
      (random.next() - 0.5) * 2 * homeVarianceW * cloudFrac;
    const gridW = homeW - solarW;

    readings.push({
      minute: m,
      time,
      solarW: Math.round(solarW),
      homeW: Math.round(homeW),
      gridW: Math.round(gridW),
    });
  }
  return readings;
}
