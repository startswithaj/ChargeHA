import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { VehicleTypeStep } from "./VehicleTypeStep.tsx";

const {
  mockSetStepId,
  mockCommitSelection,
  mockDemoMutate,
  captured,
  mockVehicleList,
} = vi
  .hoisted(() => ({
    mockSetStepId: vi.fn(),
    mockCommitSelection: vi.fn(),
    mockDemoMutate: vi.fn(),
    captured: { demoOnSuccess: undefined as (() => void) | undefined },
    mockVehicleList: vi.fn(() => ({
      data: { vehicles: [] as { adapterType: string }[] },
    })),
  }));

vi.mock("../../../hooks/useWizardState.ts", () => ({
  useWizardState: vi.fn(() => ({
    stepId: "vehicle-type",
    vehicleType: null,
    setStepId: mockSetStepId,
    commitSelection: mockCommitSelection,
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
    renderWithProviders(<VehicleTypeStep />);

    expect(screen.getByRole("button", { name: /Tesla/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Simulated/ }))
      .toBeInTheDocument();
    expect(screen.getByText(/Tesla Fleet API/)).toBeInTheDocument();
    expect(screen.getByText(/virtual vehicle for testing/))
      .toBeInTheDocument();
  });

  it("disables Tesla but not Simulated in demo mode", () => {
    mockIsDemoMode.mockReturnValue(true);
    renderWithProviders(<VehicleTypeStep />);

    expect(screen.getByRole("button", { name: /Tesla/ }))
      .toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: /Simulated/ }))
      .toHaveAttribute("aria-disabled", "false");
  });

  // ---- User interactions ----

  it("selecting Tesla navigates to tesla-key-generation step", () => {
    renderWithProviders(<VehicleTypeStep />);

    fireEvent.click(screen.getByRole("button", { name: /Tesla/ }));

    expect(mockCommitSelection).toHaveBeenCalledWith({
      vehicleType: "tesla",
      stepId: "tesla-key-generation",
    });
  });

  it("selecting Simulated calls demoSetup mutation and navigates to inverter-type", () => {
    renderWithProviders(<VehicleTypeStep />);

    fireEvent.click(screen.getByRole("button", { name: /Simulated/ }));

    expect(mockDemoMutate).toHaveBeenCalledWith({ adapterType: "simulated" });
    expect(mockCommitSelection).toHaveBeenCalledWith({
      vehicleType: "simulated",
      stepId: "inverter-type",
    });
  });

  it("reselecting the already-configured vehicle type proceeds without recreating it", () => {
    mockVehicleList.mockReturnValue({
      data: { vehicles: [{ adapterType: "simulated" }] },
    });
    renderWithProviders(<VehicleTypeStep />);

    fireEvent.click(screen.getByRole("button", { name: /Simulated/ }));

    expect(mockDemoMutate).not.toHaveBeenCalled();
    expect(mockCommitSelection).toHaveBeenCalledWith({
      vehicleType: "simulated",
      stepId: "inverter-type",
    });
  });
});
