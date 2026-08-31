import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { LogEntryCard } from "./LogEntryCard.tsx";
import type { ControllerLogEntry } from "../../../hooks/useControllerLogs.ts";

describe("LogEntryCard", () => {
  // `ControllerLogEntry` carries strict enums and a fully-populated `config`,
  // so the loose test shape widens through `as never` at the render boundary.
  const makeEntry = (overrides: Record<string, unknown> = {}) => {
    return {
      id: 1,
      timestamp: "2026-03-01T12:00:00",
      vehicleId: "VIN1",
      vehicleName: "Test Car",
      mode: "auto",
      action: "start",
      actionDetail: "Started charging at 16A",
      targetAmps: 16,
      traceId: null,
      checks: [],
      inputs: {
        energy: null,
        vehicleState: null,
        config: {},
        activeSchedules: [],
      },
      ...overrides,
    };
  };

  const renderEntry = (overrides: Record<string, unknown> = {}) => {
    const entry = makeEntry(overrides) as never as ControllerLogEntry;
    renderWithProviders(
      <LogEntryCard entry={entry} timezone="Australia/Brisbane" />,
    );
    fireEvent.click(screen.getByText("Test Car"));
  };

  afterEach(() => {
    cleanup();
  });

  it("shows battery power discharging when batteryPowerW is positive", () => {
    renderEntry({
      inputs: {
        energy: {
          solarProductionW: 1000,
          gridPowerW: 0,
          homeConsumptionW: 500,
          batterySoc: 72,
          batteryPowerW: 250,
        },
        vehicleState: null,
        config: {},
        activeSchedules: [],
      },
    });

    expect(screen.getByText("Battery power")).toBeInTheDocument();
    expect(screen.getByText("250W discharging")).toBeInTheDocument();
  });

  it("shows battery power charging when batteryPowerW is negative", () => {
    renderEntry({
      inputs: {
        energy: {
          solarProductionW: 1000,
          gridPowerW: 0,
          homeConsumptionW: 500,
          batterySoc: 72,
          batteryPowerW: -300,
        },
        vehicleState: null,
        config: {},
        activeSchedules: [],
      },
    });

    expect(screen.getByText("Battery power")).toBeInTheDocument();
    expect(screen.getByText("300W charging")).toBeInTheDocument();
  });

  it("does not render battery power when it is null (no home battery)", () => {
    renderEntry({
      inputs: {
        energy: {
          solarProductionW: 1000,
          gridPowerW: 0,
          homeConsumptionW: 500,
          batterySoc: null,
          batteryPowerW: null,
        },
        vehicleState: null,
        config: {},
        activeSchedules: [],
      },
    });

    expect(screen.getByText("Energy")).toBeInTheDocument();
    expect(screen.queryByText("Battery power")).not.toBeInTheDocument();
  });

  it("does not render battery power when absent from an old log row", () => {
    // Log rows written before batteryPowerW was persisted have no such key
    // at all — must render the same as an explicit null, not crash.
    renderEntry({
      inputs: {
        energy: {
          solarProductionW: 1000,
          gridPowerW: 0,
          homeConsumptionW: 500,
          batterySoc: null,
        },
        vehicleState: null,
        config: {},
        activeSchedules: [],
      },
    });

    expect(screen.getByText("Energy")).toBeInTheDocument();
    expect(screen.queryByText("Battery power")).not.toBeInTheDocument();
  });
});
