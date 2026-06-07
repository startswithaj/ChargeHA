import type { DayOfWeek } from "@chargeha/shared";
import type { MutationHandlers } from "../types.ts";
import type { DemoTariff } from "../../demoState.ts";
import { getDemoState, updateDemoState } from "../../demoState.ts";

type TariffMutations = Pick<
  MutationHandlers,
  | "tariff.create"
  | "tariff.update"
  | "tariff.delete"
  | "tariff.updateDefaultRate"
  | "tariff.loadPreset"
>;

const ALL_DAYS: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const stamp = () => new Date().toISOString();

/** Built-in preset templates (mirror the server's flat / time-of-use sets). */
type PresetPeriod = Omit<DemoTariff, "id" | "createdAt" | "updatedAt">;
const PRESETS: Record<string, PresetPeriod[]> = {
  flat: [
    {
      label: "Flat Rate",
      startTime: "00:00",
      endTime: "00:00",
      days: ALL_DAYS,
      ratePerKwh: 0.30,
      enabled: true,
    },
  ],
  tou: [
    {
      label: "Shoulder",
      startTime: "00:00",
      endTime: "11:00",
      days: ALL_DAYS,
      ratePerKwh: 0.25,
      enabled: true,
    },
    {
      label: "Off-Peak",
      startTime: "11:00",
      endTime: "16:00",
      days: ALL_DAYS,
      ratePerKwh: 0.15,
      enabled: true,
    },
    {
      label: "Peak",
      startTime: "16:00",
      endTime: "21:00",
      days: ALL_DAYS,
      ratePerKwh: 0.45,
      enabled: true,
    },
    {
      label: "Shoulder",
      startTime: "21:00",
      endTime: "00:00",
      days: ALL_DAYS,
      ratePerKwh: 0.25,
      enabled: true,
    },
  ],
};

const nextId = (tariffs: DemoTariff[]): number =>
  tariffs.reduce((max, t) => Math.max(max, t.id), 0) + 1;

export const tariffMutations: TariffMutations = {
  "tariff.create": (input) => {
    const period: DemoTariff = {
      id: nextId(getDemoState().tariffs),
      label: input.label,
      startTime: input.startTime,
      endTime: input.endTime,
      days: input.days,
      ratePerKwh: input.ratePerKwh,
      enabled: input.enabled ?? true,
      createdAt: stamp(),
      updatedAt: stamp(),
    };
    updateDemoState((m) => ({ ...m, tariffs: [...m.tariffs, period] }));
    return { period };
  },

  "tariff.update": (input) => {
    const merge = (t: DemoTariff): DemoTariff => ({
      ...t,
      label: input.label ?? t.label,
      startTime: input.startTime ?? t.startTime,
      endTime: input.endTime ?? t.endTime,
      days: input.days ?? t.days,
      ratePerKwh: input.ratePerKwh ?? t.ratePerKwh,
      enabled: input.enabled ?? t.enabled,
      updatedAt: stamp(),
    });
    const next = updateDemoState((m) => ({
      ...m,
      tariffs: m.tariffs.map((t) => (t.id === input.id ? merge(t) : t)),
    }));
    const period = next.tariffs.find((t) => t.id === input.id);
    if (!period) throw new Error(`Demo: tariff ${input.id} not found`);
    return { period };
  },

  "tariff.delete": (input) => {
    updateDemoState((m) => ({
      ...m,
      tariffs: m.tariffs.filter((t) => t.id !== input.id),
    }));
    return { success: true };
  },

  "tariff.updateDefaultRate": (input) => {
    updateDemoState((m) => ({
      ...m,
      config: {
        ...m.config,
        default_rate_per_kwh: String(input.ratePerKwh),
        currency_symbol: input.currencySymbol ?? m.config.currency_symbol,
        currency_code: input.currencyCode ?? m.config.currency_code,
      },
    }));
    const { config } = getDemoState();
    return {
      ratePerKwh: input.ratePerKwh,
      currencySymbol: config.currency_symbol ?? "$",
      currencyCode: config.currency_code ?? "AUD",
    };
  },

  "tariff.loadPreset": (input) => {
    const preset = PRESETS[input.template];
    if (!preset) throw new Error(`Demo: unknown preset "${input.template}"`);
    const periods = preset.map((p, i) => ({
      ...p,
      id: i + 1,
      createdAt: stamp(),
      updatedAt: stamp(),
    }));
    updateDemoState((m) => ({ ...m, tariffs: periods }));
    return { periods };
  },
};
