import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../../../client/src/test-utils.tsx";
import { VehicleSelectionStep } from "./VehicleSelectionStep.tsx";
import { StepNextHarness } from "../../../../client/src/components/Wizard/steps/test-helpers/StepNextHarness.tsx";
import { makeStepProps } from "./test-helpers/stepProps.ts";

const mocks = vi.hoisted(() => ({
  selectVehicleMutate: vi.fn().mockResolvedValue({ success: true }),
  setPriorityMutate: vi.fn().mockResolvedValue({ success: true }),
  teslaVehiclesUseQuery: vi.fn(),
  vehicleListUseQuery: vi.fn(),
}));

vi.mock("./trpc.ts", () => ({
  trpc: {
    tesla: {
      teslaVehicles: {
        useQuery: (...args: unknown[]) => mocks.teslaVehiclesUseQuery(...args),
      },
    },
    vehicle: {
      list: {
        useQuery: (...args: unknown[]) => mocks.vehicleListUseQuery(...args),
      },
    },
    useUtils: vi.fn(() => ({
      client: {
        tesla: {
          selectVehicle: {
            mutate: mocks.selectVehicleMutate,
          },
        },
        vehicle: {
          setPriority: {
            mutate: mocks.setPriorityMutate,
          },
        },
      },
      vehicle: {
        list: { invalidate: vi.fn(() => Promise.resolve()) },
      },
    })),
  },
}));

// ---- Tests ----

describe("VehicleSelectionStep", () => {
  const mockVehicles = [
    { vin: "5YJ3E1EA1LF000001", name: "My Model 3", state: "online" },
    { vin: "7SAYGDEE5PA000002", name: "Family Model Y", state: "asleep" },
  ];

  function setVehicles(vehicles: Array<typeof mockVehicles[number]>): void {
    mocks.teslaVehiclesUseQuery.mockReturnValue({
      data: { vehicles },
      isLoading: false,
      error: null,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    setVehicles(mockVehicles);
    mocks.vehicleListUseQuery.mockReturnValue({
      data: { vehicles: [] },
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  // ---- Initial render / loading ----

  it("shows loading state while discovering vehicles", () => {
    mocks.teslaVehiclesUseQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    renderWithProviders(<VehicleSelectionStep {...makeStepProps()} />);

    expect(screen.getByText("Discovering vehicles...")).toBeInTheDocument();
  });

  it("shows empty state when no vehicles found", async () => {
    setVehicles([]);

    renderWithProviders(<VehicleSelectionStep {...makeStepProps()} />);

    await waitFor(() => {
      expect(screen.getByText(/No vehicles found/)).toBeInTheDocument();
    });
  });

  it("displays vehicle list on mount", async () => {
    renderWithProviders(<VehicleSelectionStep {...makeStepProps()} />);

    await waitFor(() => {
      expect(screen.getByText("My Model 3")).toBeInTheDocument();
      expect(screen.getByText("Family Model Y")).toBeInTheDocument();
    });
  });

  it("renders name, VIN, and battery label", async () => {
    setVehicles([mockVehicles[0]]);

    renderWithProviders(<VehicleSelectionStep {...makeStepProps()} />);

    await waitFor(() => {
      expect(screen.getByText("My Model 3")).toBeInTheDocument();
      expect(screen.getByText(/5YJ3E1EA1LF000001/)).toBeInTheDocument();
      expect(screen.getByText(/Battery/)).toBeInTheDocument();
    });
  });

  // ---- User interactions ----

  it.each([
    [1, false],
    [2, true],
  ])(
    "priority input visibility for %i vehicle(s)",
    async (count, shouldShow) => {
      setVehicles(mockVehicles.slice(0, count));

      renderWithProviders(<VehicleSelectionStep {...makeStepProps()} />);

      await waitFor(() => {
        expect(screen.getByText("My Model 3")).toBeInTheDocument();
      });

      const priority = screen.queryByLabelText("Priority for My Model 3");
      expect(Boolean(priority)).toBe(shouldShow);
    },
  );

  // ---- API calls ----

  it("clicking Next saves selected vehicles via tRPC", async () => {
    const onNext = vi.fn();
    setVehicles([mockVehicles[0]]);

    renderWithProviders(
      <StepNextHarness onAdvance={onNext}>
        <VehicleSelectionStep {...makeStepProps({ onNext })} />
      </StepNextHarness>,
    );

    await waitFor(() => {
      expect(screen.getByText("My Model 3")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(mocks.selectVehicleMutate).toHaveBeenCalledWith({
        vin: "5YJ3E1EA1LF000001",
        name: "My Model 3",
      });
      expect(onNext).toHaveBeenCalled();
    });
  });

  it("sets priority for each vehicle when multiple are selected", async () => {
    const onNext = vi.fn();

    renderWithProviders(
      <StepNextHarness onAdvance={onNext}>
        <VehicleSelectionStep {...makeStepProps({ onNext })} />
      </StepNextHarness>,
    );

    await waitFor(() => {
      expect(screen.getByText("My Model 3")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(mocks.selectVehicleMutate).toHaveBeenCalledTimes(2);
      expect(mocks.setPriorityMutate).toHaveBeenCalledTimes(2);
      expect(onNext).toHaveBeenCalled();
    });
  });

  it("Next disabled when no vehicles selected", async () => {
    setVehicles([mockVehicles[0]]);

    renderWithProviders(
      <StepNextHarness onAdvance={vi.fn()}>
        <VehicleSelectionStep {...makeStepProps()} />
      </StepNextHarness>,
    );

    await waitFor(() => {
      expect(screen.getByText("My Model 3")).toBeInTheDocument();
    });

    // Uncheck the auto-selected vehicle
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Select My Model 3/ }),
    );

    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(
      screen.getByText("Select at least one vehicle to continue"),
    ).toBeInTheDocument();
  });
});
