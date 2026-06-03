// Time-of-day tariff for demo mode. Used by the aggregator to compute cost /
// savings, and by demoState to expose tariff.list — one source of truth.

export const PEAK_RATE = 0.45;
export const OFFPEAK_RATE = 0.22;
export const PEAK_START_HOUR = 14;
export const PEAK_END_HOUR = 20;

/** $/kWh rate for a given minute-of-day. */
export const rateForMinute = (minute: number): number => {
  const hour = Math.floor(minute / 60);
  return hour >= PEAK_START_HOUR && hour < PEAK_END_HOUR
    ? PEAK_RATE
    : OFFPEAK_RATE;
};

/** Cost in cents for `wh` watt-hours at a $/kWh `rate`. */
export const costCents = (wh: number, rate: number): number => wh * rate / 10;

/** Human label for a known rate. */
export const labelForRate = (rate: number): string =>
  rate === PEAK_RATE ? "Peak" : "Off-peak";
