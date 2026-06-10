import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { Dashboard } from "./Dashboard.tsx";
import {
  type DashboardHarness,
  dashboardMocks,
  makeVehicle,
  makeVehicleState,
  setupDashboard,
} from "./test-helpers/setupDashboard.tsx";

vi.mock("../../../hooks/useEnergyData.ts", () => ({
  useEnergyData: vi.fn(() => ({
    data: {
      realtime: {
        solarProductionW: 5000,
        gridPowerW: -2000,
        homeConsumptionW: 3000,
        batteryPowerW: null,
        batterySoc: null,
      },
      cumulative: {
        solarProducedWh: 50000,
        gridImportedWh: 10000,
        gridExportedWh: 20000,
        dailySolarProducedWh: 5000,
        dailyGridImportWh: 1000,
        dailyGridExportWh: 2000,
      },
      lastUpdated: null,
    },
    isLoading: false,
    error: null,
  })),
}));

vi.mock("../../../hooks/useVehicles.ts", () => ({
  useVehicles: vi.fn(() => ({
    vehicles: [],
    loading: false,
    error: null,
    commandPending: {},
    vehicleErrors: {},
    startCharging: vi.fn(),
    stopCharging: vi.fn(),
    setAmps: vi.fn(),
    changeMode: vi.fn(),
    refreshVehicles: vi.fn(),
  })),
}));

vi.mock("../../../hooks/useToast.tsx", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../hooks/useToast.tsx")>(),
  useToast: vi.fn(() => ({
    addToast: vi.fn(),
    removeToast: vi.fn(),
    toasts: [],
  })),
}));

vi.mock("../../../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    config: {
      charging: {
        get: {
          useQuery: vi.fn(() => ({
            data: null,
            isLoading: false,
            error: null,
          })),
        },
        set: {
          useMutation: vi.fn(() => ({
            mutate: vi.fn(),
            mutateAsync: vi.fn(),
            isPending: false,
          })),
        },
      },
      home: {
        get: {
          useQuery: vi.fn(() => ({
            data: { homeLatitude: null, homeLongitude: null },
            isLoading: false,
            error: null,
          })),
        },
      },
      systemAlert: {
        useQuery: () => dashboardMocks.configGetAllUseQuery(),
      },
      dismissSystemAlert: {
        useMutation: vi.fn(
          (
            opts?: {
              onSuccess?: () => void;
              onError?: (err: { message: string }) => void;
            },
          ) => {
            dashboardMocks.capturedDismiss.onSuccess = opts?.onSuccess;
            return {
              mutate: dashboardMocks.dismissMutate,
              mutateAsync: vi.fn(),
              isPending: false,
            };
          },
        ),
      },
    },
    health: {
      pluginWarnings: {
        useQuery: () => dashboardMocks.pluginWarningsUseQuery(),
      },
    },
    tesla: {
      getConfig: {
        useQuery: vi.fn(() => ({ data: {}, isLoading: false, error: null })),
      },
    },
    stats: {
      day: {
        useQuery: vi.fn(() => ({
          data: { totalChargedWh: 0, totalSolarWh: 0 },
          isLoading: false,
          error: null,
        })),
      },
    },
    tariff: {
      currentRate: {
        useQuery: () => dashboardMocks.tariffCurrentRateUseQuery(),
      },
    },
    schedule: {
      active: {
        useQuery: vi.fn(() => ({ data: [], isLoading: false, error: null })),
      },
    },
    vehicle: {
      command: {
        useMutation: vi.fn(() => ({
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          isPending: false,
          variables: null,
        })),
      },
      refreshState: {
        useMutation: vi.fn(() => ({
          mutate: vi.fn(),
          mutateAsync: vi.fn().mockResolvedValue({ state: null }),
          isPending: false,
        })),
      },
      commandStatus: {
        useQuery: () => dashboardMocks.commandStatusUseQuery(),
      },
    },
    useUtils: vi.fn(() => ({
      config: {
        systemAlert: {
          invalidate: dashboardMocks.invalidateConfig,
        },
      },
    })),
  },
}));

vi.mock("../../EnergyFlowDiagram/EnergyFlowDiagram.tsx", () => ({
  EnergyFlowDiagram: () => <div data-testid="energy-flow" />,
}));

