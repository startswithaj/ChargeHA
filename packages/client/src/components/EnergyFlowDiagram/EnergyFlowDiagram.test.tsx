import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithProviders } from "../../test-utils.tsx";
import type { EnergyData } from "@chargeha/shared";
import type { ChargingVehicleFlow } from "./EnergyFlowDiagram.tsx";
import { EnergyFlowDiagram } from "./EnergyFlowDiagram.tsx";

describe("EnergyFlowDiagram", () => {
  afterEach(cleanup);

  const makeEnergyData = (overrides: Partial<EnergyData> = {}): EnergyData => {
    return {
      solarProductionW: 3500,
      gridPowerW: 200,
      homeConsumptionW: 3700,
      batteryPowerW: null,
      batterySoc: null,
      gridVoltageV: null,
      lastUpdated: "2026-01-01T00:00:00.000Z",
      ...overrides,
    };
  };

  // ---- rendering ----

  describe("rendering", () => {
    it("renders Solar, Home, and Grid labels", () => {
      renderWithProviders(<EnergyFlowDiagram data={makeEnergyData()} />);

      expect(screen.getByText("Solar")).toBeInTheDocument();
      expect(screen.getByText("Home")).toBeInTheDocument();
      expect(screen.getByText("Grid")).toBeInTheDocument();
    });
  });

  // ---- loading state ----

  describe("loading state", () => {
    it('shows "---" placeholders when loading (incl. battery when present)', () => {
      renderWithProviders(
        <EnergyFlowDiagram
          data={makeEnergyData({ batteryPowerW: 1500, batterySoc: 72 })}
          loading
        />,
      );

      expect(screen.getByText("Battery")).toBeInTheDocument();
      const dashes = screen.getAllByText("---");
      // Solar, Home, Grid, Battery should all show "---"
      expect(dashes.length).toBeGreaterThanOrEqual(4);
    });
  });

  // ---- formatted values ----

  describe("formatted values", () => {
    it("shows formatted watt values when data is present", () => {
      renderWithProviders(
        <EnergyFlowDiagram
          data={makeEnergyData({
            solarProductionW: 5234,
            homeConsumptionW: 3700,
            gridPowerW: 200,
          })}
        />,
      );

      expect(screen.getByText("5.2 kW")).toBeInTheDocument();
      expect(screen.getByText("3.7 kW")).toBeInTheDocument();
      // Grid shows an "Import" pill with the value below
      expect(screen.getByText("Import")).toBeInTheDocument();
      expect(screen.getByText("200 W")).toBeInTheDocument();
    });
  });

  // ---- battery node ----

  describe("battery node", () => {
    it("shows battery node when batteryPowerW is not null", () => {
      renderWithProviders(
        <EnergyFlowDiagram
          data={makeEnergyData({
            batteryPowerW: 1500,
            batterySoc: 72,
          })}
        />,
      );

      expect(screen.getByText("Battery")).toBeInTheDocument();
      expect(screen.getByText(/1\.5 kW/)).toBeInTheDocument();
      expect(screen.getByText(/72%/)).toBeInTheDocument();
    });

    it("shows battery power without SOC when batterySoc is null", () => {
      renderWithProviders(
        <EnergyFlowDiagram
          data={makeEnergyData({ batteryPowerW: 2000, batterySoc: null })}
        />,
      );

      expect(screen.getByText("Battery")).toBeInTheDocument();
      expect(screen.getByText("2.0 kW")).toBeInTheDocument();
    });

    it("hides battery node when batteryPowerW is null", () => {
      renderWithProviders(
        <EnergyFlowDiagram
          data={makeEnergyData({ batteryPowerW: null })}
        />,
      );

      expect(screen.queryByText("Battery")).not.toBeInTheDocument();
    });
  });

  // ---- grid direction ----

  describe("grid direction", () => {
    it.each<[string, number, string]>([
      ["Export", -1500, "1.5 kW"],
      ["Import", 2000, "2.0 kW"],
    ])("shows %s when gridPowerW is %d", (label, gridPowerW, expected) => {
      renderWithProviders(
        <EnergyFlowDiagram data={makeEnergyData({ gridPowerW })} />,
      );

      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getByText(expected)).toBeInTheDocument();
    });
  });

  // ---- charging vehicles ----

  describe("charging vehicles", () => {
    const mockVehicle: ChargingVehicleFlow = {
      id: "vehicle-1",
      name: "Model 3",
      chargePowerW: 7400,
      solarW: 5000,
      gridW: 2400,
    };

    it("renders a vehicle node when charging", () => {
      renderWithProviders(
        <EnergyFlowDiagram
          data={makeEnergyData()}
          chargingVehicles={[mockVehicle]}
        />,
      );

      expect(screen.getByText("Model 3")).toBeInTheDocument();
      expect(screen.getByText("7.4 kW")).toBeInTheDocument();
      expect(screen.getByText(/5\.0 kW solar/)).toBeInTheDocument();
      expect(screen.getByText(/2\.4 kW grid/)).toBeInTheDocument();
      expect(screen.getByTestId("vehicle-node-vehicle-1")).toBeInTheDocument();
    });

    it("renders no vehicle nodes when array is empty", () => {
      renderWithProviders(
        <EnergyFlowDiagram
          data={makeEnergyData()}
          chargingVehicles={[]}
        />,
      );

      expect(screen.queryByTestId(/vehicle-node-/)).not.toBeInTheDocument();
    });

    it("renders multiple vehicles stacked vertically", () => {
      const vehicles: ChargingVehicleFlow[] = [
        mockVehicle,
        {
          id: "vehicle-2",
          name: "Model Y",
          chargePowerW: 11000,
          solarW: 3000,
          gridW: 8000,
        },
      ];

      renderWithProviders(
        <EnergyFlowDiagram
          data={makeEnergyData()}
          chargingVehicles={vehicles}
        />,
      );

      expect(screen.getByText("Model 3")).toBeInTheDocument();
      expect(screen.getByText("Model Y")).toBeInTheDocument();
      expect(screen.getByTestId("vehicle-node-vehicle-1")).toBeInTheDocument();
      expect(screen.getByTestId("vehicle-node-vehicle-2")).toBeInTheDocument();
    });
  });
});
