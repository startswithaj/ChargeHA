import "@testing-library/jest-dom/vitest";
import { assertExists } from "@std/assert";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { Logs } from "./Logs.tsx";
import { useControllerLogs } from "../../../hooks/useControllerLogs.ts";

vi.mock("../../../hooks/useControllerLogs.ts", () => ({
  useControllerLogs: vi.fn(() => ({
    logs: [],
    total: 0,
    loading: false,
    isFetching: false,
    error: null,
    page: 0,
    setPage: vi.fn(),
    pageSize: 50,
    autoRefresh: true,
    setAutoRefresh: vi.fn(),
    refresh: vi.fn(),
  })),
}));

vi.mock("../../../hooks/useEnergyReadings.ts", () => ({
  useEnergyReadings: vi.fn(() => ({
    readings: [],
    total: 0,
    loading: false,
    error: null,
    page: 0,
    setPage: vi.fn(),
    pageSize: 50,
    autoRefresh: true,
    setAutoRefresh: vi.fn(),
    refresh: vi.fn(),
  })),
}));

vi.mock("../../../hooks/useVehicleUpdates.ts", () => ({
  useVehicleUpdates: vi.fn(() => ({
    readings: [],
    total: 0,
    loading: false,
    error: null,
    page: 0,
    setPage: vi.fn(),
    pageSize: 50,
    autoRefresh: true,
    setAutoRefresh: vi.fn(),
    refresh: vi.fn(),
  })),
}));

vi.mock("../../../hooks/usePluginLogs.ts", () => ({
  usePluginLogs: vi.fn(() => ({
    logs: [],
    total: 0,
    loading: false,
    error: null,
    page: 0,
    setPage: vi.fn(),
    pageSize: 50,
    autoRefresh: true,
    setAutoRefresh: vi.fn(),
    refresh: vi.fn(),
  })),
}));

vi.mock("../../../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    vehicle: {
      list: {
        useQuery: vi.fn(() => ({
          data: { vehicles: [] },
          isLoading: false,
          error: null,
        })),
      },
    },
  },
}));

vi.mock("../../../hooks/useToast.tsx", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../hooks/useToast.tsx")>(),
  useToast: vi.fn(() => ({
    addToast: vi.fn(),
    removeToast: vi.fn(),
    toasts: [],
  })),
}));

