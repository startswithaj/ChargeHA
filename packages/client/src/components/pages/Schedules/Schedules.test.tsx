import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import {
  blockoutSchedule,
  chargeSchedule,
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
    vi.mocked(useVehicles).mockReturnValue(makeVehiclesReturn(overrides));
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

  // ---- Basic rendering ----

  it("renders Blockout Schedules section", () => {
    renderWithProviders(<Schedules />);

    expect(screen.getByText("Blockout Schedules")).toBeInTheDocument();
  });

  it("renders loading state", () => {
    setVehicles({ vehicles: [], loading: true });

    renderWithProviders(<Schedules />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  // ---- No-vehicle empty state ----

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

  // ---- Vehicle section rendering ----

  it("renders vehicle name in section header", () => {
    renderWithProviders(<Schedules />);

    expect(screen.getByText("Test Car")).toBeInTheDocument();
  });

  it("renders vehicle adapter type badge", () => {
    renderWithProviders(<Schedules />);

    expect(screen.getByText("tesla")).toBeInTheDocument();
  });

  // ---- Empty schedule state per vehicle ----

  it("renders empty schedule message when vehicle has no charge schedules", () => {
    renderWithProviders(<Schedules />);

    expect(
      screen.getByText("No charge schedules for this vehicle."),
    ).toBeInTheDocument();
  });

  // ---- Existing charge schedule cards ----

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

  // ---- Add Schedule button ----

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

  // ---- Blockout section ----

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

  // ---- Info card / footer content ----

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

  // ---- Multiple vehicles ----

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

  // ---- Edit flow for charge schedules ----

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

  // ---- Edit flow for blockout schedules ----

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

  // ---- Delete flow ----

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

  // ---- Toggle flow ----

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

  // ---- handleSave routes to addSchedule for new schedules ----

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

  // ---- handleSave routes to updateSchedule for edit ----

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

  // ---- Both charge and blockout schedules ----

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

  // ---- Form targeting (editing hides correct Add button per section) ----

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
});
