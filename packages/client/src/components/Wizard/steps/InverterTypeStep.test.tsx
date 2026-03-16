import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { InverterTypeStep } from "./InverterTypeStep.tsx";
import type { StepProps } from "../WizardShell.tsx";

const { mockMutate, mockSetStepId, mockSetEnergyType } = vi.hoisted(() => ({
  mockMutate: vi.fn(),
  mockSetStepId: vi.fn(),
  mockSetEnergyType: vi.fn(),
}));

vi.mock("../../../hooks/useWizardState.ts", () => ({
  useWizardState: vi.fn(() => ({
    stepId: "inverter-type",
    vehicleType: "",
    energyType: "",
    setStepId: mockSetStepId,
    setVehicleType: vi.fn(),
    setEnergyType: mockSetEnergyType,
    isLoading: false,
  })),
}));

vi.mock("../../../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    useUtils: vi.fn(() => ({
      config: {
        equipment: { get: { invalidate: vi.fn() } },
      },
    })),
    tesla: {
      getConfig: {
        useQuery: vi.fn(() => ({ data: {}, isLoading: false, error: null })),
      },
    },
    config: {
      equipment: {
        get: {
          useQuery: vi.fn(() => ({ data: {}, isLoading: false, error: null })),
        },
        set: {
          useMutation: vi.fn(() => ({
            mutate: mockMutate,
            mutateAsync: vi.fn(),
            isPending: false,
            isSuccess: false,
            isError: false,
            error: null,
            data: undefined,
            reset: vi.fn(),
          })),
        },
      },
    },
  },
}));

// ---- Tests ----

describe("InverterTypeStep", () => {
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
    mockMutate.mockImplementation(
      (_input: unknown, opts?: { onSuccess?: () => void }) => {
        opts?.onSuccess?.();
      },
    );
  });

  afterEach(() => {
    cleanup();
  });

  // ---- Initial render ----

  it("renders three options: Fronius Local, Fronius Cloud, None/Skip", () => {
    renderWithProviders(<InverterTypeStep {...makeStepProps()} />);

    expect(screen.getByText("Fronius (Local)")).toBeInTheDocument();
    expect(
      screen.getByText("Fronius (Cloud / Solar.web)"),
    ).toBeInTheDocument();
    expect(screen.getByText("None / Skip")).toBeInTheDocument();
  });

  // ---- User interactions / API calls ----

  it("selecting None calls the equipment config mutation with empty adapter type", async () => {
    renderWithProviders(<InverterTypeStep {...makeStepProps()} />);

    fireEvent.click(screen.getByText("None / Skip"));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        { energyAdapterType: "" },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
    });

    expect(mockSetEnergyType).toHaveBeenCalledWith("");
    expect(mockSetStepId).toHaveBeenCalledWith("home-location");
  });

  it.each<[string, string, string]>([
    ["Fronius (Local)", "fronius_local", "fronius-local-setup"],
    ["Fronius (Cloud / Solar.web)", "fronius_cloud", "fronius-cloud-setup"],
  ])(
    "selecting %s persists adapter %s and navigates to %s",
    async (label, adapterType, nextStepId) => {
      renderWithProviders(<InverterTypeStep {...makeStepProps()} />);

      fireEvent.click(screen.getByText(label));

      await waitFor(() => {
        expect(mockMutate).toHaveBeenCalledWith(
          { energyAdapterType: adapterType },
          expect.objectContaining({ onSuccess: expect.any(Function) }),
        );
      });

      expect(mockSetEnergyType).toHaveBeenCalledWith(adapterType);
      expect(mockSetStepId).toHaveBeenCalledWith(nextStepId);
    },
  );
});
