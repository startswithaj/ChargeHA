import "@testing-library/jest-dom/vitest";
import { assertExists } from "@std/assert";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { renderWithProviders } from "../../test-utils.tsx";

// Captured onChange refs for the mocked DayPicker / TimePicker subcomponents.
// Hoisted so the vi.mock factories below can close over them while still
// satisfying the no-test-globals lint rule.
const mocks = vi.hoisted(() => ({
  timePickerRefs: {
    start: null as ((v: string) => void) | null,
    end: null as ((v: string) => void) | null,
  },
  timePickerRenderCount: { value: 0 },
  dayPickerOnChangeRef: { value: null as ((days: string[]) => void) | null },
}));

vi.mock("../DayPicker/DayPicker.tsx", () => ({
  DayPicker: (
    props: { value: string[]; onChange: (days: string[]) => void },
  ) => {
    mocks.dayPickerOnChangeRef.value = props.onChange;
    return <div data-testid="day-picker">{props.value.join(",")}</div>;
  },
}));

vi.mock("../TimePicker/TimePicker.tsx", () => ({
  TimePicker: (props: { value: string; onChange: (v: string) => void }) => {
    // Track start vs end by render order (reset per full render cycle)
    if (mocks.timePickerRenderCount.value % 2 === 0) {
      mocks.timePickerRefs.start = props.onChange;
    } else {
      mocks.timePickerRefs.end = props.onChange;
    }
    mocks.timePickerRenderCount.value++;
    return <input data-testid="time-picker" value={props.value} readOnly />;
  },
}));

import { ScheduleForm } from "./ScheduleDialog.tsx";

