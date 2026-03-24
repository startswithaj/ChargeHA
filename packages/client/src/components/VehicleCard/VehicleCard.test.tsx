import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { renderWithProviders } from "../../test-utils.tsx";
import type { VehicleChargeState } from "@chargeha/shared";
import { VehicleCard } from "./VehicleCard.tsx";

vi.mock("../StaticMap/StaticMap.tsx", () => ({
  StaticMap: () => <div data-testid="static-map" />,
}));

describe("VehicleCard", () => {
  beforeEach(vi.clearAllMocks);
  afterEach(cleanup);

  const makeVehicleState = (
    overrides: Partial<VehicleChargeState> = {},
  ): VehicleChargeState => {
    return {
      vehicleId: "vin-123",
      batteryLevel: 72,
      chargeLimit: 80,
      isCharging: false,
      isPluggedIn: true,
      isOnline: true,
      chargeAmps: 16,
      chargeAmpsMax: 32,
      chargeAmpsMin: 5,
      chargePowerKw: 0,
      chargerVoltage: 240,
      chargerPhases: 1,
      energyAddedKwh: 0,
      minutesToFull: 0,
      chargePortOpen: false,
      vehicleName: "Model 3",
      lastUpdated: new Date().toISOString(),
      latitude: null,
      longitude: null,
      isHome: null,
      ...overrides,
    };
  };

  type VCProps = ComponentProps<typeof VehicleCard>;
  const renderVC = (overrides: Partial<VCProps> = {}) => {
    const props: VCProps = {
      name: "Model 3",
      state: makeVehicleState(),
      priority: 1,
      mode: "auto" as const,
      commandPending: false as const,
      onStartCharging: vi.fn(),
      onStopCharging: vi.fn(),
      onSetAmps: vi.fn(),
      onChangeMode: vi.fn(),
      ...overrides,
    };
    return { props, ...renderWithProviders(<VehicleCard {...props} />) };
  };

  it("renders the default plugged-in card", () => {
    renderVC();

    expect(screen.getByText("Model 3")).toBeInTheDocument();
    expect(screen.getByText("72%")).toBeInTheDocument();
    expect(screen.getByText("Limit: 80%")).toBeInTheDocument();
    expect(screen.getByText("Auto - Plugged In")).toBeInTheDocument();
    expect(screen.getByText("STOP")).toBeInTheDocument();
    expect(screen.getByText("AUTO")).toBeInTheDocument();
    expect(screen.getByText("CHARGE NOW")).toBeInTheDocument();
    expect(screen.getByText("Start Charging")).toBeInTheDocument();
    expect(screen.getByText("Online")).toBeInTheDocument();
    expect(screen.getByText("Priority 1")).toBeInTheDocument();
    expect(screen.getByText("16A")).toBeInTheDocument();
  });

  it.each<[string, Partial<VehicleChargeState>, string]>([
    [
      "charging",
      { isCharging: true, chargePowerKw: 7.4 },
      "Auto - Charging at 7.4 kW",
    ],
    ["unplugged", { isPluggedIn: false }, "Auto - Unplugged"],
  ])("status text %s", (_label, state, expected) => {
    renderVC({ state: makeVehicleState(state) });
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("renders Stop Charging button when charging", () => {
    renderVC({
      state: makeVehicleState({ isCharging: true, chargePowerKw: 7.4 }),
    });
    expect(screen.getByText("Stop Charging")).toBeInTheDocument();
  });

  it("renders offline badge when vehicle is offline", () => {
    renderVC({ state: makeVehicleState({ isOnline: false }) });
    expect(screen.getByText("Offline")).toBeInTheDocument();
  });

  // --- loading prop ---

  it("renders Skeleton (no name) when loading is true", () => {
    renderVC({ loading: true });
    expect(screen.queryByText("Model 3")).not.toBeInTheDocument();
  });

  it("renders vehicle content when loading is false", () => {
    renderVC({ loading: false });
    expect(screen.getByText("Model 3")).toBeInTheDocument();
  });

  // --- commandsDisabled banner ---

  it("renders banner with default reason and no Fix button when commandsDisabled and onNavigateSettings omitted", () => {
    renderVC({ commandsDisabled: true });

    expect(screen.getByText("Charging control unavailable"))
      .toBeInTheDocument();
    expect(screen.getByText(/Commands are currently unavailable/))
      .toBeInTheDocument();
    expect(screen.queryByText("Fix in Settings")).not.toBeInTheDocument();
  });

  it("renders banner with custom reason and Fix button that fires onNavigateSettings", () => {
    const onNavigateSettings = vi.fn();
    renderVC({
      commandsDisabled: true,
      commandsDisabledReason: "Tesla API token is expired.",
      onNavigateSettings,
    });

    expect(screen.getByText(/Tesla API token is expired\./))
      .toBeInTheDocument();
    fireEvent.click(screen.getByText("Fix in Settings"));
    expect(onNavigateSettings).toHaveBeenCalledTimes(1);
  });

  it("hides banner when commandsDisabled is false", () => {
    renderVC({ commandsDisabled: false });
    expect(screen.queryByText("Charging control unavailable"))
      .not.toBeInTheDocument();
  });

  // --- vehicleError banner ---

  it("shows vehicle error banner when vehicleError is provided", () => {
    renderVC({ vehicleError: "Tesla API rate limited" });

    expect(screen.getByText("Vehicle API error")).toBeInTheDocument();
    expect(screen.getByText("Tesla API rate limited")).toBeInTheDocument();
  });

  it.each<[string, null | undefined]>([
    ["null", null],
    ["undefined", undefined],
  ])("hides vehicle error banner when vehicleError is %s", (_label, value) => {
    renderVC({ vehicleError: value });
    expect(screen.queryByText("Vehicle API error")).not.toBeInTheDocument();
  });

  // --- charging details: solar/grid, energy added, minutesToFull ---

  const renderCharging = (extra: Partial<VCProps> = {}) => {
    return renderVC({
      state: makeVehicleState({
        isCharging: true,
        chargePowerKw: 3.0,
        energyAddedKwh: 1.5,
      }),
      ...extra,
    });
  };

  it.each<[string, number, number, RegExp]>([
    ["kW formatting", 3500, 1200, /3\.5 kW solar, 1\.2 kW grid/],
    ["W formatting", 500, 0, /500 W solar, 0 W grid/],
  ])("solar/grid row %s", (_label, solarPowerW, gridPowerW, expected) => {
    renderCharging({ solarPowerW, gridPowerW });
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("hides solar/grid row when both are zero", () => {
    renderCharging({ solarPowerW: 0, gridPowerW: 0 });
    expect(screen.queryByText(/solar,/)).not.toBeInTheDocument();
  });

  it("shows energy added in kWh when charging", () => {
    renderVC({
      state: makeVehicleState({
        isCharging: true,
        chargePowerKw: 7.4,
        energyAddedKwh: 5.7,
      }),
    });
    expect(screen.getByText("5.7 kWh added")).toBeInTheDocument();
  });

  it.each<[number, RegExp]>([
    [45, /45m to 80%/],
    [90, /1h 30m to/],
    [120, /2h to/],
  ])("minutesToFull=%s formats correctly", (minutesToFull, expected) => {
    renderVC({
      state: makeVehicleState({
        isCharging: true,
        chargePowerKw: 7.4,
        energyAddedKwh: 1.0,
        minutesToFull,
        chargeLimit: 80,
      }),
    });
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("hides minutes-to-full row when minutesToFull is 0", () => {
    renderVC({
      state: makeVehicleState({
        isCharging: true,
        chargePowerKw: 7.4,
        energyAddedKwh: 1.0,
        minutesToFull: 0,
      }),
    });
    expect(screen.queryByText(/to 80%/)).not.toBeInTheDocument();
  });

  it("does not show charging details when not charging", () => {
    renderVC({
      state: makeVehicleState({
        isCharging: false,
        isPluggedIn: true,
        energyAddedKwh: 5.0,
        minutesToFull: 60,
      }),
      solarPowerW: 2000,
      gridPowerW: 500,
    });

    expect(screen.queryByText(/kWh added/)).not.toBeInTheDocument();
    expect(screen.queryByText(/solar,/)).not.toBeInTheDocument();
  });

  // --- commandPending spinner states ---

  it.each<[VCProps["commandPending"], boolean, string, string]>([
    ["stop", true, "Stopping...", "Stop Charging"],
    ["start", false, "Starting...", "Start Charging"],
  ])(
    "commandPending=%s shows %s",
    (commandPending, isCharging, expectedText, hiddenText) => {
      renderVC({
        state: makeVehicleState({
          isCharging,
          chargePowerKw: isCharging ? 7.4 : 0,
        }),
        commandPending,
      });

      expect(screen.getByText(expectedText)).toBeInTheDocument();
      expect(screen.queryByText(hiddenText)).not.toBeInTheDocument();
    },
  );

  it("shows spinner in amps buttons when commandPending is amps", () => {
    renderVC({
      state: makeVehicleState({
        isCharging: true,
        chargePowerKw: 7.4,
      }),
      commandPending: "amps",
    });

    expect(screen.queryByText("−")).not.toBeInTheDocument();
    expect(screen.queryByText("+")).not.toBeInTheDocument();
  });

  it("renders − and + buttons and fires onSetAmps with ±1 when clicked", () => {
    const onSetAmps = vi.fn();
    renderVC({
      state: makeVehicleState({ isCharging: true, chargePowerKw: 7.4 }),
      onSetAmps,
      commandPending: false,
    });

    fireEvent.click(screen.getByText("−"));
    fireEvent.click(screen.getByText("+"));
    expect(onSetAmps).toHaveBeenNthCalledWith(1, 15);
    expect(onSetAmps).toHaveBeenNthCalledWith(2, 17);
  });

  it.each<[string, Partial<VehicleChargeState>]>([
    ["min", { isCharging: true, chargePowerKw: 3.0, chargeAmps: 5 }],
    ["not charging", { isCharging: false, isPluggedIn: true }],
  ])("disables − button when %s", (_label, stateOverrides) => {
    renderVC({
      state: makeVehicleState(stateOverrides),
      commandPending: false,
    });
    expect(screen.getByText("−").closest("button")).toBeDisabled();
  });

  it.each<[string, Partial<VehicleChargeState>]>([
    ["max", { isCharging: true, chargePowerKw: 7.4, chargeAmps: 32 }],
    ["not charging", { isCharging: false, isPluggedIn: true }],
  ])("disables + button when %s", (_label, stateOverrides) => {
    renderVC({
      state: makeVehicleState(stateOverrides),
      commandPending: false,
    });
    expect(screen.getByText("+").closest("button")).toBeDisabled();
  });

  // --- lastLocation / StaticMap ---

  it("renders StaticMap when lastLocation is provided", () => {
    renderVC({ lastLocation: { latitude: 37.7749, longitude: -122.4194 } });
    expect(screen.getByTestId("static-map")).toBeInTheDocument();
  });

  it("does not render StaticMap when lastLocation is null", () => {
    renderVC({ lastLocation: null });
    expect(screen.queryByTestId("static-map")).not.toBeInTheDocument();
  });

  // --- mode + start/stop button callbacks ---

  it.each<[string, "stop" | "auto" | "charge_now"]>([
    ["STOP", "stop"],
    ["AUTO", "auto"],
    ["CHARGE NOW", "charge_now"],
  ])("clicking %s mode button calls onChangeMode with %s", (label, mode) => {
    const onChangeMode = vi.fn();
    renderVC({ onChangeMode });

    fireEvent.click(screen.getByText(label));
    expect(onChangeMode).toHaveBeenCalledWith(mode);
  });

  it("calls onStartCharging when Start Charging button is clicked", () => {
    const onStartCharging = vi.fn();
    renderVC({ onStartCharging });

    fireEvent.click(screen.getByText("Start Charging"));
    expect(onStartCharging).toHaveBeenCalledTimes(1);
  });

  it("calls onStopCharging when Stop Charging button is clicked", () => {
    const onStopCharging = vi.fn();
    renderVC({
      state: makeVehicleState({ isCharging: true, chargePowerKw: 7.4 }),
      onStopCharging,
      commandPending: false,
    });

    fireEvent.click(screen.getByText("Stop Charging"));
    expect(onStopCharging).toHaveBeenCalledTimes(1);
  });

  // --- commandPending mode spinners ---

  it.each<[VCProps["commandPending"], string]>([
    ["mode:stop", "STOP"],
    ["mode:auto", "AUTO"],
    ["mode:charge_now", "CHARGE NOW"],
  ])(
    "commandPending=%s disables %s mode button",
    (commandPending, label) => {
      renderVC({ commandPending });

      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getByText(label).closest("button")).toBeDisabled();
    },
  );

  // --- amps display ---

  it("shows amps / max amps label when charging", () => {
    renderVC({
      state: makeVehicleState({
        isCharging: true,
        chargeAmps: 20,
        chargeAmpsMax: 48,
      }),
    });
    expect(screen.getByText("20A / 48A max")).toBeInTheDocument();
  });

  it("shows Not Charging when not charging", () => {
    renderVC({ state: makeVehicleState({ isCharging: false }) });
    expect(screen.getByText("Not Charging")).toBeInTheDocument();
  });
});
