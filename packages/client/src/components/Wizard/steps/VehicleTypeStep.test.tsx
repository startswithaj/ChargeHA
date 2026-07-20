import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { vehicleTypeStep } from "./VehicleTypeStep.tsx";
import { StepNextHarness } from "./test-helpers/StepNextHarness.tsx";

const { mockAdvance, mockDemoMutate, captured, mockVehicleList } = vi
  .hoisted(() => ({
    mockAdvance: vi.fn(),
    mockDemoMutate: vi.fn(),
    captured: { demoOnSuccess: undefined as (() => void) | undefined },
    mockVehicleList: vi.fn(() => ({
      data: { vehicles: [] as { adapterType: string }[] },
    })),
  }));

vi.mock("../../../hooks/useWizardState.ts", () => ({
  useWizardState: vi.fn(() => ({
    state: { stepId: "vehicle-type", vehicleType: "", energyType: "" },
    patch: vi.fn(),
    isLoading: false,
  })),
}));

vi.mock("../../../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    useUtils: vi.fn(() => ({
      vehicle: { list: { invalidate: vi.fn() } },
    })),
    tesla: {
      getConfig: {
        useQuery: vi.fn(() => ({ data: {}, isLoading: false, error: null })),
      },
    },
    vehicle: {
      list: { useQuery: mockVehicleList },
    },
    wizard: {
      demoSetup: {
        useMutation: vi.fn((opts?: { onSuccess?: () => void }) => {
          captured.demoOnSuccess = opts?.onSuccess;
          return {
            mutate: mockDemoMutate,
            isPending: false,
            isError: false,
            error: null,
          };
        }),
      },
    },
  },
}));

const { mockIsDemoMode } = vi.hoisted(() => ({
  mockIsDemoMode: vi.fn(() => false),
}));

vi.mock("../../../lib/featureFlags.ts", async (orig) => {
  const actual = await orig() as typeof import("../../../lib/featureFlags.ts");
  return {
    ...actual,
    demoMode: { ...actual.demoMode, isActive: mockIsDemoMode },
  };
});

// ---- Tests ----

describe("VehicleTypeStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDemoMode.mockReturnValue(false);
    mockVehicleList.mockReturnValue({ data: { vehicles: [] } });
    captured.demoOnSuccess = undefined;
    mockDemoMutate.mockImplementation(() => {
      captured.demoOnSuccess?.();
    });
  });

  afterEach(() => {
    cleanup();
  });

  // ---- Initial render ----

  it("renders the vehicle-type chooser with both options and descriptions", () => {
    renderWithProviders(
      <StepNextHarness def={vehicleTypeStep} onAdvance={mockAdvance} />,
    );

    expect(screen.getByRole("button", { name: /Tesla/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Simulated/ }))
      .toBeInTheDocument();
    expect(screen.getByText(/Tesla Fleet API/)).toBeInTheDocument();
    expect(screen.getByText(/virtual vehicle for testing/))
      .toBeInTheDocument();
  });

  it("disables Tesla but not Simulated in demo mode", () => {
    mockIsDemoMode.mockReturnValue(true);
    renderWithProviders(
      <StepNextHarness def={vehicleTypeStep} onAdvance={mockAdvance} />,
    );

    expect(screen.getByRole("button", { name: /Tesla/ }))
      .toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: /Simulated/ }))
      .toHaveAttribute("aria-disabled", "false");
  });

  // ---- User interactions ----

  it("selecting Tesla commits the selection without naming a next step", () => {
    renderWithProviders(
      <StepNextHarness def={vehicleTypeStep} onAdvance={mockAdvance} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Tesla/ }));

    // The step reports what was chosen; the flow decides where that leads.
    expect(mockAdvance).toHaveBeenCalledWith({ vehicleType: "tesla" });
  });

  it("selecting Simulated creates the demo vehicle before advancing", () => {
    renderWithProviders(
      <StepNextHarness def={vehicleTypeStep} onAdvance={mockAdvance} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Simulated/ }));

    expect(mockDemoMutate).toHaveBeenCalledWith({ adapterType: "simulated" });
    expect(mockAdvance).toHaveBeenCalledWith({ vehicleType: "simulated" });
  });

  it("does not advance when demo vehicle creation has not succeeded", () => {
    mockDemoMutate.mockImplementation(() => {});
    renderWithProviders(
      <StepNextHarness def={vehicleTypeStep} onAdvance={mockAdvance} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Simulated/ }));

    expect(mockDemoMutate).toHaveBeenCalled();
    expect(mockAdvance).not.toHaveBeenCalled();
  });

  it("Next commits the existing vehicle type when the wizard state has none", async () => {
    // A re-opened wizard clears wizard_vehicle_type but keeps the vehicle row,
    // so the card renders selected off the existing vehicle. Step membership
    // keys off state.vehicleType, so Next must write it — otherwise the flow
    // computes the next step against "" and skips the plugin's steps entirely.
    mockVehicleList.mockReturnValue({
      data: { vehicles: [{ adapterType: "tesla" }] },
    });
    renderWithProviders(
      <StepNextHarness def={vehicleTypeStep} onAdvance={mockAdvance} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Next/ }));

    // The step returns its selection from an async Next handler, so the move
    // lands a microtask later.
    await waitFor(() => {
      expect(mockAdvance).toHaveBeenCalledWith({ vehicleType: "tesla" });
    });
  });

  it("reselecting the already-configured vehicle type proceeds without recreating it", () => {
    mockVehicleList.mockReturnValue({
      data: { vehicles: [{ adapterType: "simulated" }] },
    });
    renderWithProviders(
      <StepNextHarness def={vehicleTypeStep} onAdvance={mockAdvance} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Simulated/ }));

    expect(mockDemoMutate).not.toHaveBeenCalled();
    expect(mockAdvance).toHaveBeenCalledWith({ vehicleType: "simulated" });
  });
});
