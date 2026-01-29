import { ServiceError } from "../lib/ServiceError.ts";
import type { DayOfWeek } from "@chargeha/shared";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { CreateTariffPeriodInput, TariffPeriodRow } from "../db/types.ts";
import {
  getApplicablePeriodForTime,
  parseTimeToMinutes,
} from "../lib/Tariffs.ts";
import type { Logger } from "../lib/Logger.ts";

const DAY_ABBRS: DayOfWeek[] = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];

const WEEKDAY_TO_ABBR: Record<string, DayOfWeek> = {
  Sun: "sun",
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
};

/** Extract current time parts in the user's configured timezone. */
function getTimezoneTimeParts(
  now: Date,
  timezone: string,
): {
  currentMinutes: number;
  currentDayAbbr: DayOfWeek;
  tomorrowDayAbbr: DayOfWeek;
} {
  if (timezone) {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const hours = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const minutes = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";

    const currentDayAbbr = WEEKDAY_TO_ABBR[weekday] ??
      DAY_ABBRS[now.getDay()];
    const currentDayIdx = DAY_ABBRS.indexOf(currentDayAbbr);
    const tomorrowDayAbbr = DAY_ABBRS[(currentDayIdx + 1) % 7];

    return {
      currentMinutes: hours * 60 + minutes,
      currentDayAbbr,
      tomorrowDayAbbr,
    };
  }

  // No timezone configured — fall back to server local time
  return {
    currentMinutes: now.getHours() * 60 + now.getMinutes(),
    currentDayAbbr: DAY_ABBRS[now.getDay()],
    tomorrowDayAbbr: DAY_ABBRS[(now.getDay() + 1) % 7],
  };
}

