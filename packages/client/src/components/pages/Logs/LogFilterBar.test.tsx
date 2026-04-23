import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { LogFilterBar } from "./LogFilterBar.tsx";
import type { VehicleWithState } from "@chargeha/shared";
import type { ActionType, TimeRangePreset } from "./Logs.tsx";

describe("LogFilterBar", () => {
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
    vehicleFilter: "all",
    onVehicleFilterChange: vi.fn(),
    vehicles: [makeVehicle()],
    timeRange: "all" as TimeRangePreset,
    onTimeRangeChange: vi.fn(),
    customFrom: "",
    onCustomFromChange: vi.fn(),
    customTo: "",
    onCustomToChange: vi.fn(),
    selectedActions: ["start", "stop", "adjust_amps", "none"] as ActionType[],
    onToggleAction: vi.fn(),
    changesOnly: false,
    onToggleChangesOnly: vi.fn(),
    activeFilterCount: 0,
    onClearAllFilters: vi.fn(),
    autoRefresh: true,
    onAutoRefreshChange: vi.fn(),
    onRefresh: vi.fn(),
  };

  it("renders all filter controls", () => {
    renderWithProviders(<LogFilterBar {...defaultProps} />);
    expect(screen.getByText("All vehicles")).toBeTruthy();
    expect(screen.getByTestId("time-range-trigger")).toBeTruthy();
    expect(screen.getByTestId("changes-only")).toBeTruthy();
    expect(screen.getByText("Changes only")).toBeTruthy();
    expect(screen.getByText("Auto-refresh")).toBeTruthy();
    expect(screen.getByTestId("refresh-button")).toBeTruthy();
  });

  it.each([
    ["start", "Start"],
    ["stop", "Stop"],
    ["adjust_amps", "Adjust"],
    ["none", "None"],
  ])(
    "renders action checkbox + label for %s",
    (action, label) => {
      renderWithProviders(<LogFilterBar {...defaultProps} />);
      expect(screen.getByTestId(`action-${action}`)).toBeTruthy();
      expect(screen.getByText(label)).toBeTruthy();
    },
  );

  it("does not show filter badge when activeFilterCount is 0", () => {
    renderWithProviders(
      <LogFilterBar {...defaultProps} activeFilterCount={0} />,
    );
    expect(screen.queryByTestId("filter-count-badge")).toBeNull();
    expect(screen.queryByTestId("clear-filters")).toBeNull();
  });

  it("shows filter badge and clear button when activeFilterCount > 0", () => {
    renderWithProviders(
      <LogFilterBar {...defaultProps} activeFilterCount={3} />,
    );
    expect(screen.getByTestId("filter-count-badge")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByTestId("clear-filters")).toBeTruthy();
  });

  it("calls onClearAllFilters when Clear filters clicked", () => {
    const onClearAllFilters = vi.fn();
    renderWithProviders(
      <LogFilterBar
        {...defaultProps}
        activeFilterCount={2}
        onClearAllFilters={onClearAllFilters}
      />,
    );
    fireEvent.click(screen.getByTestId("clear-filters"));
    expect(onClearAllFilters).toHaveBeenCalledOnce();
  });

  it("calls onRefresh when refresh button clicked", () => {
    const onRefresh = vi.fn();
    renderWithProviders(
      <LogFilterBar {...defaultProps} onRefresh={onRefresh} />,
    );
    fireEvent.click(screen.getByTestId("refresh-button"));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("does not show custom date inputs when timeRange is not custom", () => {
    renderWithProviders(
      <LogFilterBar {...defaultProps} timeRange="all" />,
    );
    expect(screen.queryByTestId("custom-from")).toBeNull();
    expect(screen.queryByTestId("custom-to")).toBeNull();
  });

  it("shows custom date inputs when timeRange is custom", () => {
    renderWithProviders(
      <LogFilterBar {...defaultProps} timeRange="custom" />,
    );
    expect(screen.getByTestId("custom-from")).toBeTruthy();
    expect(screen.getByTestId("custom-to")).toBeTruthy();
  });

  it("renders From and To labels for custom range", () => {
    renderWithProviders(
      <LogFilterBar {...defaultProps} timeRange="custom" />,
    );
    expect(screen.getByText("From")).toBeTruthy();
    expect(screen.getByText("To")).toBeTruthy();
  });

  it("calls onToggleChangesOnly when changes only checkbox clicked", () => {
    const onToggleChangesOnly = vi.fn();
    renderWithProviders(
      <LogFilterBar
        {...defaultProps}
        onToggleChangesOnly={onToggleChangesOnly}
      />,
    );
    fireEvent.click(screen.getByTestId("changes-only"));
    expect(onToggleChangesOnly).toHaveBeenCalledOnce();
  });

  it("calls onToggleAction when action checkbox clicked", () => {
    const onToggleAction = vi.fn();
    renderWithProviders(
      <LogFilterBar {...defaultProps} onToggleAction={onToggleAction} />,
    );
    fireEvent.click(screen.getByTestId("action-start"));
    expect(onToggleAction).toHaveBeenCalledWith("start");
  });

  it("displays stored ISO customFrom as local datetime-local value", () => {
    // Pick a fixed local wall-clock and compute the corresponding ISO string so
    // the expectation is timezone-agnostic (CI may run in UTC).
    const localInput = "2026-04-17T09:30";
    const iso = new Date(localInput).toISOString();
    renderWithProviders(
      <LogFilterBar
        {...defaultProps}
        timeRange="custom"
        customFrom={iso}
      />,
    );
    const input = screen.getByTestId("custom-from") as HTMLInputElement;
    expect(input.value).toBe(localInput);
  });

  it("converts datetime-local input to ISO on change", () => {
    const onCustomFromChange = vi.fn();
    renderWithProviders(
      <LogFilterBar
        {...defaultProps}
        timeRange="custom"
        onCustomFromChange={onCustomFromChange}
      />,
    );
    const input = screen.getByTestId("custom-from") as HTMLInputElement;
    const localInput = "2026-04-17T09:30";
    fireEvent.change(input, { target: { value: localInput } });
    expect(onCustomFromChange).toHaveBeenCalledWith(
      new Date(localInput).toISOString(),
    );
  });

  it("round-trips ISO customFrom without dropping the value", () => {
    // Regression test: previously value was set to the raw ISO string which
    // datetime-local inputs reject, so after a change the displayed value
    // would appear empty on the next render.
    const localInput = "2026-04-17T09:30";
    const onCustomFromChange = vi.fn();
    const { rerender } = renderWithProviders(
      <LogFilterBar
        {...defaultProps}
        timeRange="custom"
        customFrom=""
        onCustomFromChange={onCustomFromChange}
      />,
    );
    const input = screen.getByTestId("custom-from") as HTMLInputElement;
    fireEvent.change(input, { target: { value: localInput } });
    const iso = onCustomFromChange.mock.calls[0][0];
    rerender(
      <LogFilterBar
        {...defaultProps}
        timeRange="custom"
        customFrom={iso}
        onCustomFromChange={onCustomFromChange}
      />,
    );
    const inputAfter = screen.getByTestId("custom-from") as HTMLInputElement;
    expect(inputAfter.value).toBe(localInput);
  });
});
