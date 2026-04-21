import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { SimpleFilterBar } from "./SimpleFilterBar.tsx";
import type { VehicleWithState } from "@chargeha/shared";
import type { TimeRangePreset } from "./Logs.tsx";

describe("SimpleFilterBar", () => {
  const makeVehicle = (
    overrides: Partial<VehicleWithState> = {},
  ): VehicleWithState => {
    return {
      id: "v1",
      name: "Model 3",
      adapterType: "tesla",
      priority: 0,
      config: "{}",
      mode: "auto",
      state: null,
      ...overrides,
    };
  };

  const defaultProps = {
    timeRange: "all" as TimeRangePreset,
    onTimeRangeChange: vi.fn(),
    customFrom: "",
    onCustomFromChange: vi.fn(),
    customTo: "",
    onCustomToChange: vi.fn(),
    activeFilterCount: 0,
    onClearAllFilters: vi.fn(),
    autoRefresh: true,
    onAutoRefreshChange: vi.fn(),
    onRefresh: vi.fn(),
  };

  it("renders time range trigger and auto-refresh controls", () => {
    renderWithProviders(<SimpleFilterBar {...defaultProps} />);
    expect(screen.getByText("All time")).toBeTruthy();
    expect(screen.getByText("Auto-refresh")).toBeTruthy();
  });

  it("does not render vehicle filter when its props are absent", () => {
    renderWithProviders(<SimpleFilterBar {...defaultProps} />);
    expect(screen.queryByText("All vehicles")).toBeNull();
  });

  it("renders vehicle filter when its props are provided", () => {
    renderWithProviders(
      <SimpleFilterBar
        {...defaultProps}
        vehicles={[makeVehicle()]}
        vehicleFilter="all"
        onVehicleFilterChange={vi.fn()}
      />,
    );
    expect(screen.getByText("All vehicles")).toBeTruthy();
  });

  it("does not render level filter when its props are absent", () => {
    renderWithProviders(<SimpleFilterBar {...defaultProps} />);
    expect(screen.queryByText("info")).toBeNull();
  });

  it("renders level filter when its props are provided", () => {
    renderWithProviders(
      <SimpleFilterBar
        {...defaultProps}
        allLevels={["info", "warn", "error", "debug"]}
        levelFilter={["info", "warn", "error", "debug"]}
        onLevelFilterChange={vi.fn()}
      />,
    );
    expect(screen.getByText("info")).toBeTruthy();
  });

  it("renders all level filter labels when allLevels provided", () => {
    renderWithProviders(
      <SimpleFilterBar
        {...defaultProps}
        allLevels={["info", "warn", "error", "debug"]}
        levelFilter={["info", "warn", "error", "debug"]}
        onLevelFilterChange={vi.fn()}
      />,
    );
    ["info", "warn", "error", "debug"].forEach((level) => {
      expect(screen.getByText(level)).toBeTruthy();
    });
  });

  it("does not show filter badge when activeFilterCount is 0", () => {
    renderWithProviders(
      <SimpleFilterBar {...defaultProps} activeFilterCount={0} />,
    );
    expect(screen.queryByText("Clear filters")).toBeNull();
  });

  it("shows filter badge and clear button when activeFilterCount > 0", () => {
    renderWithProviders(
      <SimpleFilterBar {...defaultProps} activeFilterCount={2} />,
    );
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("Clear filters")).toBeTruthy();
  });

  it("calls onClearAllFilters when Clear filters clicked", () => {
    const onClearAllFilters = vi.fn();
    renderWithProviders(
      <SimpleFilterBar
        {...defaultProps}
        activeFilterCount={1}
        onClearAllFilters={onClearAllFilters}
      />,
    );
    fireEvent.click(screen.getByText("Clear filters"));
    expect(onClearAllFilters).toHaveBeenCalledOnce();
  });

  it("does not show custom date inputs when timeRange is not custom", () => {
    renderWithProviders(
      <SimpleFilterBar {...defaultProps} timeRange="all" />,
    );
    expect(screen.queryByText("From")).toBeNull();
    expect(screen.queryByText("To")).toBeNull();
  });

  it("shows custom date inputs when timeRange is custom", () => {
    renderWithProviders(
      <SimpleFilterBar {...defaultProps} timeRange="custom" />,
    );
    expect(screen.getByText("From")).toBeTruthy();
    expect(screen.getByText("To")).toBeTruthy();
  });

  it.each([
    [["info"], ["info", "warn"]],
    [["info", "warn"], ["info"]],
  ])(
    "toggling 'warn' transforms %j → %j",
    (initial, expected) => {
      const onLevelFilterChange = vi.fn();
      renderWithProviders(
        <SimpleFilterBar
          {...defaultProps}
          allLevels={["info", "warn"]}
          levelFilter={initial}
          onLevelFilterChange={onLevelFilterChange}
        />,
      );
      fireEvent.click(screen.getByTestId("level-checkbox-warn"));
      expect(onLevelFilterChange).toHaveBeenCalledWith(expected);
    },
  );
});
