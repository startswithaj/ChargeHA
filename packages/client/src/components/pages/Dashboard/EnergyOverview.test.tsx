import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import { EnergyOverview } from "./EnergyOverview.tsx";
import { trpc } from "../../../trpc.ts";

vi.mock("../../../hooks/useEnergyData.ts", () => ({
  useEnergyData: () => ({
    data: {
      realtime: {
        solarProductionW: 0,
        gridPowerW: 0,
        homeConsumptionW: 0,
        batteryPowerW: null,
        batterySoc: null,
      },
      cumulative: {
        dailySolarProducedWh: 0,
        dailyGridImportWh: 0,
        dailyGridExportWh: 0,
      },
      lastUpdated: null,
    },
    isLoading: false,
  }),
}));

vi.mock("../../../hooks/useVehicles.ts", () => ({
  useVehicles: () => ({ vehicles: [] }),
}));

vi.mock("../../../hooks/useChargers.ts", () => ({
  useChargers: () => ({ chargers: [], isLoading: false }),
}));

vi.mock("../../../trpc.ts", () => ({
  trpc: {
    stats: { day: { useQuery: vi.fn(() => ({ data: null })) } },
    tariff: { currentRate: { useQuery: vi.fn(() => ({ data: null })) } },
    schedule: { active: { useQuery: vi.fn(() => ({ data: [] })) } },
    config: {
      system: {
        get: {
          useQuery: vi.fn(() => ({
            data: { timezone: "Australia/Brisbane" },
          })),
        },
      },
    },
  },
}));

describe("EnergyOverview day boundary", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(trpc.stats.day.useQuery).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("requests the site-local date when UTC is still on the previous day", () => {
    vi.setSystemTime(new Date("2026-01-15T22:00:00Z"));

    render(
      <Theme>
        <EnergyOverview pluginWarnings={[]} />
      </Theme>,
    );

    const input = vi.mocked(trpc.stats.day.useQuery).mock.calls[0][0];
    expect(input.date).toBe("2026-01-16");
  });
});
