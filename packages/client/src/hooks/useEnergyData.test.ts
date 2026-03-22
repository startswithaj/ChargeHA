import { assertExists } from "@std/assert";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

type CapturedOptions = { select: (data: unknown) => unknown } | null;

const hoisted = vi.hoisted(() => {
  const mockQueryResult: {
    data: unknown;
    isLoading: boolean;
    error: unknown;
  } = {
    data: undefined,
    isLoading: true,
    error: null,
  };
  const captured: { options: CapturedOptions } = { options: null };
  return { mockQueryResult, captured };
});

vi.mock("../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    energy: {
      realtime: {
        useQuery: vi.fn((_input: unknown, opts: unknown) => {
          hoisted.captured.options = opts as CapturedOptions;
          return hoisted.mockQueryResult;
        }),
      },
    },
    useUtils: vi.fn(() => ({
      energy: {
        realtime: {
          setData: vi.fn(),
        },
      },
    })),
  },
}));

import { useEnergyData } from "./useEnergyData.ts";

describe("useEnergyData", () => {
  beforeEach(() => {
    hoisted.captured.options = null;
    hoisted.mockQueryResult.data = undefined;
    hoisted.mockQueryResult.isLoading = true;
    hoisted.mockQueryResult.error = null;
  });

  describe("initial state", () => {
    it("returns the query result", () => {
      const { result } = renderHook(() => useEnergyData());
      expect(result.current.isLoading).toBe(true);
      expect(result.current.data).toBeUndefined();
    });
  });

  describe("select transform", () => {
    it("transforms server data into EnergyQueryData shape", () => {
      renderHook(() => useEnergyData());

      assertExists(hoisted.captured.options);
      const select = hoisted.captured.options.select;
      const serverData = {
        timestamp: "2026-03-01T12:00:00Z",
        realtime: {
          solarProductionW: 3000,
          gridPowerW: -500,
          homeConsumptionW: 2500,
          batteryPowerW: 0,
          batterySoc: 80,
        },
        cumulative: {
          solarProducedWh: 15000,
          gridImportedWh: 2000,
          gridExportedWh: 5000,
          dailySolarProducedWh: 8000,
          dailyGridImportWh: 1500,
          dailyGridExportWh: 3000,
        },
      };

      const result = select(serverData) as {
        realtime: unknown;
        cumulative: unknown;
        lastUpdated: Date;
      };

      expect(result.realtime).toEqual(serverData.realtime);
      expect(result.cumulative).toEqual(serverData.cumulative);
      expect(result.lastUpdated).toEqual(new Date("2026-03-01T12:00:00Z"));
    });
  });
});
