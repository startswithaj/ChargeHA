import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import {
  blockoutSchedule,
  chargerKeyedSchedule,
  chargeSchedule,
  makeChargerRow,
  makeSchedulesReturn,
  makeVehicle,
  makeVehiclesReturn,
} from "./test-helpers/setupSchedules.ts";
import { renderWithProviders } from "../../../test-utils.tsx";
import { Schedules } from "./Schedules.tsx";
import { useSchedules } from "../../../hooks/useSchedules.ts";
import { useVehicles } from "../../../hooks/useVehicles.ts";

type UseVehiclesReturn = ReturnType<typeof useVehicles>;
type UseSchedulesReturn = ReturnType<typeof useSchedules>;

vi.mock("../../../hooks/useSchedules.ts", () => ({
  useSchedules: vi.fn(() => ({
    schedules: [],
    chargeSchedules: [],
    blockoutSchedules: [],
    loading: false,
    addSchedule: vi.fn(),
    updateSchedule: vi.fn(),
    toggleSchedule: vi.fn(),
    removeSchedule: vi.fn(),
  })),
}));

// Schedule sections derive from charging points, so the mock mirrors the
// currently-mocked vehicles: one linked point per vehicle.
const chargersHolder = vi.hoisted(
  (): { chargers: Array<Record<string, unknown>> } => ({ chargers: [] }),
);
vi.mock("../../../hooks/useChargers.ts", () => ({
  useChargers: () => ({
    chargers: chargersHolder.chargers,
    isLoading: false,
  }),
}));

vi.mock("../../../hooks/useVehicles.ts", () => ({
  useVehicles: vi.fn(() => ({
    vehicles: [
      {
        id: "VIN1",
        name: "Test Car",
        mode: "auto",
        adapterType: "tesla",
        priority: 1,
        state: null,
      },
    ],
    loading: false,
    error: null,
    commandPending: {},
    startCharging: vi.fn(),
    stopCharging: vi.fn(),
    setAmps: vi.fn(),
    changeMode: vi.fn(),
    refreshVehicles: vi.fn(),
  })),
}));

vi.mock("../../../hooks/useSectionConfig.ts", () => ({
  useSystemConfig: vi.fn(() => ({ data: { timezone: "Australia/Brisbane" } })),
}));

vi.mock("../../../hooks/useToast.tsx", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../hooks/useToast.tsx")>(),
  useToast: vi.fn(() => ({
    addToast: vi.fn(),
    removeToast: vi.fn(),
    toasts: [],
  })),
}));

vi.mock("../../ScheduleCard/ScheduleCard.tsx", () => ({
  ScheduleCard: (props: {
    schedule: { id: string };
    onToggle: (id: string, enabled: boolean) => void;
    onEdit: (schedule: { id: string }) => void;
    onDelete: (id: string) => void;
  }) => {
    return (
      <div data-testid="schedule-card" data-schedule-id={props.schedule.id}>
        <button
          type="button"
          data-testid={`edit-${props.schedule.id}`}
          onClick={() =>
            props.onEdit(props.schedule)}
        >
          Edit
        </button>
        <button
          type="button"
          data-testid={`delete-${props.schedule.id}`}
          onClick={() =>
            props.onDelete(props.schedule.id)}
        >
          Delete
        </button>
        <button
          type="button"
          data-testid={`toggle-${props.schedule.id}`}
          onClick={() => props.onToggle(props.schedule.id, false)}
        >
          Toggle
        </button>
      </div>
    );
  },
}));

vi.mock("../../ScheduleDialog/ScheduleDialog.tsx", () => ({
  ScheduleForm: (props: {
    scheduleType: string;
    onCancel: () => void;
    onSave: (data: unknown) => Promise<string | null>;
    editingSchedule: unknown;
    vehicleId: string | null;
    defaultStartTime?: string;
    defaultEndTime?: string;
  }) => {
    return (
      <div
        data-testid="schedule-form"
        data-schedule-type={props.scheduleType}
        data-editing={props.editingSchedule ? "true" : "false"}
      >
        <button type="button" onClick={props.onCancel}>Cancel Form</button>
        <button type="button" onClick={() => props.onSave({})}>
          Save Form
        </button>
      </div>
    );
  },
}));

