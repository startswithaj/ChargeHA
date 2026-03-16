import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { VehicleTypeStep } from "./VehicleTypeStep.tsx";
import type { StepProps } from "../WizardShell.tsx";

const { mockSetStepId, mockSetVehicleType, mockDemoMutate, captured } = vi
  .hoisted(() => ({
    mockSetStepId: vi.fn(),
    mockSetVehicleType: vi.fn(),
    mockDemoMutate: vi.fn(),
    captured: { demoOnSuccess: undefined as (() => void) | undefined },
  }));

vi.mock("../../../hooks/useWizardState.ts", () => ({
  useWizardState: vi.fn(() => ({
    stepId: "vehicle-type",
    vehicleType: null,
    setStepId: mockSetStepId,
    setVehicleType: mockSetVehicleType,
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

// ---- Tests ----

describe("VehicleTypeStep", () => {
  const makeStepProps = (overrides: Partial<StepProps> = {}): StepProps => ({
    onNext: vi.fn(),
    onBack: vi.fn(),
    onSkip: vi.fn(),
    onSkipTo: vi.fn(),
    onSkipToEnd: vi.fn(),
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
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
    renderWithProviders(<VehicleTypeStep {...makeStepProps()} />);

    expect(screen.getByRole("button", { name: /Tesla/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Simulated/ }))
      .toBeInTheDocument();
    expect(screen.getByText(/Tesla Fleet API/)).toBeInTheDocument();
    expect(screen.getByText(/virtual vehicle for testing/))
      .toBeInTheDocument();
  });

  // ---- User interactions ----

  it("selecting Tesla navigates to tesla-key-generation step", () => {
    renderWithProviders(<VehicleTypeStep {...makeStepProps()} />);

    fireEvent.click(screen.getByRole("button", { name: /Tesla/ }));

    expect(mockSetVehicleType).toHaveBeenCalledWith("tesla");
    expect(mockSetStepId).toHaveBeenCalledWith("tesla-key-generation");
  });

  it("selecting Simulated calls demoSetup mutation and navigates to inverter-type", () => {
    renderWithProviders(<VehicleTypeStep {...makeStepProps()} />);

    fireEvent.click(screen.getByRole("button", { name: /Simulated/ }));

    expect(mockDemoMutate).toHaveBeenCalledWith({ adapterType: "simulated" });
    expect(mockSetVehicleType).toHaveBeenCalledWith("simulated");
    expect(mockSetStepId).toHaveBeenCalledWith("inverter-type");
  });
});
