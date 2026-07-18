import { assertExists } from "@std/assert";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

type RealtimeHandlers = {
  onEnergyUpdate: (data: unknown) => void;
  onVehicleUpdate: (data: unknown) => void;
  onVehiclesChanged: () => void;
  onVehicleError: (data: unknown) => void;
};

const mocks = vi.hoisted(() => ({
  setData_energyRealtime: vi.fn(),
  setData_vehicleList: vi.fn(),
  invalidate_vehicleList: vi.fn(),
  invalidate_getPlugins: vi.fn(),
  invalidate_pluginVehicle: vi.fn(),
  setError: vi.fn(),
  clearError: vi.fn(),
  captured: { handlers: null as RealtimeHandlers | null },
}));

vi.mock("../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    useUtils: vi.fn(() => ({
      energy: {
        realtime: { setData: mocks.setData_energyRealtime },
      },
      vehicle: {
        list: {
          setData: mocks.setData_vehicleList,
          invalidate: mocks.invalidate_vehicleList,
        },
        getPlugins: { invalidate: mocks.invalidate_getPlugins },
      },
      plugin: {
        vehicle: { invalidate: mocks.invalidate_pluginVehicle },
      },
    })),
  },
}));

vi.mock("../hooks/useRealtimeEvents.ts", () => ({
  useRealtimeEvents: (handlers: RealtimeHandlers) => {
    mocks.captured.handlers = handlers;
  },
}));

vi.mock("../hooks/vehicleErrorStore.ts", () => ({
  vehicleErrorStore: {
    setError: (...args: unknown[]) => mocks.setError(...args),
    clearError: (...args: unknown[]) => mocks.clearError(...args),
  },
}));

import { RealtimeSync } from "./RealtimeSync.tsx";

describe("RealtimeSync", () => {
  beforeEach(() => {
    mocks.setData_energyRealtime.mockClear();
    mocks.setData_vehicleList.mockClear();
    mocks.invalidate_vehicleList.mockClear();
    mocks.invalidate_getPlugins.mockClear();
    mocks.invalidate_pluginVehicle.mockClear();
    mocks.setError.mockClear();
    mocks.clearError.mockClear();
    mocks.captured.handlers = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders null (renderless component)", () => {
    const { container } = render(<RealtimeSync />);
    expect(container.innerHTML).toBe("");
  });

  describe("onVehiclesChanged", () => {
    it("invalidates the list, plugin configured-state, and plugin vehicle lists", () => {
      render(<RealtimeSync />);

      assertExists(mocks.captured.handlers);
      mocks.captured.handlers.onVehiclesChanged();

      // A plugin's settings pane reads its own vehicle list, so all three must
      // refresh on a membership change — not just the top-level list.
      expect(mocks.invalidate_vehicleList).toHaveBeenCalled();
      expect(mocks.invalidate_getPlugins).toHaveBeenCalled();
      expect(mocks.invalidate_pluginVehicle).toHaveBeenCalled();
    });
  });

  describe("onEnergyUpdate", () => {
    it("updates energy realtime cache with event data", () => {
      render(<RealtimeSync />);

      const data = {
        solarProductionW: 5000,
        gridPowerW: -2000,
        homeConsumptionW: 3000,
        batteryPowerW: 0,
        batterySoc: 80,
        gridVoltageV: 240,
        lastUpdated: "2026-03-23T10:00:00Z",
        solarProducedWh: 10000,
        gridImportedWh: 500,
        gridExportedWh: 3000,
        dailySolarProducedWh: 8000,
        dailyGridImportWh: 200,
        dailyGridExportWh: 1500,
      };

      assertExists(mocks.captured.handlers);
      mocks.captured.handlers.onEnergyUpdate(data);

      expect(mocks.setData_energyRealtime).toHaveBeenCalledWith(undefined, {
        timestamp: data.lastUpdated,
        realtime: {
          solarProductionW: data.solarProductionW,
          gridPowerW: data.gridPowerW,
          homeConsumptionW: data.homeConsumptionW,
          batteryPowerW: data.batteryPowerW,
          batterySoc: data.batterySoc,
          gridVoltageV: data.gridVoltageV,
          lastUpdated: data.lastUpdated,
        },
        cumulative: {
          solarProducedWh: data.solarProducedWh,
          gridImportedWh: data.gridImportedWh,
          gridExportedWh: data.gridExportedWh,
          dailySolarProducedWh: data.dailySolarProducedWh,
          dailyGridImportWh: data.dailyGridImportWh,
          dailyGridExportWh: data.dailyGridExportWh,
        },
      });
    });
  });

  describe("onVehicleUpdate", () => {
    it("updates matching vehicle in cache", () => {
      render(<RealtimeSync />);

      const update = {
        vehicleId: "v1",
        isCharging: true,
        batteryLevel: 60,
      };

      assertExists(mocks.captured.handlers);
      mocks.captured.handlers.onVehicleUpdate(update);

      expect(mocks.setData_vehicleList).toHaveBeenCalledWith(
        undefined,
        expect.any(Function),
      );

      // Execute the updater function to verify it maps vehicles correctly
      const updater = mocks.setData_vehicleList.mock.calls[0][1];

      // When old data has matching vehicle
      const oldData = {
        vehicles: [
          { id: "v1", name: "Model 3", state: { isCharging: false } },
          { id: "v2", name: "Model Y", state: { isCharging: false } },
        ],
      };

      const result = updater(oldData);
      expect(result.vehicles[0].state).toEqual(update);
      expect(result.vehicles[1].state).toEqual({ isCharging: false });
    });

    it("returns old data unchanged when old is undefined", () => {
      render(<RealtimeSync />);

      assertExists(mocks.captured.handlers);
      mocks.captured.handlers.onVehicleUpdate({ vehicleId: "v1" });

      const updater = mocks.setData_vehicleList.mock.calls[0][1];
      expect(updater(undefined)).toBeUndefined();
    });
  });

  describe("onVehicleError", () => {
    it("sets error when error is not null", () => {
      render(<RealtimeSync />);

      assertExists(mocks.captured.handlers);
      mocks.captured.handlers.onVehicleError({
        vehicleId: "v1",
        error: "Connection failed",
      });

      expect(mocks.setError).toHaveBeenCalledWith("v1", "Connection failed");
      expect(mocks.clearError).not.toHaveBeenCalled();
    });

    it("clears error when error is null", () => {
      render(<RealtimeSync />);

      assertExists(mocks.captured.handlers);
      mocks.captured.handlers.onVehicleError({
        vehicleId: "v1",
        error: null,
      });

      expect(mocks.clearError).toHaveBeenCalledWith("v1");
      expect(mocks.setError).not.toHaveBeenCalled();
    });
  });
});