// MetricCard mock surfaces `loading` and `subtitle` so tests can assert prop wiring.
vi.mock("../../MetricCard/MetricCard.tsx", () => ({
  MetricCard: (
    { label, subtitle, loading }: {
      label: string;
      subtitle?: string;
      loading?: boolean;
    },
  ) => (
    <div data-testid="metric-card" data-loading={loading ? "true" : "false"}>
      {label}
      {subtitle && <span data-testid="metric-subtitle">{subtitle}</span>}
    </div>
  ),
}));

// VehicleCard mock surfaces solarPowerW/gridPowerW so tests can assert the
// computed solar/grid split per vehicle.
vi.mock("../../VehicleCard/VehicleCard.tsx", () => ({
  VehicleCard: (
    { name, onNavigateSettings, solarPowerW, gridPowerW }: {
      name: string;
      onNavigateSettings?: () => void;
      solarPowerW?: number;
      gridPowerW?: number;
    },
  ) => (
    <div
      data-testid="vehicle-card"
      data-name={name}
      data-solar-w={solarPowerW ?? ""}
      data-grid-w={gridPowerW ?? ""}
    >
      {name}
      {onNavigateSettings && (
        <button
          type="button"
          data-testid="vehicle-card-settings"
          onClick={onNavigateSettings}
        >
          Settings
        </button>
      )}
    </div>
  ),
}));

