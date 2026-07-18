import "@testing-library/jest-dom/vitest";
import { assertExists } from "@std/assert";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { inverterTypeStep } from "./InverterTypeStep.tsx";
import { StepNextHarness } from "./test-helpers/StepNextHarness.tsx";

const { mockMutate, mockAdvance } = vi.hoisted(() => ({
  mockMutate: vi.fn(),
  mockAdvance: vi.fn(),
}));

vi.mock("../../../hooks/useWizardState.ts", () => ({
  useWizardState: vi.fn(() => ({
    state: { stepId: "inverter-type", vehicleType: "", energyType: "" },
    patch: vi.fn(),
    isLoading: false,
  })),
}));

vi.mock("../wizardAdvance.ts", () => ({
  useWizardAdvance: vi.fn(() => mockAdvance),
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

describe("InverterTypeStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDemoMode.mockReturnValue(false);
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

  it("disables Fronius options in demo mode", () => {
    mockIsDemoMode.mockReturnValue(true);
    renderWithProviders(<StepNextHarness def={inverterTypeStep} />);

    const local = screen.getByText("Fronius (Local)").closest(
      '[role="button"]',
    );
    assertExists(local);
    expect(local).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(local);
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("renders three options: Fronius Local, Fronius Cloud, None/Skip", () => {
    renderWithProviders(<StepNextHarness def={inverterTypeStep} />);

    expect(screen.getByText("Fronius (Local)")).toBeInTheDocument();
    expect(
      screen.getByText("Fronius (Cloud / Solar.web)"),
    ).toBeInTheDocument();
    expect(screen.getByText("None / Skip")).toBeInTheDocument();
  });

  // ---- User interactions / API calls ----

  it("selecting None persists an empty adapter type and advances", async () => {
    renderWithProviders(<StepNextHarness def={inverterTypeStep} />);

    fireEvent.click(screen.getByText("None / Skip"));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        { energyAdapterType: "" },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
    });

    // "" is a real selection, not an absent one — it advances like any other.
    expect(mockAdvance).toHaveBeenCalledWith({ energyType: "" });
  });

  it.each<[string, string]>([
    ["Fronius (Local)", "fronius_local"],
    ["Fronius (Cloud / Solar.web)", "fronius_cloud"],
  ])(
    "selecting %s persists adapter %s and commits it without naming a next step",
    async (label, adapterType) => {
      renderWithProviders(<StepNextHarness def={inverterTypeStep} />);

      fireEvent.click(screen.getByText(label));

      await waitFor(() => {
        expect(mockMutate).toHaveBeenCalledWith(
          { energyAdapterType: adapterType },
          expect.objectContaining({ onSuccess: expect.any(Function) }),
        );
      });

      // The step reports what was chosen; the flow decides where that leads.
      expect(mockAdvance).toHaveBeenCalledWith({ energyType: adapterType });
    },
  );

  it("does not advance when persisting the adapter fails", () => {
    mockMutate.mockImplementation(() => {});
    renderWithProviders(<StepNextHarness def={inverterTypeStep} />);

    fireEvent.click(screen.getByText("Fronius (Local)"));

    expect(mockMutate).toHaveBeenCalled();
    expect(mockAdvance).not.toHaveBeenCalled();
  });
});
