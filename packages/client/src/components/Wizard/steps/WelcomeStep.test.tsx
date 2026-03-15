import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { WelcomeStep } from "./WelcomeStep.tsx";
import { trpc } from "../../../trpc.ts";
import type { StepProps } from "../WizardShell.tsx";

const { mockDemoSetupMutate, mockCompleteMutate, captured } = vi.hoisted(
  () => ({
    mockDemoSetupMutate: vi.fn(),
    mockCompleteMutate: vi.fn(),
    captured: { demoOnSuccess: undefined as (() => void) | undefined },
  }),
);

vi.mock("../../../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    wizard: {
      demoSetup: {
        useMutation: vi.fn(() => ({
          mutate: mockDemoSetupMutate,
          isPending: false,
          error: null,
          reset: vi.fn(),
        })),
      },
      complete: {
        useMutation: vi.fn((opts?: { onSuccess?: () => void }) => {
          captured.demoOnSuccess = opts?.onSuccess;
          return {
            mutate: mockCompleteMutate,
            isPending: false,
            error: null,
            reset: vi.fn(),
          };
        }),
      },
    },
    vehicle: {
      list: {
        invalidate: vi.fn(),
      },
    },
    useUtils: vi.fn(() => ({
      vehicle: {
        list: {
          invalidate: vi.fn(),
        },
      },
    })),
  },
}));

// ---- Tests ----

describe("WelcomeStep", () => {
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
    // Default: demoSetup calls its onSuccess which triggers complete
    mockDemoSetupMutate.mockImplementation(
      (_input: unknown, opts?: { onSuccess?: () => void }) => {
        opts?.onSuccess?.();
      },
    );
    mockCompleteMutate.mockImplementation(() => {
      captured.demoOnSuccess?.();
    });
  });

  afterEach(() => {
    cleanup();
  });

  // ---- Initial render ----

  it("renders welcome content: logo, copy, both buttons, both descriptions", () => {
    renderWithProviders(<WelcomeStep {...makeStepProps()} />);

    expect(screen.getByAltText("ChargeHA")).toBeInTheDocument();
    expect(screen.getByText(/ChargeHA is a smart home charging controller/))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Full Setup/ }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Demo Mode/ }))
      .toBeInTheDocument();
    expect(screen.getByText(/guides you through connecting/))
      .toBeInTheDocument();
    expect(screen.getByText(/creates a simulated vehicle/))
      .toBeInTheDocument();
  });

  // ---- User interactions ----

  it("clicking 'Full Setup' calls onNext callback", () => {
    const onNext = vi.fn();
    renderWithProviders(<WelcomeStep {...makeStepProps({ onNext })} />);

    fireEvent.click(screen.getByRole("button", { name: /Full Setup/ }));

    expect(onNext).toHaveBeenCalledTimes(1);
  });

  // ---- API calls ----

  it("clicking 'Demo Mode' calls demo setup then complete then onSkipToEnd", async () => {
    const onSkipToEnd = vi.fn();
    renderWithProviders(<WelcomeStep {...makeStepProps({ onSkipToEnd })} />);

    fireEvent.click(screen.getByRole("button", { name: /Demo Mode/ }));

    await waitFor(() => {
      expect(mockDemoSetupMutate).toHaveBeenCalledTimes(1);
    });

    expect(mockCompleteMutate).toHaveBeenCalledTimes(1);
    expect(onSkipToEnd).toHaveBeenCalledTimes(1);
  });

  it("shows 'Setting up...' while demo mutation is pending", () => {
    // demoSetup never calls onSuccess — keeps pending state
    mockDemoSetupMutate.mockImplementation(() => {});

    vi.mocked(trpc.wizard.demoSetup.useMutation).mockReturnValue({
      mutate: mockDemoSetupMutate,
      isPending: true,
      error: null,
      reset: vi.fn(),
    } as never);

    renderWithProviders(<WelcomeStep {...makeStepProps()} />);

    expect(screen.getByText("Setting up...")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Setting up/ }),
    ).toBeDisabled();
  });

  it("shows error message when demo setup fails", () => {
    vi.mocked(trpc.wizard.demoSetup.useMutation).mockReturnValue({
      mutate: mockDemoSetupMutate,
      isPending: false,
      error: { message: "Setup failed" },
      reset: vi.fn(),
    } as never);

    renderWithProviders(<WelcomeStep {...makeStepProps()} />);

    expect(screen.getByText("Setup failed")).toBeInTheDocument();
  });
});