describe("Dashboard", () => {
  let h: DashboardHarness;

  beforeEach(() => {
    vi.clearAllMocks();
    h = setupDashboard();
  });

  afterEach(() => {
    cleanup();
  });

  // ---- Basic rendering ----

  it("renders energy metric cards", () => {
    h.render();

    expect(screen.getByText("Solar Generated")).toBeInTheDocument();
    expect(screen.getByText("Home Consumed")).toBeInTheDocument();
    expect(screen.getByText("Grid Import")).toBeInTheDocument();
    expect(screen.getByText("Grid Export")).toBeInTheDocument();
  });

  it("renders energy flow diagram", () => {
    h.render();

    expect(screen.getByTestId("energy-flow")).toBeInTheDocument();
  });

  it("renders no vehicles state when vehicles array is empty", () => {
    h.render();

    expect(screen.getByText("No vehicles configured")).toBeInTheDocument();
  });

  it("renders vehicle cards when vehicles have state", () => {
    h.setVehicles();

    h.render();

    expect(screen.getByTestId("vehicle-card")).toBeInTheDocument();
    expect(screen.queryByText("No vehicles configured")).not
      .toBeInTheDocument();
  });

  // ---- Loading state ----

  it("forwards loading prop to MetricCard when energy data is loading", () => {
    h.setEnergyLoading();

    h.render();

    const cards = screen.getAllByTestId("metric-card");
    // Every metric card receives loading=true while energy data is loading.
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((c) => c.getAttribute("data-loading") === "true"))
      .toBe(true);
  });

  // ---- lastUpdated timestamp ----

  it("renders relative time when lastUpdated is set", () => {
    h.setEnergy({ lastUpdated: new Date(Date.now() - 30_000) });

    h.render();

    expect(screen.getByText(/Updated \d+s ago/)).toBeInTheDocument();
  });

  it("does not render timestamp when lastUpdated is null", () => {
    h.setEnergy({ lastUpdated: null });

    h.render();

    expect(screen.queryByText(/Updated/)).not.toBeInTheDocument();
  });

  // ---- System alert ----

  it("shows system alert when config contains system_alert data", async () => {
    h.setSystemAlert({
      message: "Overcurrent detected on VIN1",
      timestamp: new Date().toISOString(),
      vehicleId: "VIN1",
      vehicleName: "Test Car",
    });

    h.render();

    await waitFor(() => {
      expect(screen.getByText("Safety Alert")).toBeInTheDocument();
    });
    expect(screen.getByText("Overcurrent detected on VIN1"))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Dismiss/i }))
      .toBeInTheDocument();
  });

  it("dismisses alert when Dismiss button is clicked", async () => {
    h.setSystemAlert({
      message: "Overcurrent detected",
      timestamp: new Date().toISOString(),
      vehicleId: "VIN1",
      vehicleName: "Test Car",
    });

    const { rerender } = h.render();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Dismiss/i }))
        .toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Dismiss/i }));

    await waitFor(() => {
      expect(dashboardMocks.dismissMutate).toHaveBeenCalled();
      expect(dashboardMocks.invalidateConfig).toHaveBeenCalled();
    });

    h.setSystemAlert(null);
    rerender(<Dashboard />);

    expect(screen.queryByText("Safety Alert")).not.toBeInTheDocument();
  });

  // ---- Plugin warnings ----

  it("shows plugin warning when health check fails", async () => {
    h.setPluginWarnings([{
      title: "Proxy Unreachable",
      message: "Commands will fail.",
    }]);

    h.render();

    await waitFor(() => {
      expect(screen.getByText("Proxy Unreachable")).toBeInTheDocument();
      expect(screen.getByText("Commands will fail.")).toBeInTheDocument();
    });
  });

  // ---- Vehicle without state (asleep/unreachable) ----

  it("renders asleep card with Wake button when vehicle has no state", () => {
    h.setVehicles([{
      id: "VIN2",
      name: "Sleeping Car",
      mode: "auto",
      adapterType: "simulated",
      priority: 1,
      config: "{}",
      state: null,
      lastLocation: null,
    }]);

    h.render();

    expect(screen.getByText("Sleeping Car")).toBeInTheDocument();
    expect(screen.getByText("Vehicle is asleep or unreachable"))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Wake/i })).toBeInTheDocument();
  });

  it("calls tRPC vehicle.command mutation with 'wake' when Wake button is clicked", async () => {
    const mockMutate = vi.fn();
    h.setWakeMutation({ mutate: mockMutate });

    h.setVehicles([{
      id: "VIN2",
      name: "Sleeping Car",
      mode: "auto",
      adapterType: "simulated",
      priority: 1,
      config: "{}",
      state: null,
      lastLocation: null,
    }]);

    h.render();

    fireEvent.click(screen.getByRole("button", { name: /Wake/i }));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith({
        vehicleId: "VIN2",
        command: "wake",
      });
    });
  });

  it("shows toast error when wake command fails", async () => {
    const addToast = vi.fn();
    h.setToast(addToast);
    h.setWakeMutationOnError(() => {});

    h.setVehicles([{
      id: "VIN2",
      name: "Sleeping Car",
      mode: "auto",
      adapterType: "simulated",
      priority: 1,
      config: "{}",
      state: null,
      lastLocation: null,
    }]);

    h.render();

    fireEvent.click(screen.getByRole("button", { name: /Wake/i }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("Wake failed", "error");
    });
  });

  it("disables Wake button while command is in flight", async () => {
    h.setWakeMutation({
      mutate: vi.fn(),
      isPending: true,
      variables: { vehicleId: "VIN2", command: "wake" },
    });

    h.setVehicles([{
      id: "VIN2",
      name: "Sleeping Car",
      mode: "auto",
      adapterType: "simulated",
      priority: 1,
      config: "{}",
      state: null,
      lastLocation: null,
    }]);

    h.render();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Waking/i })).toBeDisabled();
    });
  });

  // ---- Battery metric card ----

  it("renders Battery metric card when batteryPowerW is present", () => {
    h.setEnergy({
      realtime: {
        solarProductionW: 5000,
        gridPowerW: -1000,
        homeConsumptionW: 3000,
        batteryPowerW: 1500,
        batterySoc: 68,
      },
    });

    h.render();

    expect(screen.getByText("Battery")).toBeInTheDocument();
    expect(screen.getByText("68% charged")).toBeInTheDocument();
  });

  it("does not render Battery metric card when batteryPowerW is null", () => {
    h.setEnergy();

    h.render();

    expect(screen.queryByText("Battery")).not.toBeInTheDocument();
  });

  it("renders Battery metric without subtitle when batterySoc is null", () => {
    h.setEnergy({
      realtime: {
        solarProductionW: 5000,
        gridPowerW: -1000,
        homeConsumptionW: 3000,
        batteryPowerW: 800,
        batterySoc: null,
      },
    });

    h.render();

    expect(screen.getByText("Battery")).toBeInTheDocument();
    expect(screen.queryByText(/% charged/)).not.toBeInTheDocument();
  });

  // ---- Daily stats cards ----

  it("renders Charged Today and Solar to EVs cards", () => {
    h.render();

    expect(screen.getByText("Charged Today")).toBeInTheDocument();
    expect(screen.getByText("Solar to EVs")).toBeInTheDocument();
  });

  // ---- Vehicle solar/grid computation ----

  it("passes computed solarW and gridW to VehicleCard for a charging vehicle", () => {
    // solar 4000W, home 1000W → available solar = 3000W; vehicle charges at 3000W
    // → solarW = 3000, gridW = 0
    h.setEnergy({
      realtime: {
        solarProductionW: 4000,
        gridPowerW: 0,
        homeConsumptionW: 1000,
        batteryPowerW: null,
        batterySoc: null,
      },
    });
    h.setVehicles([
      makeVehicle({
        state: makeVehicleState({ isCharging: true, chargePowerKw: 3.0 }),
      }),
    ]);

    h.render();

    const card = screen.getByTestId("vehicle-card");
    expect(card.getAttribute("data-solar-w")).toBe("3000");
    expect(card.getAttribute("data-grid-w")).toBe("0");
  });

  it("renders multiple charging vehicles and computes individual solar/grid splits", () => {
    // solar 8000W, home 1000W, two vehicles charging at 3000W each
    // → each gets vehicleShare = 0.5 → solarW = min(3000, 13000*0.5, 8000*0.5)
    //   = 3000, gridW = 0
    h.setEnergy({
      realtime: {
        solarProductionW: 8000,
        gridPowerW: -1000,
        homeConsumptionW: 1000,
        batteryPowerW: null,
        batterySoc: null,
      },
    });
    h.setVehicles([
      makeVehicle({
        id: "VIN1",
        name: "Car One",
        state: makeVehicleState({
          vehicleId: "VIN1",
          vehicleName: "Car One",
          isCharging: true,
          chargePowerKw: 3.0,
        }),
      }),
      makeVehicle({
        id: "VIN2",
        name: "Car Two",
        state: makeVehicleState({
          vehicleId: "VIN2",
          vehicleName: "Car Two",
          isCharging: true,
          chargePowerKw: 3.0,
        }),
      }),
    ]);

    h.render();

    const cards = screen.getAllByTestId("vehicle-card");
    expect(cards).toHaveLength(2);
    // Each vehicle gets an equal share of the solar surplus.
    cards.forEach((card) => {
      expect(card.getAttribute("data-solar-w")).toBe("3000");
      expect(card.getAttribute("data-grid-w")).toBe("0");
    });
  });

  // ---- No vehicles CTA ----

  it("renders Add Vehicle CTA when no vehicles configured", () => {
    h.setVehicles([]);

    h.render();

    expect(screen.getByText("No vehicles configured")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Add a vehicle to monitor charging and control solar allocation/,
      ),
    ).toBeInTheDocument();
  });

  it("does not show no-vehicles CTA while vehicles are loading", () => {
    h.setVehiclesRaw(
      {
        vehicles: [],
        loading: true,
        error: null,
        commandPending: {},
        vehicleErrors: {},
        startCharging: vi.fn(),
        stopCharging: vi.fn(),
        setAmps: vi.fn(),
        changeMode: vi.fn(),
        refreshVehicles: vi.fn(),
      } as unknown as Parameters<DashboardHarness["setVehiclesRaw"]>[0],
    );

    h.render();

    expect(screen.queryByText("No vehicles configured")).not
      .toBeInTheDocument();
  });

  // ---- onNavigateSettings callback ----

  it("passes onNavigateSettings to VehicleCard", () => {
    const onNavigateSettings = vi.fn();
    h.setVehicles();

    h.render({ onNavigateSettings });

    fireEvent.click(screen.getByTestId("vehicle-card-settings"));

    expect(onNavigateSettings).toHaveBeenCalled();
  });

  // ---- Current rate metric card ----

  it("renders Current Rate card with period label and next-rate subtitle", () => {
    h.setTariff({
      ratePerKwh: 15,
      label: "Off-peak",
      currencySymbol: "$",
      nextRate: {
        ratePerKwh: 45,
        label: "Peak",
        startsAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
      },
    });

    h.render();

    expect(screen.getByText("Tariff - Off-peak")).toBeInTheDocument();
    const subtitle = screen.getByTestId("metric-subtitle");
    expect(subtitle.textContent).toContain("Next: Peak ($45.00) in 2h");
  });

  it("does not render Current Rate card when tRPC returns null", () => {
    h.setTariff(null);

    h.render();

    expect(screen.queryByText(/^Tariff - /)).not.toBeInTheDocument();
  });
});