describe("Logs", () => {
  // The wire shape `ControllerLogEntry` carries strict enums (`CheckName`,
  // `ControllerAction`) and a fully-populated `config`. Tests intentionally
  // exercise unknown actions / partial configs / arbitrary check names, so the
  // factory returns the loose test shape and `setLogs` widens through `as never`
  // at the single mock-injection boundary.
  const makeLogEntry = (overrides: Record<string, unknown> = {}) => {
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

  /** Full log entry with all input sections populated. */
  const fullLogEntry = makeLogEntry({
    checks: [
      { check: "solar_available", result: "pass" },
      { check: "battery_ok", result: "pass" },
    ],
    inputs: {
      energy: {
        solarProductionW: 3500.6,
        gridPowerW: 100.2,
        homeConsumptionW: 800.9,
        batterySoc: 72,
      },
      vehicleState: {
        isPluggedIn: true,
        isCharging: true,
        batteryLevel: 45,
        chargeLimit: 80,
        chargeAmps: 16,
        chargeAmpsMin: 5,
        chargeAmpsMax: 32,
        chargePowerKw: 3.68,
      },
      config: {},
      activeSchedules: [
        {
          id: "sched-1",
          type: "charge",
          startTime: "08:00",
          endTime: "10:00",
        },
      ],
    },
  });

  const makeLogsReturn = (overrides: Record<string, unknown> = {}) => {
    return {
      logs: [],
      total: 0,
      loading: false,
      isFetching: false,
      error: null,
      page: 0,
      setPage: vi.fn(),
      pageSize: 50,
      autoRefresh: true,
      setAutoRefresh: vi.fn(),
      refresh: vi.fn(),
      ...overrides,
    };
  };

  /** Sets the next return value of the mocked useControllerLogs hook. */
  const setLogs = (overrides: Record<string, unknown> = {}): void => {
    vi.mocked(useControllerLogs).mockReturnValue(
      makeLogsReturn(overrides) as never,
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset URL search params between tests
    globalThis.history.replaceState(null, "", "/logs");
  });

  afterEach(() => {
    cleanup();
  });

  // ---- Basic rendering ----

  it("renders Logs heading", () => {
    renderWithProviders(<Logs />);

    expect(screen.getByText("Logs")).toBeInTheDocument();
  });

  it("renders auto-refresh toggle", () => {
    renderWithProviders(<Logs />);

    expect(screen.getByText("Auto-refresh")).toBeInTheDocument();
  });

  it("renders empty state when no logs", () => {
    renderWithProviders(<Logs />);

    expect(
      screen.getByText(/No controller log entries yet/),
    ).toBeInTheDocument();
  });

  // ---- Loading state ----

  it("renders loading state when loading and no logs", () => {
    setLogs({ loading: true });

    renderWithProviders(<Logs />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  // ---- Log entry rendering ----

  it("renders log entries when logs exist", () => {
    setLogs({ logs: [makeLogEntry()], total: 1 });

    renderWithProviders(<Logs />);

    expect(screen.getByText("Test Car")).toBeInTheDocument();
    expect(screen.getByText("start")).toBeInTheDocument();
    expect(screen.getByText("Started charging at 16A")).toBeInTheDocument();
  });

  it("displays targetAmps in the log header", () => {
    setLogs({
      logs: [
        makeLogEntry({
          id: 2,
          action: "adjust_amps",
          actionDetail: "Adjusted to 20A",
          targetAmps: 20,
        }),
      ],
      total: 1,
    });

    renderWithProviders(<Logs />);

    expect(screen.getByText("20A")).toBeInTheDocument();
  });

  it("renders actionColor variants — stop and adjust_amps actions", () => {
    setLogs({
      logs: [
        makeLogEntry({
          id: 3,
          vehicleName: "Car A",
          action: "stop",
          actionDetail: "Stopped charging",
          targetAmps: null,
        }),
        makeLogEntry({
          id: 4,
          timestamp: "2026-03-01T12:05:00",
          vehicleId: "VIN2",
          vehicleName: "Car B",
          action: "adjust_amps",
          actionDetail: "Reduced to 8A",
          targetAmps: 8,
        }),
        makeLogEntry({
          id: 5,
          timestamp: "2026-03-01T12:10:00",
          vehicleId: "VIN3",
          vehicleName: "Car C",
          action: "unknown_action",
          actionDetail: "Unknown event",
          targetAmps: null,
        }),
      ],
      total: 3,
    });

    renderWithProviders(<Logs />);

    expect(screen.getByText("stop")).toBeInTheDocument();
    expect(screen.getByText("adjust_amps")).toBeInTheDocument();
    expect(screen.getByText("unknown_action")).toBeInTheDocument();
  });

  // ---- Expanded log entry details ----

  it("expands the card and shows all populated input sections", () => {
    setLogs({ logs: [fullLogEntry], total: 1 });

    renderWithProviders(<Logs />);

    expect(screen.queryByText("Checks")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Test Car"));

    // Checks
    expect(screen.getByText("Checks")).toBeInTheDocument();
    expect(screen.getByText("solar_available:")).toBeInTheDocument();
    expect(screen.getAllByText("pass").length).toBeGreaterThan(0);
    expect(screen.getByText("battery_ok:")).toBeInTheDocument();

    // Energy
    expect(screen.getByText("Energy")).toBeInTheDocument();
    expect(screen.getByText("Solar")).toBeInTheDocument();
    expect(screen.getByText("3501W")).toBeInTheDocument();
    expect(screen.getByText("Grid")).toBeInTheDocument();
    expect(screen.getByText("100W")).toBeInTheDocument();
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("801W")).toBeInTheDocument();
    expect(screen.getAllByText("Battery").length).toBeGreaterThan(0);
    expect(screen.getAllByText("72%").length).toBeGreaterThan(0);

    // Vehicle State
    expect(screen.getByText("Vehicle State")).toBeInTheDocument();
    expect(screen.getByText("Plugged in")).toBeInTheDocument();
    expect(screen.getByText("Charging")).toBeInTheDocument();
    expect(screen.getByText("45% / 80%")).toBeInTheDocument();
    expect(screen.getByText("16A (5-32A)")).toBeInTheDocument();
    expect(screen.getByText("3.7 kW")).toBeInTheDocument();

    // Active Schedules
    expect(screen.getByText("Active Schedules")).toBeInTheDocument();
    expect(screen.getByText("charge: 08:00 - 10:00")).toBeInTheDocument();
  });

  it("does not show energy section when energy input is null", () => {
    setLogs({ logs: [makeLogEntry({ id: 99 })], total: 1 });

    renderWithProviders(<Logs />);

    fireEvent.click(screen.getByText("Test Car"));

    expect(screen.queryByText("Energy")).not.toBeInTheDocument();
    expect(screen.queryByText("Vehicle State")).not.toBeInTheDocument();
    expect(screen.queryByText("Active Schedules")).not.toBeInTheDocument();
  });

  // ---- Pagination ----

  it("shows pagination when logs exist", () => {
    setLogs({ logs: [makeLogEntry()], total: 120 });

    renderWithProviders(<Logs />);

    expect(screen.getByText("Previous")).toBeInTheDocument();
    expect(screen.getByText("Next")).toBeInTheDocument();
    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();
    expect(screen.getByText(/120 entries/)).toBeInTheDocument();
  });

  it("calls setPage when Next is clicked", () => {
    const setPageMock = vi.fn();
    setLogs({ logs: [makeLogEntry()], total: 120, setPage: setPageMock });

    renderWithProviders(<Logs />);

    fireEvent.click(screen.getByText("Next"));

    expect(setPageMock).toHaveBeenCalledWith(1);
  });

  it("calls setPage when Previous is clicked on page > 0", () => {
    const setPageMock = vi.fn();
    setLogs({
      logs: [makeLogEntry({ id: 51, action: "stop", actionDetail: "Stopped" })],
      total: 120,
      page: 1,
      setPage: setPageMock,
    });

    renderWithProviders(<Logs />);

    fireEvent.click(screen.getByText("Previous"));

    expect(setPageMock).toHaveBeenCalledWith(0);
  });

  it("Previous button is disabled on first page", () => {
    setLogs({ logs: [makeLogEntry()], total: 120 });

    renderWithProviders(<Logs />);

    const prevButton = screen.getByText("Previous").closest("button");
    expect(prevButton).toBeDisabled();
  });

  it("Next button is disabled on the last page", () => {
    setLogs({ logs: [makeLogEntry({ id: 100 })], total: 100, page: 1 });

    renderWithProviders(<Logs />);

    const nextButton = screen.getByText("Next").closest("button");
    expect(nextButton).toBeDisabled();
  });

  // ---- Timestamp rendering ----

  it("shows formatted timestamp on a log entry", () => {
    setLogs({
      logs: [makeLogEntry({ actionDetail: "Started", targetAmps: null })],
      total: 1,
    });

    renderWithProviders(<Logs />);

    const container = document.body;
    expect(container.textContent).toMatch(/Mar/);
  });

  // ---- Edge cases ----

  it("does not render Battery row when batterySoc is null", () => {
    setLogs({
      logs: [
        makeLogEntry({
          id: 200,
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
          checks: [],
        }),
      ],
      total: 1,
    });

    renderWithProviders(<Logs />);

    fireEvent.click(screen.getByText("Test Car"));

    expect(screen.getByText("Solar")).toBeInTheDocument();
    expect(screen.queryByText("Battery")).not.toBeInTheDocument();
  });

  // ---- Time range filter tests ----

  it("time range dropdown renders with all preset options", () => {
    renderWithProviders(<Logs />);

    const trigger = screen.getByTestId("time-range-trigger");
    expect(trigger).toBeInTheDocument();

    fireEvent.click(trigger);

    expect(screen.getAllByText("All time").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Last 1h")).toBeInTheDocument();
    expect(screen.getByText("Last 6h")).toBeInTheDocument();
    expect(screen.getByText("Last 24h")).toBeInTheDocument();
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("Yesterday")).toBeInTheDocument();
    expect(screen.getByText("Last 7 days")).toBeInTheDocument();
    expect(screen.getByText("Custom")).toBeInTheDocument();
  });

  it("selecting a preset updates the hook's from/to params", () => {
    renderWithProviders(<Logs />);

    const trigger = screen.getByTestId("time-range-trigger");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByText("Last 1h"));

    const lastCall = vi.mocked(useControllerLogs).mock.calls.at(-1);
    assertExists(lastCall);
    const filterArg = lastCall[1];
    assertExists(filterArg);
    assertExists(filterArg.from);
    const fromDate = new Date(filterArg.from);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    // Allow 5 seconds of tolerance
    expect(Math.abs(fromDate.getTime() - oneHourAgo.getTime())).toBeLessThan(
      5000,
    );
  });

  it("custom range shows date-time inputs", () => {
    renderWithProviders(<Logs />);

    expect(screen.queryByTestId("custom-from")).not.toBeInTheDocument();
    expect(screen.queryByTestId("custom-to")).not.toBeInTheDocument();

    const trigger = screen.getByTestId("time-range-trigger");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByText("Custom"));

    expect(screen.getByTestId("custom-from")).toBeInTheDocument();
    expect(screen.getByTestId("custom-to")).toBeInTheDocument();
  });

  // ---- Action type filter tests ----

  it("action type multi-select renders all 4 options", () => {
    renderWithProviders(<Logs />);

    const actionFilters = screen.getByTestId("action-filters");
    expect(actionFilters).toBeInTheDocument();

    expect(screen.getByTestId("action-start")).toBeInTheDocument();
    expect(screen.getByTestId("action-stop")).toBeInTheDocument();
    expect(screen.getByTestId("action-adjust_amps")).toBeInTheDocument();
    expect(screen.getByTestId("action-none")).toBeInTheDocument();

    expect(screen.getByText("Start")).toBeInTheDocument();
    expect(screen.getByText("Stop")).toBeInTheDocument();
    expect(screen.getByText("Adjust")).toBeInTheDocument();
    expect(screen.getByText("None")).toBeInTheDocument();
  });

  it("'Changes only' toggle deselects None action", () => {
    renderWithProviders(<Logs />);

    const changesOnly = screen.getByTestId("changes-only");
    fireEvent.click(changesOnly);

    const lastCall = vi.mocked(useControllerLogs).mock.calls.at(-1);
    assertExists(lastCall);
    const filterArg = lastCall[1];
    expect(filterArg?.action).toEqual(["start", "stop", "adjust_amps"]);
  });

  it("clear-all-filters button resets all filters", () => {
    globalThis.history.replaceState(
      null,
      "",
      "/logs?timeRange=1h&action=start",
    );

    renderWithProviders(<Logs />);

    const clearBtn = screen.getByTestId("clear-filters");
    expect(clearBtn).toBeInTheDocument();

    fireEvent.click(clearBtn);

    const lastCall = vi.mocked(useControllerLogs).mock.calls.at(-1);
    assertExists(lastCall);
    const filterArg = lastCall[1];
    expect(filterArg?.from).toBeUndefined();
    expect(filterArg?.to).toBeUndefined();
    expect(filterArg?.action).toBeUndefined();
    expect(lastCall[0]).toBeUndefined();
  });

  it("filter count badge shows correct count when filters active", () => {
    globalThis.history.replaceState(
      null,
      "",
      "/logs?timeRange=1h&action=start,stop",
    );

    renderWithProviders(<Logs />);

    const badge = screen.getByTestId("filter-count-badge");
    expect(badge).toBeInTheDocument();
    // Should show 2: timeRange is non-default, actions are non-default
    expect(badge.textContent).toBe("2");
  });

  // ---- URL sync ----

  it("filters are synced to URL search params", () => {
    renderWithProviders(<Logs />);

    const trigger = screen.getByTestId("time-range-trigger");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByText("Last 1h"));

    const params = new URLSearchParams(globalThis.location.search);
    expect(params.get("timeRange")).toBe("1h");
  });

  it("filters are restored from URL params on page load", () => {
    globalThis.history.replaceState(
      null,
      "",
      "/logs?timeRange=24h&action=start,stop",
    );

    renderWithProviders(<Logs />);

    const lastCall = vi.mocked(useControllerLogs).mock.calls.at(-1);
    assertExists(lastCall);
    const filterArg = lastCall[1];
    expect(filterArg?.from).toBeDefined();
    expect(filterArg?.action).toEqual(["start", "stop"]);
  });
});
