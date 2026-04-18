import "@testing-library/jest-dom/vitest";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithProviders } from "../../test-utils.tsx";

// Radix Slider uses ResizeObserver which jsdom doesn't provide
beforeAll(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView = vi.fn();
});

vi.mock("../../lib/simulateSolarAllocation.ts", () => ({
  parseConfigToSolarConfig: vi.fn().mockReturnValue({
    solarTrackingEnabled: true,
    solarTrackingMode: "solar_only",
    solarReference: "excess",
    solarMarginKw: 0,
    minSolarGenerationKw: 0.2,
    minExcessSolarKw: null,
    gridVoltage: 230,
    threePhaseCharger: false,
    batteryPriorityEnabled: false,
    batteryPriorityLimit: 80,
  }),
  simulateSolarAllocation: vi.fn(),
}));

import type { VehicleWithState } from "@chargeha/shared";
import { SolarSimulation } from "./SolarSimulation.tsx";
import {
  simulateSolarAllocation,
  type SimulationResult,
  type VehicleAllocation,
} from "../../lib/simulateSolarAllocation.ts";

describe("SolarSimulation", () => {
  const mockVehicle = {
    id: "v1",
    name: "Model 3",
    adapterType: "tesla",
    priority: 1,
    config: "{}",
    mode: "auto",
    state: {
      vehicleId: "v1",
      batteryLevel: 60,
      chargeLimit: 80,
      isCharging: true,
      isPluggedIn: true,
      isOnline: true,
      chargeAmps: 10,
      chargeAmpsMax: 16,
      chargeAmpsMin: 5,
      chargePowerKw: 2.3,
      chargerVoltage: 230,
      chargerPhases: 1,
      energyAddedKwh: 5.2,
      minutesToFull: 120,
      chargePortOpen: true,
      vehicleName: "Model 3",
      lastUpdated: "2026-01-01T00:00:00.000Z",
      latitude: null,
      longitude: null,
      isHome: null,
    },
  } satisfies VehicleWithState;

  const baseVehicleAllocation: VehicleAllocation = {
    id: "v1",
    name: "Model 3",
    action: "charging",
    allocatedAmps: 10,
    allocatedKw: 2.3,
    solarKw: 2.3,
    gridKw: 0,
    reason: "",
  };

  const baseResult: SimulationResult = {
    vehicles: [baseVehicleAllocation],
    availableSolarKw: 3.5,
    totalChargingKw: 2.3,
    gridImportKw: 0,
    gridExportKw: 1.2,
    meetsMinSolarGeneration: true,
    meetsMinExcessSolar: true,
    batteryPriorityBlocking: false,
    blockoutActive: false,
  };

  const mockSolarResult = (overrides: Partial<SimulationResult> = {}) =>
    vi.mocked(simulateSolarAllocation).mockReturnValueOnce({
      ...baseResult,
      ...overrides,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(simulateSolarAllocation).mockReturnValue(baseResult);
  });
  afterEach(cleanup);

  const defaultProps = {
    config: { solar_tracking_enabled: "true" },
    vehicles: [mockVehicle],
    currentEnergy: {
      solarProductionW: 5000,
      gridPowerW: -1200,
      homeConsumptionW: 1500,
      batteryPowerW: null,
      batterySoc: null,
      gridVoltageV: null,
      lastUpdated: "2026-01-01T00:00:00.000Z",
    },
    schedules: [],
  };

  it("renders simulation heading", () => {
    renderWithProviders(<SolarSimulation {...defaultProps} />);

    expect(screen.getByText("Solar Charging Simulation")).toBeInTheDocument();
    expect(screen.getByText("Reset")).toBeInTheDocument();
  });

  it("renders vehicle controls", () => {
    renderWithProviders(<SolarSimulation {...defaultProps} />);

    expect(screen.getByText("Vehicles")).toBeInTheDocument();
    expect(screen.getByText("Model 3")).toBeInTheDocument();
  });

  // ---- no vehicles ----

  it("shows no vehicles message when vehicles array is empty", () => {
    renderWithProviders(
      <SolarSimulation {...defaultProps} vehicles={[]} />,
    );

    expect(
      screen.getByText(
        /No vehicles with charge state available/,
      ),
    ).toBeInTheDocument();
  });

  // ---- null currentEnergy ----

  it("renders with null currentEnergy using defaults", () => {
    renderWithProviders(
      <SolarSimulation
        {...defaultProps}
        currentEnergy={null}
      />,
    );

    expect(screen.getByText("Solar Charging Simulation")).toBeInTheDocument();
  });

  // ---- day buttons ----

  it.each(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])(
    "renders %s day button",
    (day) => {
      renderWithProviders(<SolarSimulation {...defaultProps} />);

      expect(screen.getByText(day)).toBeInTheDocument();
    },
  );

  // ---- summary bar ----

  it.each([
    "Solar:",
    "Home:",
    "Excess:",
    "EVs:",
    "Grid Import:",
    "Grid Export:",
  ])("renders summary bar label %s", (label) => {
    renderWithProviders(<SolarSimulation {...defaultProps} />);

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  // ---- result badges ----

  it.each<[Partial<SimulationResult>, string]>([
    [{ meetsMinSolarGeneration: false }, "Below min solar"],
    [{ meetsMinExcessSolar: false }, "Below min excess"],
    [{ batteryPriorityBlocking: true }, "Battery priority"],
    [{ blockoutActive: true }, "Blockout active"],
  ])("shows %o result badge", (flags, badge) => {
    mockSolarResult({ vehicles: [], ...flags });

    renderWithProviders(
      <SolarSimulation {...defaultProps} vehicles={[]} />,
    );

    expect(screen.getByText(badge)).toBeInTheDocument();
  });

  // ---- vehicle allocation display ----

  it.each<[Partial<VehicleAllocation>, string]>([
    [{ action: "charging" }, "Charging"],
    [
      {
        action: "skipped",
        allocatedAmps: 0,
        allocatedKw: 0,
        solarKw: 0,
        gridKw: 0,
        reason: "Battery at limit",
      },
      "Skipped",
    ],
    [
      {
        action: "charging",
        allocatedAmps: 16,
        allocatedKw: 3.7,
        solarKw: 2.0,
        gridKw: 1.7,
        scheduleName: "Night Charge",
      },
      "Scheduled",
    ],
  ])("renders %o action badge", (vehicleOverrides, badge) => {
    mockSolarResult({
      vehicles: [{ ...baseVehicleAllocation, ...vehicleOverrides }],
    });

    renderWithProviders(<SolarSimulation {...defaultProps} />);

    expect(screen.getByText(badge)).toBeInTheDocument();
  });

  it("renders skipped reason text alongside Skipped badge", () => {
    mockSolarResult({
      vehicles: [{
        ...baseVehicleAllocation,
        action: "skipped",
        allocatedAmps: 0,
        allocatedKw: 0,
        solarKw: 0,
        gridKw: 0,
        reason: "Battery at limit",
      }],
    });

    renderWithProviders(<SolarSimulation {...defaultProps} />);

    expect(screen.getByText("Battery at limit")).toBeInTheDocument();
  });

  it("shows grid kW in allocation when gridKw > 0", () => {
    mockSolarResult({
      vehicles: [{
        ...baseVehicleAllocation,
        allocatedAmps: 16,
        allocatedKw: 3.7,
        solarKw: 2.0,
        gridKw: 1.7,
      }],
    });

    renderWithProviders(<SolarSimulation {...defaultProps} />);

    expect(screen.getByText(/\+ 1\.7 kW grid/)).toBeInTheDocument();
  });

  // ---- battery SOC slider ----

  it("renders Battery SOC slider when batterySoc is not null", () => {
    renderWithProviders(
      <SolarSimulation
        {...defaultProps}
        currentEnergy={{
          solarProductionW: 5000,
          gridPowerW: -1200,
          homeConsumptionW: 1500,
          batteryPowerW: 500,
          batterySoc: 75,
          gridVoltageV: null,
          lastUpdated: "2026-01-01T00:00:00.000Z",
        }}
      />,
    );

    expect(screen.getByText("Battery SOC")).toBeInTheDocument();
  });

  // ---- SliderRow labels ----

  it.each(["Solar Production", "Home Consumption", "Time", "Day"])(
    "renders %s label",
    (label) => {
      renderWithProviders(<SolarSimulation {...defaultProps} />);

      expect(screen.getByText(label)).toBeInTheDocument();
    },
  );
});
