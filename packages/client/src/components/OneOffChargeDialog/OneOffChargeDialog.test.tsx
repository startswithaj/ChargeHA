import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type {
  ChargeSchedule,
  Schedule,
  VehicleChargeState,
} from "@chargeha/shared";
import { renderWithProviders } from "../../test-utils.tsx";
import { OneOffChargeDialog } from "./OneOffChargeDialog.tsx";

// Captured TimePicker onChange so tests can drive the start time.
const mocks = vi.hoisted(() => ({
  timePickerOnChange: { value: null as ((v: string) => void) | null },
}));

vi.mock("../TimePicker/TimePicker.tsx", () => ({
  TimePicker: (props: { value: string; onChange: (v: string) => void }) => {
    mocks.timePickerOnChange.value = props.onChange;
    return <input data-testid="time-picker" value={props.value} readOnly />;
  },
}));

vi.mock("../../hooks/useSectionConfig.ts", () => ({
  useSystemConfig: vi.fn(() => ({ data: { timezone: "UTC" } })),
  useSolarConfig: vi.fn(() => ({
    data: { gridVoltage: 230, threePhaseCharger: false },
  })),
}));

vi.mock("../../trpc.ts", () => ({
  trpc: {
    tariff: {
      list: {
        useQuery: vi.fn(() => ({
          data: {
            periods: [
              {
                id: 1,
                label: "EV",
                startTime: "22:00",
                endTime: "07:00",
                days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
                ratePerKwh: 0.10,
                enabled: true,
              },
            ],
            defaultRatePerKwh: 0.30,
            currencySymbol: "$",
            currencyCode: "AUD",
          },
          isLoading: false,
          error: null,
        })),
      },
    },
  },
}));

