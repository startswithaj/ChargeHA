import type { QueryHandler } from "./types.ts";
import {
  labelForRate,
  PEAK_END_HOUR,
  PEAK_START_HOUR,
  rateForMinute,
} from "../demoTariff.ts";

const num = (v: string | undefined, fallback: number): number =>
  v != null ? Number(v) : fallback;

export const tariffHandlers: Record<string, QueryHandler> = {
  "tariff.list": (_i, s) => ({
    periods: s.tariffs,
    defaultRatePerKwh: num(s.config.default_rate_per_kwh, 0),
    currencySymbol: s.config.currency_symbol ?? "$",
    currencyCode: s.config.currency_code ?? "AUD",
  }),

  "tariff.defaultRate": (_i, s) => ({
    ratePerKwh: num(s.config.default_rate_per_kwh, 0),
    currencySymbol: s.config.currency_symbol ?? "$",
    currencyCode: s.config.currency_code ?? "AUD",
  }),

  "tariff.currentRate": (_i, s) => {
    const now = new Date();
    const min = now.getHours() * 60 + now.getMinutes();
    const rate = rateForMinute(min);
    const boundaries = [PEAK_START_HOUR * 60, PEAK_END_HOUR * 60];
    const nextBoundary = boundaries.find((b) => b > min) ??
      (24 * 60 + boundaries[0]);
    const nextRate = rateForMinute(nextBoundary % (24 * 60));
    return {
      ratePerKwh: rate,
      label: labelForRate(rate),
      currencySymbol: s.config.currency_symbol ?? "$",
      nextRate: {
        ratePerKwh: nextRate,
        label: labelForRate(nextRate),
        startsAt: new Date(now.getTime() + (nextBoundary - min) * 60_000)
          .toISOString(),
      },
    };
  },
};