describe("Schedules", () => {
  const setVehicles = (overrides: Partial<UseVehiclesReturn> = {}): void => {
    const vehiclesReturn = makeVehiclesReturn(overrides);
    vi.mocked(useVehicles).mockReturnValue(vehiclesReturn);
    chargersHolder.chargers = vehiclesReturn.vehicles.map((v) => ({
      id: `cp-${v.id}`,
      name: v.name,
      chargerAdapterType: v.adapterType,
      chargerConfig: "{}",
      mode: v.mode,
      priority: v.priority,
      vehicleId: v.id,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      state: null,
      // A vehicle-linked point is tied to its car by construction.
      kind: "vehicle_api",
      resolvedVehicleId: v.id,
      vehicleResolution: "linked",
    }));
  };
  // Replaces the charging points setVehicles derived. setVehicles REBUILDS
  // chargersHolder from its vehicles, so a test that needs both must call
  // setVehicles first and setChargers second, or the custom rows are lost.
  const setChargers = (chargers: Array<Record<string, unknown>>): void => {
    chargersHolder.chargers = chargers;
  };
  const setSchedules = (overrides: Partial<UseSchedulesReturn> = {}): void => {
    vi.mocked(useSchedules).mockReturnValue(makeSchedulesReturn(overrides));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setVehicles();
    setSchedules();

    Element.prototype.scrollIntoView = vi.fn();
    globalThis.ResizeObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }));
  });

  afterEach(() => {
    cleanup();
  });

  it("renders Blockout Schedules section", () => {
    renderWithProviders(<Schedules />);

    expect(screen.getByText("Blockout Schedules")).toBeInTheDocument();
  });

  it("renders loading state", () => {
    setVehicles({ vehicles: [], loading: true });

    renderWithProviders(<Schedules />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("renders no vehicles empty state when vehicles list is empty", () => {
    setVehicles({ vehicles: [] });

    renderWithProviders(<Schedules />);

    expect(screen.getByText("No vehicles configured")).toBeInTheDocument();
    expect(screen.getByText("Add Vehicle")).toBeInTheDocument();
  });

  it("calls onNavigateSettings when Add Vehicle button is clicked", () => {
    setVehicles({ vehicles: [] });

    const onNavigateSettings = vi.fn();
    renderWithProviders(<Schedules onNavigateSettings={onNavigateSettings} />);

    fireEvent.click(screen.getByText("Add Vehicle"));

    expect(onNavigateSettings).toHaveBeenCalledOnce();
  });

  it("renders empty state description in no-vehicles view", () => {
    setVehicles({ vehicles: [] });

    renderWithProviders(<Schedules />);

    expect(
      screen.getByText(
        /Add a vehicle in Settings to start creating charge and blockout schedules/,
      ),
    ).toBeInTheDocument();
  });

  it("renders vehicle name in section header", () => {
    renderWithProviders(<Schedules />);

    expect(screen.getByText("Test Car")).toBeInTheDocument();
  });

  it("renders vehicle adapter type badge", () => {
    renderWithProviders(<Schedules />);

    expect(screen.getByText("tesla")).toBeInTheDocument();
  });

  it("renders empty schedule message when vehicle has no charge schedules", () => {
    renderWithProviders(<Schedules />);

    expect(
      screen.getByText("No charge schedules for this vehicle."),
    ).toBeInTheDocument();
  });

  it("renders the schedule card and hides the empty-state copy when a charge schedule exists", () => {
    setSchedules({
      schedules: [chargeSchedule],
      chargeSchedules: [chargeSchedule],
    });

    renderWithProviders(<Schedules />);

    const cards = screen.getAllByTestId("schedule-card");
    expect(cards.length).toBeGreaterThanOrEqual(1);
    expect(cards[0]).toHaveAttribute("data-schedule-id", "sched-1");
    expect(
      screen.queryByText("No charge schedules for this vehicle."),
    ).not.toBeInTheDocument();
  });

  it("shows inline schedule form when Add Schedule is clicked", () => {
    renderWithProviders(<Schedules />);

    fireEvent.click(screen.getByText("Add Schedule"));

    expect(screen.getByTestId("schedule-form")).toBeInTheDocument();
    expect(screen.getByTestId("schedule-form")).toHaveAttribute(
      "data-schedule-type",
      "charge",
    );
  });

  it("closes the charge form when cancel is clicked", () => {
    renderWithProviders(<Schedules />);

    fireEvent.click(screen.getByText("Add Schedule"));
    expect(screen.getByTestId("schedule-form")).toBeInTheDocument();
    expect(screen.queryByText("Add Schedule")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Cancel Form"));

    expect(screen.queryByTestId("schedule-form")).not.toBeInTheDocument();
    expect(screen.getByText("Add Schedule")).toBeInTheDocument();
  });

  it("renders empty blockout state when no blockout schedules exist", () => {
    renderWithProviders(<Schedules />);

    expect(
      screen.getByText(
        /No blockout periods. Create one to prevent charging during peak/,
      ),
    ).toBeInTheDocument();
  });

  it("renders Add Blockout Period button", () => {
    renderWithProviders(<Schedules />);

    expect(screen.getByText("Add Blockout Period")).toBeInTheDocument();
  });

  it("renders the blockout schedule card and hides the empty-state copy when a blockout exists", () => {
    setSchedules({
      schedules: [blockoutSchedule],
      blockoutSchedules: [blockoutSchedule],
    });

    renderWithProviders(<Schedules />);

    const cards = screen.getAllByTestId("schedule-card");
    expect(
      cards.find((c) =>
        c.getAttribute("data-schedule-id") === "sched-blockout-1"
      ),
    ).toBeDefined();
    expect(
      screen.queryByText(/No blockout periods/),
    ).not.toBeInTheDocument();
  });

  it("shows blockout form when Add Blockout Period is clicked", () => {
    renderWithProviders(<Schedules />);

    fireEvent.click(screen.getByText("Add Blockout Period"));

    expect(screen.getByTestId("schedule-form")).toBeInTheDocument();
    expect(screen.getByTestId("schedule-form")).toHaveAttribute(
      "data-schedule-type",
      "blockout",
    );
  });

  it("closes the blockout form when cancel is clicked", () => {
    renderWithProviders(<Schedules />);

    fireEvent.click(screen.getByText("Add Blockout Period"));
    expect(screen.getByTestId("schedule-form")).toBeInTheDocument();
    expect(screen.queryByText("Add Blockout Period")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Cancel Form"));

    expect(screen.queryByTestId("schedule-form")).not.toBeInTheDocument();
    expect(screen.getByText("Add Blockout Period")).toBeInTheDocument();
  });

  it("renders informational footer copy", () => {
    renderWithProviders(<Schedules />);

    expect(
      screen.getByText(
        /Blockout schedules take priority over charge schedules/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/If you have a schedule that triggers when your Tesla/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Charge schedules override solar tracking and charge at the set rate/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Times shown in/)).toBeInTheDocument();
  });

  it("renders a section header and empty state per vehicle", () => {
    setVehicles({
      vehicles: [
        makeVehicle({ id: "VIN1", name: "Model 3", priority: 1 }),
        makeVehicle({ id: "VIN2", name: "Model Y", priority: 2 }),
      ],
    });

    renderWithProviders(<Schedules />);

    expect(screen.getByText("Model 3")).toBeInTheDocument();
    expect(screen.getByText("Model Y")).toBeInTheDocument();
    expect(
      screen.getAllByText("No charge schedules for this vehicle."),
    ).toHaveLength(2);
  });

  it("renders an Add Schedule button per vehicle", () => {
    setVehicles({
      vehicles: [
        makeVehicle({ id: "VIN1", name: "Model 3", priority: 1 }),
        makeVehicle({ id: "VIN2", name: "Model Y", priority: 2 }),
      ],
    });

    renderWithProviders(<Schedules />);

    expect(screen.getAllByText("Add Schedule")).toHaveLength(2);
  });

  it("opens edit form when Edit button is clicked on a charge schedule card", () => {
    setSchedules({
      schedules: [chargeSchedule],
      chargeSchedules: [chargeSchedule],
    });

    renderWithProviders(<Schedules />);

    fireEvent.click(screen.getByTestId("edit-sched-1"));

    const form = screen.getByTestId("schedule-form");
    expect(form).toBeInTheDocument();
    expect(form).toHaveAttribute("data-editing", "true");
    expect(form).toHaveAttribute("data-schedule-type", "charge");
  });

  it("replaces schedule card with inline edit form for that specific schedule", () => {
    setSchedules({
      schedules: [chargeSchedule],
      chargeSchedules: [chargeSchedule],
    });

    renderWithProviders(<Schedules />);

    expect(screen.getByTestId("schedule-card")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("edit-sched-1"));

    expect(screen.queryByTestId("schedule-card")).not.toBeInTheDocument();
    expect(screen.getByTestId("schedule-form")).toBeInTheDocument();
  });

  it("hides Add Schedule button when editing a charge schedule for that vehicle", () => {
    setSchedules({
      schedules: [chargeSchedule],
      chargeSchedules: [chargeSchedule],
    });

    renderWithProviders(<Schedules />);

    fireEvent.click(screen.getByTestId("edit-sched-1"));

    expect(screen.queryByText("Add Schedule")).not.toBeInTheDocument();
  });

  it("closes edit form and shows schedule card again when cancel is clicked", () => {
    setSchedules({
      schedules: [chargeSchedule],
      chargeSchedules: [chargeSchedule],
    });

    renderWithProviders(<Schedules />);

    fireEvent.click(screen.getByTestId("edit-sched-1"));
    expect(screen.getByTestId("schedule-form")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Cancel Form"));

    expect(screen.queryByTestId("schedule-form")).not.toBeInTheDocument();
    expect(screen.getByTestId("schedule-card")).toBeInTheDocument();
  });

  it("opens edit form when Edit button is clicked on a blockout schedule card", () => {
    setSchedules({
      schedules: [blockoutSchedule],
      blockoutSchedules: [blockoutSchedule],
    });

    renderWithProviders(<Schedules />);

    fireEvent.click(screen.getByTestId("edit-sched-blockout-1"));

    const form = screen.getByTestId("schedule-form");
    expect(form).toBeInTheDocument();
    expect(form).toHaveAttribute("data-editing", "true");
    expect(form).toHaveAttribute("data-schedule-type", "blockout");
  });

  it("hides Add Blockout Period button when editing a blockout schedule", () => {
    setSchedules({
      schedules: [blockoutSchedule],
      blockoutSchedules: [blockoutSchedule],
    });

    renderWithProviders(<Schedules />);

    fireEvent.click(screen.getByTestId("edit-sched-blockout-1"));

    expect(screen.queryByText("Add Blockout Period")).not.toBeInTheDocument();
  });

  it("calls removeSchedule when Delete button is clicked on a charge schedule", () => {
    const removeSchedule = vi.fn();
    setSchedules({
      schedules: [chargeSchedule],
      chargeSchedules: [chargeSchedule],
      removeSchedule,
    });

    renderWithProviders(<Schedules />);

    fireEvent.click(screen.getByTestId("delete-sched-1"));

    expect(removeSchedule).toHaveBeenCalledWith("sched-1");
  });

  it("calls removeSchedule when Delete button is clicked on a blockout schedule", () => {
    const removeSchedule = vi.fn();
    setSchedules({
      schedules: [blockoutSchedule],
      blockoutSchedules: [blockoutSchedule],
      removeSchedule,
    });

    renderWithProviders(<Schedules />);

    fireEvent.click(screen.getByTestId("delete-sched-blockout-1"));

    expect(removeSchedule).toHaveBeenCalledWith("sched-blockout-1");
  });

  it("calls toggleSchedule when Toggle button is clicked on a schedule", () => {
    const toggleSchedule = vi.fn();
    setSchedules({
      schedules: [chargeSchedule],
      chargeSchedules: [chargeSchedule],
      toggleSchedule,
    });

    renderWithProviders(<Schedules />);

    fireEvent.click(screen.getByTestId("toggle-sched-1"));

    expect(toggleSchedule).toHaveBeenCalledWith("sched-1", false);
  });

  it("calls addSchedule when save is triggered on a create-charge form", () => {
    const addSchedule = vi.fn().mockResolvedValue(null);
    setSchedules({ addSchedule });

    renderWithProviders(<Schedules />);

    fireEvent.click(screen.getByText("Add Schedule"));
    fireEvent.click(screen.getByText("Save Form"));

    expect(addSchedule).toHaveBeenCalled();
  });

  it("calls addSchedule when save is triggered on a create-blockout form", () => {
    const addSchedule = vi.fn().mockResolvedValue(null);
    setSchedules({ addSchedule });

    renderWithProviders(<Schedules />);

    fireEvent.click(screen.getByText("Add Blockout Period"));
    fireEvent.click(screen.getByText("Save Form"));

    expect(addSchedule).toHaveBeenCalled();
  });

  it("calls updateSchedule when save is triggered on an edit form", () => {
    const updateSchedule = vi.fn().mockResolvedValue(null);
    setSchedules({
      schedules: [chargeSchedule],
      chargeSchedules: [chargeSchedule],
      updateSchedule,
    });

    renderWithProviders(<Schedules />);

    fireEvent.click(screen.getByTestId("edit-sched-1"));
    fireEvent.click(screen.getByText("Save Form"));

    expect(updateSchedule).toHaveBeenCalledWith("sched-1", expect.anything());
  });

  it("renders both charge and blockout schedule cards", () => {
    setSchedules({
      schedules: [chargeSchedule, blockoutSchedule],
      chargeSchedules: [chargeSchedule],
      blockoutSchedules: [blockoutSchedule],
    });

    renderWithProviders(<Schedules />);

    const cards = screen.getAllByTestId("schedule-card");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAttribute("data-schedule-id", "sched-1");
    expect(cards[1]).toHaveAttribute("data-schedule-id", "sched-blockout-1");
  });

  it("does not hide Add Blockout Period when editing a charge schedule", () => {
    setSchedules({
      schedules: [chargeSchedule, blockoutSchedule],
      chargeSchedules: [chargeSchedule],
      blockoutSchedules: [blockoutSchedule],
    });

    renderWithProviders(<Schedules />);

    fireEvent.click(screen.getByTestId("edit-sched-1"));

    expect(screen.getByText("Add Blockout Period")).toBeInTheDocument();
  });

  it("does not hide Add Schedule when editing a blockout schedule", () => {
    setSchedules({
      schedules: [chargeSchedule, blockoutSchedule],
      chargeSchedules: [chargeSchedule],
      blockoutSchedules: [blockoutSchedule],
    });

    renderWithProviders(<Schedules />);

    fireEvent.click(screen.getByTestId("edit-sched-blockout-1"));

    expect(screen.getByText("Add Schedule")).toBeInTheDocument();
  });

  describe("group heading", () => {
    it("names the group after the charge point, so two chargers can be told apart", () => {
      setChargers([makeChargerRow({ name: "vcp-dev-2" })]);

      renderWithProviders(<Schedules />);

      expect(screen.getByText("vcp-dev-2")).toBeInTheDocument();
    });

    it("drops the adapter badge when it only repeats the row name", () => {
      setChargers([makeChargerRow()]);

      renderWithProviders(<Schedules />);

      // Name and badge would both read "OCPP Smart Charger" — once is enough.
      expect(screen.getAllByText("OCPP Smart Charger")).toHaveLength(1);
    });

    it("keeps the adapter badge when it differs from the row name", () => {
      setChargers([makeChargerRow({ name: "Garage" })]);

      renderWithProviders(<Schedules />);

      expect(screen.getByText("Garage")).toBeInTheDocument();
      expect(screen.getByText("OCPP Smart Charger")).toBeInTheDocument();
    });
  });

  describe("overlap warning", () => {
    // The user's real case: an OCPP charger plus the car plugged into it, each
    // with its own charging point row and its own schedule group.
    const setOverlapPoints = (
      chargerOverrides: Record<string, unknown> = {},
    ): void => {
      setChargers([
        makeChargerRow(chargerOverrides),
        makeChargerRow({
          id: "cp-vin1",
          name: "Test Car",
          chargerAdapterType: "tesla",
          chargerConfig: "{}",
          kind: "vehicle_api",
          vehicleId: "VIN1",
          resolvedVehicleId: "VIN1",
          vehicleResolution: "linked",
        }),
      ]);
    };

    const withSchedules = (
      charger: Partial<typeof chargerKeyedSchedule>,
      vehicle: Partial<typeof chargeSchedule>,
    ): void => {
      const c = { ...chargerKeyedSchedule, ...charger };
      const v = { ...chargeSchedule, ...vehicle };
      setSchedules({ schedules: [c, v], chargeSchedules: [c, v] });
    };

    it("warns when a charger and a vehicle schedule fully overlap", () => {
      setOverlapPoints();
      withSchedules({}, { chargeLimitPct: 80 });

      renderWithProviders(<Schedules />);

      expect(
        screen.getByText(/Two schedules can drive OCPP Smart Charger/),
      ).toBeInTheDocument();
      expect(screen.getByText(/00:00–06:00/)).toBeInTheDocument();
      expect(screen.getByText(/sets the current \(32A\)/)).toBeInTheDocument();
      expect(
        screen.getByText(/80% limit still stops the charge/),
      ).toBeInTheDocument();
    });

    it("names the stricter limit when both schedules set one", () => {
      setOverlapPoints();
      withSchedules({ chargeLimitPct: 70 }, { chargeLimitPct: 80 });

      renderWithProviders(<Schedules />);

      expect(
        screen.getByText(/stricter of the two limits \(70%\) stops the charge/),
      ).toBeInTheDocument();
    });

    it("names the charger's own limit when the vehicle sets none", () => {
      setOverlapPoints();
      withSchedules({ chargeLimitPct: 65 }, { chargeLimitPct: null });

      renderWithProviders(<Schedules />);

      expect(
        screen.getByText(/this charger's 65% limit stops the charge/),
      ).toBeInTheDocument();
    });

    it("names only the overlapping window for a partial overlap", () => {
      setOverlapPoints();
      withSchedules({}, { startTime: "05:00", endTime: "08:00" });

      renderWithProviders(<Schedules />);

      expect(screen.getByText(/05:00–06:00/)).toBeInTheDocument();
      expect(screen.queryByText(/00:00–06:00/)).not.toBeInTheDocument();
    });

    it("names a midnight-crossing overlap as one window", () => {
      setOverlapPoints();
      withSchedules(
        { startTime: "22:00", endTime: "06:00" },
        { startTime: "23:00", endTime: "02:00" },
      );

      renderWithProviders(<Schedules />);

      expect(screen.getByText(/23:00–02:00/)).toBeInTheDocument();
    });

    it("does not warn when the two schedules run on disjoint days", () => {
      setOverlapPoints();
      withSchedules({ days: ["mon", "tue"] }, { days: ["sat", "sun"] });

      renderWithProviders(<Schedules />);

      expect(
        screen.queryByText(/Two schedules can drive/),
      ).not.toBeInTheDocument();
    });

    it("does not warn when the vehicle schedule is disabled", () => {
      setOverlapPoints();
      withSchedules({}, { enabled: false });

      renderWithProviders(<Schedules />);

      expect(
        screen.queryByText(/Two schedules can drive/),
      ).not.toBeInTheDocument();
    });

    it("does not warn when the charger resolves to a different vehicle", () => {
      setOverlapPoints({ resolvedVehicleId: "VIN2" });
      withSchedules({}, {});

      renderWithProviders(<Schedules />);

      expect(
        screen.queryByText(/Two schedules can drive/),
      ).not.toBeInTheDocument();
    });
  });

  describe("vehicle schedule reachability", () => {
    const setSmartPoint = (overrides: Record<string, unknown> = {}): void => {
      setChargers([
        makeChargerRow({ vehicleId: "VIN1", ...overrides }),
      ]);
      setSchedules({
        schedules: [chargeSchedule],
        chargeSchedules: [chargeSchedule],
      });
    };

    it("says the schedules run through the charger the vehicle resolves to", () => {
      setSmartPoint({ resolvedVehicleId: "VIN1", vehicleResolution: "linked" });

      renderWithProviders(<Schedules />);

      expect(
        screen.getByText(
          /These schedules are running through OCPP Smart Charger/,
        ),
      ).toBeInTheDocument();
    });

    it("warns that nothing runs when several cars are plugged in", () => {
      setSmartPoint({
        resolvedVehicleId: null,
        vehicleResolution: "ambiguous",
      });

      renderWithProviders(<Schedules />);

      expect(
        screen.getByText(/These schedules are not running right now/),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/More than one vehicle is plugged into/),
      ).toBeInTheDocument();
    });

    it("says the schedules are idle when no point resolves to the vehicle", () => {
      setSmartPoint({ resolvedVehicleId: null, vehicleResolution: "none" });

      renderWithProviders(<Schedules />);

      expect(
        screen.getByText(/These schedules are idle right now/),
      ).toBeInTheDocument();
    });

    it("shows no notice for a group with no schedules", () => {
      setChargers([
        makeChargerRow({ vehicleId: "VIN1", resolvedVehicleId: null }),
      ]);
      setSchedules({});

      renderWithProviders(<Schedules />);

      expect(
        screen.queryByText(/These schedules are/),
      ).not.toBeInTheDocument();
    });

    it("shows no notice for a vehicle_api point, which is linked by construction", () => {
      setChargers([makeChargerRow({
        name: "Test Car",
        chargerAdapterType: "tesla",
        chargerConfig: "{}",
        kind: "vehicle_api",
        vehicleId: "VIN1",
        resolvedVehicleId: "VIN1",
        vehicleResolution: "linked",
      })]);
      setSchedules({
        schedules: [chargeSchedule],
        chargeSchedules: [chargeSchedule],
      });

      renderWithProviders(<Schedules />);

      expect(
        screen.queryByText(/These schedules are/),
      ).not.toBeInTheDocument();
    });
  });

  describe("group composition", () => {
    it("gives an assigned smart charger both a charger group and a vehicle group", () => {
      setChargers([makeChargerRow({
        vehicleId: "VIN1",
        resolvedVehicleId: "VIN1",
        vehicleResolution: "linked",
      })]);
      setSchedules({
        schedules: [chargerKeyedSchedule, chargeSchedule],
        chargeSchedules: [chargerKeyedSchedule, chargeSchedule],
      });

      renderWithProviders(<Schedules />);

      // Charger group, keyed by the point, listing its charger-keyed schedule.
      expect(screen.getByText("OCPP Smart Charger")).toBeInTheDocument();
      expect(screen.getByTestId("delete-sched-charger-1")).toBeInTheDocument();
      // Vehicle group, keyed by the car, listing its vehicle-keyed schedule.
      expect(screen.getByText("Test Car")).toBeInTheDocument();
      expect(screen.getByTestId("delete-sched-1")).toBeInTheDocument();
    });

    it("shows the overlap warning for an explicitly assigned charger", () => {
      setChargers([makeChargerRow({
        vehicleId: "VIN1",
        resolvedVehicleId: "VIN1",
        vehicleResolution: "linked",
      })]);
      const vehicleSched = { ...chargeSchedule, chargeLimitPct: 80 };
      setSchedules({
        schedules: [chargerKeyedSchedule, vehicleSched],
        chargeSchedules: [chargerKeyedSchedule, vehicleSched],
      });

      renderWithProviders(<Schedules />);

      expect(
        screen.getByText(/Two schedules can drive OCPP Smart Charger/),
      ).toBeInTheDocument();
    });

    it("gives one vehicle group when two points resolve to the same car", () => {
      setChargers([
        makeChargerRow({ id: "cp-1", vehicleId: "VIN1" }),
        makeChargerRow({
          id: "cp-2",
          name: "Second Charger",
          chargerConfig: '{"charger_id":"vcp-dev-3"}',
          resolvedVehicleId: "VIN1",
        }),
      ]);
      setSchedules({
        schedules: [chargeSchedule],
        chargeSchedules: [chargeSchedule],
      });

      renderWithProviders(<Schedules />);

      expect(screen.getAllByText("Test Car")).toHaveLength(1);
      // One group means the schedule is listed once, not twice.
      expect(screen.getAllByTestId("schedule-card")).toHaveLength(1);
    });

    it("gives a vehicle_api point a vehicle group only, never a charger group", () => {
      setChargers([makeChargerRow({
        name: "Test Car",
        chargerAdapterType: "tesla",
        chargerConfig: "{}",
        kind: "vehicle_api",
        vehicleId: "VIN1",
        resolvedVehicleId: "VIN1",
        vehicleResolution: "linked",
      })]);

      renderWithProviders(<Schedules />);

      expect(
        screen.getByText("No charge schedules for this vehicle."),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("No charge schedules for this charger."),
      ).not.toBeInTheDocument();
    });

    it("gives no vehicle group to a car no charging point is tied to", () => {
      // setVehicles rebuilds the charger list, so setChargers must follow it.
      setVehicles({
        vehicles: [
          makeVehicle({ id: "VIN1", name: "Model 3" }),
          makeVehicle({ id: "VIN2", name: "Orphan Car" }),
        ],
      });
      setChargers([makeChargerRow({ resolvedVehicleId: "VIN1" })]);

      renderWithProviders(<Schedules />);

      expect(screen.getByText("Model 3")).toBeInTheDocument();
      expect(screen.queryByText("Orphan Car")).not.toBeInTheDocument();
    });
  });
});