describe("ScheduleForm", () => {
  const defaultProps = {
    editingSchedule: null,
    scheduleType: "charge" as const,
    vehicleId: "vin-123",
    onSave: vi.fn().mockResolvedValue(null),
    onCancel: vi.fn(),
  };

  type EditingSchedule = NonNullable<
    Parameters<typeof ScheduleForm>[0]["editingSchedule"]
  >;

  const makeEditingSchedule = (
    overrides: Partial<EditingSchedule> = {},
  ): EditingSchedule => ({
    id: "s1",
    vehicleId: "vin-123",
    scheduleType: "charge",
    startTime: "00:00",
    endTime: "06:00",
    days: ["mon"],
    chargeAmps: 16,
    chargeLimitPct: 80,
    enabled: true,
    ...overrides,
  } as EditingSchedule);

  const submitForm = () => {
    const form = screen.getByText(/Create Schedule|Save Changes/).closest(
      "form",
    );
    assertExists(form);
    fireEvent.submit(form);
  };

  const stepperButtons = (symbol: "−" | "+") =>
    screen.getAllByRole("button").filter((b) => b.textContent === symbol);

  // First minus/plus is amps, second is charge limit (positional — see audit).
  const clickStepper = (
    field: "amps" | "limit",
    dir: "-" | "+" | "max",
  ) => {
    if (dir === "max") {
      fireEvent.click(screen.getByText("Max"));
      return;
    }
    const btns = stepperButtons(dir === "-" ? "−" : "+");
    fireEvent.click(btns[field === "amps" ? 0 : 1]);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.timePickerRefs.start = null;
    mocks.timePickerRefs.end = null;
    mocks.timePickerRenderCount.value = 0;
    mocks.dayPickerOnChangeRef.value = null;

    Element.prototype.scrollIntoView = vi.fn();
    // Mock ResizeObserver
    globalThis.ResizeObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }));
  });

  afterEach(cleanup);

  it.each<[string, EditingSchedule | null, string]>([
    ["create when not editing", null, "Create Schedule"],
    [
      "save when editing",
      makeEditingSchedule({
        startTime: "01:00",
        endTime: "05:00",
        days: ["mon", "tue"],
        chargeAmps: 16,
        chargeLimitPct: 90,
      }),
      "Save Changes",
    ],
  ])("renders submit label: %s", (_name, editingSchedule, label) => {
    renderWithProviders(
      <ScheduleForm {...defaultProps} editingSchedule={editingSchedule} />,
    );
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it.each<["charge" | "blockout", string]>([
    ["charge", "Charge Amps"],
    ["charge", "Charge Limit"],
  ])("%s type renders %s", (scheduleType, label) => {
    renderWithProviders(
      <ScheduleForm {...defaultProps} scheduleType={scheduleType} />,
    );
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it.each<["charge" | "blockout", string]>([
    ["blockout", "Charge Amps"],
    ["blockout", "Charge Limit"],
  ])("%s type does not render %s", (scheduleType, label) => {
    renderWithProviders(
      <ScheduleForm {...defaultProps} scheduleType={scheduleType} />,
    );
    expect(screen.queryByText(label)).not.toBeInTheDocument();
  });

  // ---- Form submission ----

  it.each<[string, () => string | null | Promise<string | null>]>([
    ["async null", () => Promise.resolve(null)],
    ["sync null", () => null],
  ])("onSave %s closes the dialog", async (_name, impl) => {
    const onSave = vi.fn(impl);
    const onCancel = vi.fn();

    renderWithProviders(
      <ScheduleForm {...defaultProps} onSave={onSave} onCancel={onCancel} />,
    );

    submitForm();

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });

  it.each<[string, () => string | Promise<string>, string]>([
    ["async error", () => Promise.resolve("Async err"), "Async err"],
    ["sync error", () => "Sync err", "Sync err"],
  ])("onSave %s surfaces error", async (_name, impl, expected) => {
    const onSave = vi.fn(impl);
    const onCancel = vi.fn();

    renderWithProviders(
      <ScheduleForm {...defaultProps} onSave={onSave} onCancel={onCancel} />,
    );

    submitForm();

    await waitFor(() => {
      expect(screen.getByText(expected)).toBeInTheDocument();
    });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("displays validation error when no days are selected", async () => {
    const onSave = vi.fn();

    renderWithProviders(
      <ScheduleForm {...defaultProps} onSave={onSave} />,
    );

    // Clear all days via DayPicker onChange, wrapped in act
    assertExists(mocks.dayPickerOnChangeRef.value);
    const clearDays = mocks.dayPickerOnChangeRef.value;
    await act(() => {
      clearDays([]);
    });

    await act(() => {
      submitForm();
    });

    await waitFor(() => {
      expect(screen.getByText("Select at least one day.")).toBeInTheDocument();
    });

    // onSave should NOT be called when validation fails
    expect(onSave).not.toHaveBeenCalled();
  });

  it("calls onCancel when cancel button is clicked", () => {
    const onCancel = vi.fn();

    renderWithProviders(
      <ScheduleForm {...defaultProps} onCancel={onCancel} />,
    );

    fireEvent.click(screen.getByText("Cancel"));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  // ---- updateField via time picker onChange ----

  it("updates start time when TimePicker onChange fires", async () => {
    renderWithProviders(<ScheduleForm {...defaultProps} />);

    assertExists(mocks.timePickerRefs.start);
    const updateStart = mocks.timePickerRefs.start;
    await act(() => {
      updateStart("08:30");
    });

    // After state update and re-render, check the value
    const timePickers = screen.getAllByTestId("time-picker");
    expect(timePickers[0]).toHaveValue("08:30");
  });

  it("updates end time when TimePicker onChange fires", async () => {
    renderWithProviders(<ScheduleForm {...defaultProps} />);

    assertExists(mocks.timePickerRefs.end);
    const updateEnd = mocks.timePickerRefs.end;
    await act(() => {
      updateEnd("22:00");
    });

    const timePickers = screen.getAllByTestId("time-picker");
    expect(timePickers[1]).toHaveValue("22:00");
  });

  // ---- updateField via day picker onChange ----

  it("updates days when DayPicker onChange fires", async () => {
    renderWithProviders(<ScheduleForm {...defaultProps} />);

    assertExists(mocks.dayPickerOnChangeRef.value);
    const setDays = mocks.dayPickerOnChangeRef.value;
    await act(() => {
      setDays(["mon", "wed", "fri"]);
    });

    expect(screen.getByTestId("day-picker")).toHaveTextContent("mon,wed,fri");
  });

  // ---- Charge amps stepper ----

  it.each<[string, "-" | "+" | "max", number | undefined, string]>([
    ["decrements from default 32", "-", undefined, "31A"],
    ["increments from default 32", "+", 48, "33A"],
    ["sets to maxAmps via Max", "max", 48, "48A"],
  ])("amps stepper %s", (_name, dir, maxAmps, expected) => {
    renderWithProviders(
      <ScheduleForm {...defaultProps} maxAmps={maxAmps} />,
    );
    clickStepper("amps", dir);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("disables amps minus button when chargeAmps is 1", () => {
    renderWithProviders(
      <ScheduleForm
        {...defaultProps}
        editingSchedule={makeEditingSchedule({ chargeAmps: 1 })}
      />,
    );

    expect(stepperButtons("−")[0]).toBeDisabled();
  });

  // ---- Charge limit stepper ----

  it.each<[string, number, "-" | "+", string]>([
    ["decrements from 80", 80, "-", "75%"],
    ["increments from 80", 80, "+", "85%"],
  ])("limit stepper %s", (_name, chargeLimitPct, dir, expected) => {
    renderWithProviders(
      <ScheduleForm
        {...defaultProps}
        editingSchedule={makeEditingSchedule({ chargeLimitPct })}
      />,
    );
    clickStepper("limit", dir);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it.each<[string, number, "−" | "+"]>([
    ["minus at 50", 50, "−"],
    ["plus at 100", 100, "+"],
  ])("limit stepper disables %s", (_name, chargeLimitPct, symbol) => {
    renderWithProviders(
      <ScheduleForm
        {...defaultProps}
        editingSchedule={makeEditingSchedule({ chargeLimitPct })}
      />,
    );
    expect(stepperButtons(symbol)[1]).toBeDisabled();
  });

  // ---- Editing initializes form correctly ----

  it("populates form with editing schedule data for charge type", () => {
    renderWithProviders(
      <ScheduleForm
        {...defaultProps}
        editingSchedule={makeEditingSchedule({
          startTime: "01:00",
          endTime: "05:00",
          days: ["mon", "tue"],
          chargeAmps: 16,
          chargeLimitPct: 90,
        })}
      />,
    );

    // Verify charge amps and limit reflect the editing schedule
    expect(screen.getByText("16A")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();
    // Verify days
    expect(screen.getByTestId("day-picker")).toHaveTextContent("mon,tue");
  });

  it("populates form with editing schedule data for blockout type", () => {
    renderWithProviders(
      <ScheduleForm
        {...defaultProps}
        scheduleType="blockout"
        editingSchedule={{
          id: "s2",
          vehicleId: null,
          scheduleType: "blockout",
          startTime: "17:00",
          endTime: "21:00",
          days: ["mon", "tue", "wed", "thu", "fri"],
          enabled: true,
        }}
      />,
    );

    // Blockout schedule should not show charge fields
    expect(screen.queryByText("Charge Amps")).not.toBeInTheDocument();
    expect(screen.getByTestId("day-picker")).toHaveTextContent(
      "mon,tue,wed,thu,fri",
    );
  });

  // ---- Default times ----

  it("applies defaultStartTime and defaultEndTime when creating new schedule", () => {
    renderWithProviders(
      <ScheduleForm
        {...defaultProps}
        editingSchedule={null}
        defaultStartTime="08:00"
        defaultEndTime="14:00"
      />,
    );

    const timePickers = screen.getAllByTestId("time-picker");
    expect(timePickers[0]).toHaveValue("08:00");
    expect(timePickers[1]).toHaveValue("14:00");
  });

  it("uses default form times when no defaultStartTime/defaultEndTime provided", () => {
    renderWithProviders(
      <ScheduleForm
        {...defaultProps}
        editingSchedule={null}
      />,
    );

    const timePickers = screen.getAllByTestId("time-picker");
    expect(timePickers[0]).toHaveValue("00:00");
    expect(timePickers[1]).toHaveValue("06:00");
  });

  // ---- Error is cleared on field update ----

  it("clears error message when a field is updated after validation error", async () => {
    const onSave = vi.fn().mockResolvedValue("Some error");

    renderWithProviders(
      <ScheduleForm {...defaultProps} onSave={onSave} />,
    );

    // Trigger error
    submitForm();
    await waitFor(() => {
      expect(screen.getByText("Some error")).toBeInTheDocument();
    });

    // Update a field (end time) to clear the error
    assertExists(mocks.timePickerRefs.end);
    const updateEndTime = mocks.timePickerRefs.end;
    await act(() => {
      updateEndTime("23:00");
    });

    await waitFor(() => {
      expect(screen.queryByText("Some error")).not.toBeInTheDocument();
    });
  });
});