const ALL_DAYS: DayOfWeek[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

// Preset templates
const PRESETS: Record<string, CreateTariffPeriodInput[]> = {
  flat: [
    {
      label: "Flat Rate",
      startTime: "00:00",
      endTime: "00:00",
      days: ALL_DAYS,
      ratePerKwh: 0.30,
    },
  ],
  tou: [
    {
      label: "Shoulder",
      startTime: "00:00",
      endTime: "11:00",
      days: ALL_DAYS,
      ratePerKwh: 0.25,
    },
    {
      label: "Off-Peak",
      startTime: "11:00",
      endTime: "16:00",
      days: ALL_DAYS,
      ratePerKwh: 0.15,
    },
    {
      label: "Peak",
      startTime: "16:00",
      endTime: "21:00",
      days: ALL_DAYS,
      ratePerKwh: 0.45,
    },
    {
      label: "Shoulder",
      startTime: "21:00",
      endTime: "00:00",
      days: ALL_DAYS,
      ratePerKwh: 0.25,
    },
  ],
  "ev-tou": [
    {
      label: "EV",
      startTime: "00:00",
      endTime: "06:00",
      days: ALL_DAYS,
      ratePerKwh: 0.08,
    },
    {
      label: "Shoulder",
      startTime: "06:00",
      endTime: "11:00",
      days: ALL_DAYS,
      ratePerKwh: 0.25,
    },
    {
      label: "Off-Peak",
      startTime: "11:00",
      endTime: "16:00",
      days: ALL_DAYS,
      ratePerKwh: 0.15,
    },
    {
      label: "Peak",
      startTime: "16:00",
      endTime: "21:00",
      days: ALL_DAYS,
      ratePerKwh: 0.45,
    },
    {
      label: "Shoulder",
      startTime: "21:00",
      endTime: "00:00",
      days: ALL_DAYS,
      ratePerKwh: 0.25,
    },
  ],
};

const TARIFF_CACHE_REFRESH_MS = 5 * 60 * 1000; // 5 minutes

export class TariffService {
  private cachedTariffPeriods: TariffPeriodRow[] = [];
  private cachedDefaultRate = 0;
  private cachedTimezone: string | undefined;
  private tariffLastRefreshed = 0;
  private refreshPromise: Promise<void> | null = null;
  private readonly logger: Logger;

  constructor(private db: AppDatabase, logger: Logger) {
    this.logger = logger;
  }

  /**
   * Resolve the current applicable tariff rate, using a cached copy of
   * tariff periods and the default rate.  The cache is refreshed every
   * 5 minutes automatically.
   *
   * Returns null when no tariffs are configured and the default rate is 0.
   */
  async resolveCurrentRate(): Promise<number | null> {
    await this.refreshCacheIfStale();

    if (
      this.cachedTariffPeriods.length === 0 && this.cachedDefaultRate === 0
    ) {
      return null;
    }

    const now = new Date();
    const { currentMinutes, currentDayAbbr } = getTimezoneTimeParts(
      now,
      this.cachedTimezone ?? "",
    );

    const period = getApplicablePeriodForTime(
      currentMinutes,
      currentDayAbbr,
      this.cachedTariffPeriods,
    );

    return period?.ratePerKwh ?? this.cachedDefaultRate;
  }

  /** Refresh the tariff cache if it is older than TARIFF_CACHE_REFRESH_MS. */
  private async refreshCacheIfStale(): Promise<void> {
    if (Date.now() - this.tariffLastRefreshed < TARIFF_CACHE_REFRESH_MS) {
      return;
    }
    if (this.refreshPromise) {
      await this.refreshPromise;
      return;
    }
    this.refreshPromise = this.refreshCache().finally(() => {
      this.refreshPromise = null;
    });
    await this.refreshPromise;
  }

  /** Force-refresh the tariff period, default rate, and timezone caches from DB. */
  private async refreshCache(): Promise<void> {
    try {
      this.cachedTariffPeriods = await this.db.getTariffPeriods();
      const val = await this.db.getConfig("default_rate_per_kwh");
      this.cachedDefaultRate = Number(val ?? 0) || 0;
      this.cachedTimezone = (await this.db.getConfig("timezone")) ?? undefined;
      this.tariffLastRefreshed = Date.now();
    } catch (error) {
      this.logger.error("Failed to refresh tariff cache:", error);
    }
  }

  /** List all tariff periods + default rate + currency config. */
  async list() {
    const periods = await this.db.getTariffPeriods();
    const defaultRate = Number(
      (await this.db.getConfig("default_rate_per_kwh")) ?? "0",
    );
    const currencySymbol = (await this.db.getConfig("currency_symbol")) ?? "$";
    const currencyCode = (await this.db.getConfig("currency_code")) ?? "AUD";

    return {
      periods,
      defaultRatePerKwh: defaultRate,
      currencySymbol,
      currencyCode,
    };
  }

  /** Get default rate + currency config. */
  async getDefaultRate() {
    const rate = Number(
      (await this.db.getConfig("default_rate_per_kwh")) ?? "0",
    );
    const currencySymbol = (await this.db.getConfig("currency_symbol")) ?? "$";
    const currencyCode = (await this.db.getConfig("currency_code")) ?? "AUD";

    return {
      ratePerKwh: rate,
      currencySymbol,
      currencyCode,
    };
  }

  /** Get current active tariff rate with next rate change info. */
  async getCurrentRate() {
    const periods = await this.db.getTariffPeriods();
    const defaultRate = Number(
      (await this.db.getConfig("default_rate_per_kwh")) ?? "0",
    );
    const timezone = (await this.db.getConfig("timezone")) ?? "";
    const currencySymbol = (await this.db.getConfig("currency_symbol")) ?? "$";

    // If no tariffs configured and default rate is 0 (unset), return null
    const enabledPeriods = periods.filter((p) => p.enabled);
    if (enabledPeriods.length === 0 && defaultRate === 0) {
      return null;
    }

    const now = new Date();
    const { currentMinutes, currentDayAbbr, tomorrowDayAbbr } =
      getTimezoneTimeParts(now, timezone);

    const currentPeriod = getApplicablePeriodForTime(
      currentMinutes,
      currentDayAbbr,
      periods,
    );
    const currentRate = currentPeriod?.ratePerKwh ?? defaultRate;
    const currentLabel = currentPeriod?.label ?? "Default";

    const nextRate = this.findNextRateChange(
      now,
      currentMinutes,
      currentDayAbbr,
      tomorrowDayAbbr,
      periods,
      defaultRate,
      currentRate,
    );

    return {
      ratePerKwh: currentRate,
      label: currentLabel,
      currencySymbol,
      nextRate,
    };
  }

  /** Create a tariff period. */
  async create(input: CreateTariffPeriodInput & { enabled?: boolean }) {
    const id = await this.db.createTariffPeriod({
      label: input.label,
      startTime: input.startTime,
      endTime: input.endTime,
      days: input.days,
      ratePerKwh: input.ratePerKwh,
      enabled: input.enabled,
    });

    const period = await this.db.getTariffPeriod(id);
    if (!period) {
      throw new ServiceError(
        "Failed to create tariff period",
        "INTERNAL_SERVER_ERROR",
      );
    }

    return { period };
  }

  /** Update a tariff period. */
  async update(
    id: number,
    input: Partial<CreateTariffPeriodInput & { enabled?: boolean }>,
  ) {
    const existing = await this.db.getTariffPeriod(id);
    if (!existing) {
      throw new ServiceError("Tariff period not found", "NOT_FOUND");
    }

    await this.db.updateTariffPeriod(id, {
      label: input.label,
      startTime: input.startTime,
      endTime: input.endTime,
      days: input.days,
      ratePerKwh: input.ratePerKwh,
      enabled: input.enabled,
    });

    const period = await this.db.getTariffPeriod(id);
    if (!period) {
      throw new ServiceError(
        "Tariff period not found after update",
        "INTERNAL_SERVER_ERROR",
      );
    }

    return { period };
  }

  /** Delete a tariff period. */
  async delete(id: number) {
    const existing = await this.db.getTariffPeriod(id);
    if (!existing) {
      throw new ServiceError("Tariff period not found", "NOT_FOUND");
    }

    await this.db.deleteTariffPeriod(id);
    return { success: true };
  }

  /** Update default rate + optional currency config. */
  async updateDefaultRate(input: {
    ratePerKwh: number;
    currencySymbol?: string;
    currencyCode?: string;
  }) {
    await this.db.setConfig(
      "default_rate_per_kwh",
      String(input.ratePerKwh),
    );

    if (input.currencySymbol !== undefined) {
      await this.db.setConfig("currency_symbol", input.currencySymbol);
    }
    if (input.currencyCode !== undefined) {
      await this.db.setConfig("currency_code", input.currencyCode);
    }

    const currencySymbol = (await this.db.getConfig("currency_symbol")) ?? "$";
    const currencyCode = (await this.db.getConfig("currency_code")) ?? "AUD";

    return {
      ratePerKwh: input.ratePerKwh,
      currencySymbol,
      currencyCode,
    };
  }

  /** Load a preset template (delete all existing + create from template). */
  async loadPreset(template: string) {
    const preset = PRESETS[template];
    if (!preset) {
      throw new ServiceError(
        `Unknown preset template: ${template}. Valid: ${
          Object.keys(PRESETS).join(", ")
        }`,
        "BAD_REQUEST",
      );
    }

    // Delete all existing periods and create new ones from the preset
    await this.db.deleteAllTariffPeriods();
    await preset.reduce(async (prev, period) => {
      await prev;
      await this.db.createTariffPeriod(period);
    }, Promise.resolve());

    const periods = await this.db.getTariffPeriods();
    return { periods };
  }

  /** Find the next upcoming rate change within the next 24 hours. */
  private findNextRateChange(
    now: Date,
    currentMinutes: number,
    currentDayAbbr: DayOfWeek,
    tomorrowDayAbbr: DayOfWeek,
    tariffPeriods: import("../db/types.ts").TariffPeriodRow[],
    defaultRate: number,
    currentRate: number,
  ): { ratePerKwh: number; label: string; startsAt: string } | null {
    const enabled = tariffPeriods.filter((p) => p.enabled);

    // Collect candidate transition points (period starts and ends)
    type Candidate = {
      minutesFromNow: number;
      checkMinutes: number;
      checkDay: DayOfWeek;
    };
    type Rule = (
      p: (typeof enabled)[number],
      startMin: number,
      endMin: number,
    ) => Candidate | null;

    const minutesUntilMidnight = 24 * 60 - currentMinutes;
    const candidateRules: Rule[] = [
      // Today's start after current time
      (p, startMin) => {
        if (!p.days.includes(currentDayAbbr)) return null;
        if (startMin <= currentMinutes) return null;
        return {
          minutesFromNow: startMin - currentMinutes,
          checkMinutes: startMin,
          checkDay: currentDayAbbr,
        };
      },
      // Today's end after current time
      (p, _startMin, endMin) => {
        if (!p.days.includes(currentDayAbbr)) return null;
        if (endMin <= currentMinutes) return null;
        return {
          minutesFromNow: endMin - currentMinutes,
          checkMinutes: endMin,
          checkDay: currentDayAbbr,
        };
      },
      // Overnight period end (e.g. 22:00-07:00) wraps to tomorrow
      (p, startMin, endMin) => {
        if (!p.days.includes(currentDayAbbr)) return null;
        if (startMin <= endMin) return null;
        if (endMin > currentMinutes) return null;
        return {
          minutesFromNow: minutesUntilMidnight + endMin,
          checkMinutes: endMin,
          checkDay: tomorrowDayAbbr,
        };
      },
      // Tomorrow's start time
      (p, startMin) => {
        if (!p.days.includes(tomorrowDayAbbr)) return null;
        return {
          minutesFromNow: minutesUntilMidnight + startMin,
          checkMinutes: startMin,
          checkDay: tomorrowDayAbbr,
        };
      },
    ];

    const candidates = enabled.reduce<Candidate[]>((acc, p) => {
      const startMin = parseTimeToMinutes(p.startTime);
      const endMin = parseTimeToMinutes(p.endTime);
      return candidateRules.reduce((ruleAcc, rule) => {
        const candidate = rule(p, startMin, endMin);
        if (candidate) ruleAcc.push(candidate);
        return ruleAcc;
      }, acc);
    }, []);

    // Sort by time, deduplicate
    candidates.sort((a, b) => a.minutesFromNow - b.minutesFromNow);
    const seen = new Set<number>();
    const unique = candidates.filter((c) => {
      if (seen.has(c.minutesFromNow)) return false;
      seen.add(c.minutesFromNow);
      return true;
    });

    // Find first transition where rate differs from current
    const found = unique.find((c) => {
      const period = getApplicablePeriodForTime(
        c.checkMinutes,
        c.checkDay,
        tariffPeriods,
      );
      const rate = period?.ratePerKwh ?? defaultRate;
      return rate !== currentRate;
    });
    if (found) {
      const period = getApplicablePeriodForTime(
        found.checkMinutes,
        found.checkDay,
        tariffPeriods,
      );
      const rate = period?.ratePerKwh ?? defaultRate;
      const label = period?.label ?? "Default";
      const startsAt = new Date(
        now.getTime() + found.minutesFromNow * 60_000,
      ).toISOString();
      return { ratePerKwh: rate, label, startsAt };
    }

    return null;
  }
}