describe("OneOffChargeDialog", () => {
  const state: VehicleChargeState = {
    vehicleId: "v1",
    isOnline: true,
    isPluggedIn: true,
    isCharging: false,
    batteryLevel: 40,
    chargeLimit: 80,
    chargeAmps: 0,
    chargeAmpsMin: 5,
    chargeAmpsMax: 16,
    chargePowerKw: 0,
    chargerVoltage: 230,
    chargerPhases: 1,
    energyAddedKwh: 0,
    minutesToFull: 0,
    chargePortOpen: false,
    vehicleName: "Test Car",
    lastUpdated: "2026-08-11T04:00:00.000Z",
    latitude: null,
    longitude: null,
    isHome: null,
  };

  const renderDialog = (
    overrides: {
      mode?: "auto" | "stop" | "charge_now";
      schedules?: Schedule[];
      state?: Partial<VehicleChargeState>;
      onSchedule?: (data: unknown) => Promise<string | null>;
      onCancelPending?: (id: string) => Promise<unknown>;
    } = {},
  ) => {
    const onSchedule = overrides.onSchedule ??
      vi.fn(() => Promise.resolve(null));
    const onOpenChange = vi.fn();
    const result = renderWithProviders(
      <OneOffChargeDialog
        open
        onOpenChange={onOpenChange}
        vehicleId="v1"
        vehicleName="Test Car"
        state={{ ...state, ...overrides.state }}
        mode={overrides.mode ?? "auto"}
        schedules={overrides.schedules ?? []}
        onSchedule={onSchedule as never}
        onCancelPending={overrides.onCancelPending}
      />,
    );
    return { ...result, onSchedule, onOpenChange };
  };

  /** Press an amps stepper button n times. The amps steppers render before the
   *  charge-limit ones, so index 0 is the amps control. */
  const stepAmps = async (
    user: ReturnType<typeof userEvent.setup>,
    label: "−" | "+",
    times: number,
  ) => {
    await Array.from({ length: times }).reduce<Promise<void>>(
      (prev) =>
        prev.then(() =>
          user.click(screen.getAllByRole("button", { name: label })[0])
        ),
      Promise.resolve(),
    );
  };

  beforeEach(() => {
    // Tuesday 2026-08-11 04:00 UTC, so 23:30 resolves to today
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-11T04:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.clearAllMocks();
  });

  it("defaults to 23:30, 3h, max amps and the vehicle's charge limit", () => {
    renderDialog();
    expect(screen.getByTestId("time-picker")).toHaveValue("23:30");
    expect(screen.getByRole("combobox")).toHaveTextContent("3h");
    expect(screen.getByText("16A")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
  });

  it("shows the resolved window, including the day it ends on", () => {
    renderDialog();
    // 23:30 today → 02:30 the next day (Wednesday)
    expect(screen.getByText(/today/)).toBeInTheDocument();
    expect(screen.getByText(/11:30 PM/)).toBeInTheDocument();
    expect(screen.getByText(/2:30 AM/)).toBeInTheDocument();
    expect(screen.getByText(/Wed/)).toBeInTheDocument();
  });

  it("says tomorrow when the start time has already passed", () => {
    vi.setSystemTime(new Date("2026-08-11T23:45:00Z"));
    renderDialog();
    expect(screen.getByText(/tomorrow/)).toBeInTheDocument();
  });

  it("estimates the cost from the tariff for the window", () => {
    renderDialog();
    // 16A × 230V × 1 phase = 3.68 kW × 3h = 11.04 kWh at $0.10 = $1.10
    expect(screen.getByText("up to $1.10")).toBeInTheDocument();
    expect(screen.getByText(/11\.0 kWh at 3\.7 kW/)).toBeInTheDocument();
  });

  it("re-estimates when the amps change", async () => {
    const user = userEvent.setup();
    renderDialog();
    expect(screen.getByText("up to $1.10")).toBeInTheDocument();

    // One press of "−" drops 16A to 15A → 3.45 kW × 3h × $0.10 = $1.035
    await user.click(screen.getAllByRole("button", { name: "−" })[0]);
    await waitFor(() => {
      expect(screen.getByText("15A")).toBeInTheDocument();
    });
    expect(screen.getByText("up to $1.04")).toBeInTheDocument();
  });

  it("states the assumptions behind the estimate", () => {
    renderDialog();
    expect(screen.getByText(/Assumes grid import for the full window/))
      .toBeInTheDocument();
  });

  describe("amps bounds come from the vehicle's configured range", () => {
    it("defaults to the configured maximum", () => {
      renderDialog({ state: { chargeAmpsMin: 6, chargeAmpsMax: 24 } });
      expect(screen.getByText("24A")).toBeInTheDocument();
    });

    it("cannot be stepped above the configured maximum", () => {
      renderDialog({ state: { chargeAmpsMin: 5, chargeAmpsMax: 16 } });
      // Already at the max, so "+" is disabled
      expect(screen.getAllByRole("button", { name: "+" })[0]).toBeDisabled();
    });

    it("stops at the configured minimum rather than 1A", async () => {
      const user = userEvent.setup();
      renderDialog({ state: { chargeAmpsMin: 8, chargeAmpsMax: 16 } });

      // 16 → 8 needs 8 presses; try 12 to prove it clamps instead of reaching 4
      await stepAmps(user, "−", 12);

      await waitFor(() => {
        expect(screen.getByText("8A")).toBeInTheDocument();
      });
      expect(screen.getAllByRole("button", { name: "−" })[0]).toBeDisabled();
    });

    it("clamps a pending charge saved below the configured minimum", () => {
      const staleLow: ChargeSchedule = {
        id: "pending-low",
        vehicleId: "v1",
        scheduleType: "charge",
        startTime: "23:30",
        endTime: "02:30",
        days: ["tue"],
        chargeAmps: 2,
        chargeLimitPct: 80,
        oneOffDate: "2026-08-11",
        enabled: true,
      };
      renderDialog({
        schedules: [staleLow],
        state: { chargeAmpsMin: 6, chargeAmpsMax: 16 },
      });
      expect(screen.getByText("6A")).toBeInTheDocument();
    });

    it("clamps a pending charge saved above the configured maximum", () => {
      const staleHigh: ChargeSchedule = {
        id: "pending-high",
        vehicleId: "v1",
        scheduleType: "charge",
        startTime: "23:30",
        endTime: "02:30",
        days: ["tue"],
        chargeAmps: 32,
        chargeLimitPct: 80,
        oneOffDate: "2026-08-11",
        enabled: true,
      };
      renderDialog({
        schedules: [staleHigh],
        state: { chargeAmpsMin: 6, chargeAmpsMax: 16 },
      });
      expect(screen.getByText("16A")).toBeInTheDocument();
    });

    it("submits an amps value inside the configured range", async () => {
      const user = userEvent.setup();
      const { onSchedule } = renderDialog({
        state: { chargeAmpsMin: 10, chargeAmpsMax: 20 },
      });

      await stepAmps(user, "−", 3);
      await user.click(screen.getByRole("button", { name: "Schedule charge" }));

      await waitFor(() => {
        expect(onSchedule).toHaveBeenCalledWith(
          expect.objectContaining({ chargeAmps: 17 }),
        );
      });
    });
  });

  it("warns and offers the auto switch when the vehicle is stopped", () => {
    renderDialog({ mode: "stop" });
    expect(screen.getByText(/only run in Auto/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Switch this vehicle to Auto/))
      .toBeInTheDocument();
  });

  it("hides the auto switch in auto mode", () => {
    renderDialog({ mode: "auto" });
    expect(screen.queryByText(/Switch this vehicle to Auto/)).toBeNull();
  });

  it("warns about an overlapping blockout", () => {
    const blockout: Schedule = {
      id: "b1",
      vehicleId: null,
      scheduleType: "blockout",
      startTime: "22:00",
      endTime: "06:00",
      days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      enabled: true,
    };
    renderDialog({ schedules: [blockout] });
    expect(screen.getByText(/Blockouts take priority/)).toBeInTheDocument();
  });

  it("submits the form values and closes", async () => {
    const user = userEvent.setup();
    const { onSchedule, onOpenChange } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Schedule charge" }));

    await waitFor(() => {
      expect(onSchedule).toHaveBeenCalledWith({
        startTime: "23:30",
        durationMinutes: 180,
        chargeAmps: 16,
        chargeLimitPct: 80,
        switchToAuto: true,
      });
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("surfaces a save error and stays open", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog({
      onSchedule: vi.fn(() => Promise.resolve("Vehicle not found")),
    });

    await user.click(screen.getByRole("button", { name: "Schedule charge" }));

    await waitFor(() => {
      expect(screen.getByText("Vehicle not found")).toBeInTheDocument();
    });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  describe("with a pending one-off", () => {
    const pending: ChargeSchedule = {
      id: "pending-1",
      vehicleId: "v1",
      scheduleType: "charge",
      startTime: "22:00",
      endTime: "23:00",
      days: ["tue"],
      chargeAmps: 10,
      chargeLimitPct: 90,
      oneOffDate: "2026-08-11",
      enabled: true,
    };

    it("pre-fills from the pending charge", () => {
      renderDialog({ schedules: [pending] });
      expect(screen.getByTestId("time-picker")).toHaveValue("22:00");
      expect(screen.getByRole("combobox")).toHaveTextContent("1h");
      expect(screen.getByText("10A")).toBeInTheDocument();
      expect(screen.getByText("90%")).toBeInTheDocument();
    });

    it("frames itself as a replacement", () => {
      renderDialog({ schedules: [pending] });
      expect(screen.getByText(/Replaces the charge already scheduled/))
        .toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Update charge" }))
        .toBeInTheDocument();
    });

    it("cancels the pending charge and closes", async () => {
      const user = userEvent.setup();
      const onCancelPending = vi.fn(() => Promise.resolve());
      const { onOpenChange } = renderDialog({
        schedules: [pending],
        onCancelPending,
      });

      await user.click(screen.getByRole("button", { name: "Cancel charge" }));

      await waitFor(() => {
        expect(onCancelPending).toHaveBeenCalledWith("pending-1");
      });
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("has no cancel button when nothing is pending", () => {
      renderDialog();
      expect(screen.queryByRole("button", { name: "Cancel charge" }))
        .toBeNull();
    });
  });
});
