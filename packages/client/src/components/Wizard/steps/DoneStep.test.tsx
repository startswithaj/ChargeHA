import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { doneStep } from "./DoneStep.tsx";
import { trpc } from "../../../trpc.ts";
import type { StepProps } from "../flow.ts";
import { StepNextHarness } from "./test-helpers/StepNextHarness.tsx";

const { mockCompleteMutate, captured } = vi.hoisted(() => ({
  mockCompleteMutate: vi.fn(),
  captured: { completeOnSuccess: undefined as (() => void) | undefined },
}));

vi.mock("../../../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    tesla: {
      getConfig: {
        useQuery: vi.fn(() => ({ data: {}, isLoading: false, error: null })),
      },
    },
    auth: {
      session: {
        useQuery: vi.fn(() => ({
          data: { authenticated: false, authMode: "none" },
          isLoading: false,
          error: null,
        })),
      },
    },
    config: {
      system: {
        get: {
          useQuery: vi.fn(() => ({
            data: { timezone: "" },
            isLoading: false,
            error: null,
          })),
        },
      },
      equipment: {
        get: {
          useQuery: vi.fn(() => ({
            data: { energyAdapterType: "" },
            isLoading: false,
            error: null,
          })),
        },
      },
      home: {
        get: {
          useQuery: vi.fn(() => ({
            data: { homeLatitude: null, homeLongitude: null },
            isLoading: false,
            error: null,
          })),
        },
      },
    },
    vehicle: {
      list: {
        useQuery: vi.fn(() => ({
          data: { vehicles: [] },
          isLoading: false,
          error: null,
        })),
      },
    },
    wizard: {
      complete: {
        useMutation: vi.fn((opts?: { onSuccess?: () => void }) => {
          captured.completeOnSuccess = opts?.onSuccess;
          return {
            mutate: mockCompleteMutate,
            isPending: false,
            isError: false,
            error: null,
          };
        }),
      },
    },
    useUtils: vi.fn(() => ({
      wizard: {
        status: {
          invalidate: vi.fn().mockResolvedValue(undefined),
          setData: vi.fn(),
        },
      },
    })),
  },
}));

// ---- Tests ----

describe("DoneStep", () => {
  const makeStepProps = (overrides: Partial<StepProps> = {}): StepProps => ({
    onAdvance: vi.fn(),
    onBack: vi.fn(),
    onSkipTo: vi.fn(),
    onSkipToEnd: vi.fn(),
    ...overrides,
  });

  const makeVehicle = (overrides: Record<string, unknown> = {}) => ({
    id: "VIN1",
    name: "Model 3",
    adapterType: "tesla",
    priority: 1,
    config: "{}",
    mode: "solar",
    state: null,
    ...overrides,
  });

  let originalPushState: typeof globalThis.history.pushState;
  let originalDispatchEvent: typeof globalThis.dispatchEvent;

  beforeEach(() => {
    vi.clearAllMocks();
    captured.completeOnSuccess = undefined;
    originalPushState = globalThis.history.pushState;
    originalDispatchEvent = globalThis.dispatchEvent;
    globalThis.history.pushState = vi.fn();
    globalThis.dispatchEvent = vi.fn();
  });

  afterEach(() => {
    globalThis.history.pushState = originalPushState;
    globalThis.dispatchEvent = originalDispatchEvent;
    cleanup();
  });

  // ---- Initial render ----

  it("renders summary checklist", async () => {
    vi.mocked(trpc.auth.session.useQuery).mockReturnValue({
      data: { authenticated: true, authMode: "local" },
      isLoading: false,
      error: null,
    } as never);
    vi.mocked(trpc.config.system.get.useQuery).mockReturnValue({
      data: { timezone: "Australia/Sydney" },
      isLoading: false,
      error: null,
    } as never);
    vi.mocked(trpc.config.equipment.get.useQuery).mockReturnValue({
      data: { energyAdapterType: "fronius_local" },
      isLoading: false,
      error: null,
    } as never);
    vi.mocked(trpc.config.home.get.useQuery).mockReturnValue({
      data: { homeLatitude: -33.868820, homeLongitude: 151.209290 },
      isLoading: false,
      error: null,
    } as never);
    vi.mocked(trpc.vehicle.list.useQuery).mockReturnValue({
      data: { vehicles: [makeVehicle()] },
      isLoading: false,
      error: null,
    } as never);

    renderWithProviders(
      <StepNextHarness def={doneStep} stepProps={makeStepProps()} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Authentication configured")).toBeInTheDocument();
    });

    expect(screen.getByText("Timezone configured")).toBeInTheDocument();
    expect(screen.getByText("Vehicle connected")).toBeInTheDocument();
    expect(screen.getByText("Energy source configured")).toBeInTheDocument();
    expect(screen.getByText("Home location set")).toBeInTheDocument();
  });

  it("shows checkmarks for completed items", async () => {
    vi.mocked(trpc.auth.session.useQuery).mockReturnValue({
      data: { authenticated: true, authMode: "local" },
      isLoading: false,
      error: null,
    } as never);
    vi.mocked(trpc.config.system.get.useQuery).mockReturnValue({
      data: { timezone: "Australia/Sydney" },
      isLoading: false,
      error: null,
    } as never);
    vi.mocked(trpc.config.equipment.get.useQuery).mockReturnValue({
      data: { energyAdapterType: "fronius_local" },
      isLoading: false,
      error: null,
    } as never);
    vi.mocked(trpc.config.home.get.useQuery).mockReturnValue({
      data: { homeLatitude: -33.868820, homeLongitude: 151.209290 },
      isLoading: false,
      error: null,
    } as never);
    vi.mocked(trpc.vehicle.list.useQuery).mockReturnValue({
      data: { vehicles: [makeVehicle()] },
      isLoading: false,
      error: null,
    } as never);

    renderWithProviders(
      <StepNextHarness def={doneStep} stepProps={makeStepProps()} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Setup Complete!")).toBeInTheDocument();
    });

    // All items completed — no warning callout
    expect(screen.queryByText(/steps were skipped/)).not.toBeInTheDocument();
    expect(screen.queryByText(/step was skipped/)).not.toBeInTheDocument();
  });

  it("shows warnings for skipped items", async () => {
    vi.mocked(trpc.config.system.get.useQuery).mockReturnValue({
      data: { timezone: "Australia/Sydney" },
      isLoading: false,
      error: null,
    } as never);
    vi.mocked(trpc.config.equipment.get.useQuery).mockReturnValue({
      data: { energyAdapterType: "" },
      isLoading: false,
      error: null,
    } as never);
    vi.mocked(trpc.config.home.get.useQuery).mockReturnValue({
      data: { homeLatitude: null, homeLongitude: null },
      isLoading: false,
      error: null,
    } as never);
    vi.mocked(trpc.vehicle.list.useQuery).mockReturnValue({
      data: { vehicles: [] },
      isLoading: false,
      error: null,
    } as never);

    renderWithProviders(
      <StepNextHarness def={doneStep} stepProps={makeStepProps()} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Setup Complete!")).toBeInTheDocument();
    });

    // Should show warning about skipped steps
    await waitFor(() => {
      expect(screen.getByText(/steps were skipped/)).toBeInTheDocument();
    });

    expect(screen.getByText(/You can configure these later in Settings/))
      .toBeInTheDocument();
  });

  // ---- Authentication checklist item ----

  it.each<[string, boolean, "local" | "oidc" | "none", string]>([
    ["local", true, "local", "Authentication configured"],
    ["oidc", true, "oidc", "Authentication configured"],
    ["none", false, "none", "No authentication configured"],
  ])(
    "shows auth checklist text for authMode=%s",
    async (_label, authenticated, authMode, expected) => {
      vi.mocked(trpc.auth.session.useQuery).mockReturnValue({
        data: { authenticated, authMode },
        isLoading: false,
        error: null,
      } as never);

      renderWithProviders(
        <StepNextHarness def={doneStep} stepProps={makeStepProps()} />,
      );

      await waitFor(() => {
        expect(screen.getByText(expected)).toBeInTheDocument();
      });
    },
  );

  it("auth Edit button navigates to authentication step", async () => {
    vi.mocked(trpc.auth.session.useQuery).mockReturnValue({
      data: { authenticated: true, authMode: "local" },
      isLoading: false,
      error: null,
    } as never);

    const onSkipTo = vi.fn();
    renderWithProviders(
      <StepNextHarness
        def={doneStep}
        stepProps={makeStepProps({ onSkipTo })}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Authentication configured")).toBeInTheDocument();
    });

    // The auth checklist item is the first one — click its Edit button
    const editButtons = screen.getAllByRole("button", { name: /Edit/ });
    fireEvent.click(editButtons[0]);

    // By id, not position — indices shift with the selected plugins.
    expect(onSkipTo).toHaveBeenCalledWith("authentication");
  });

  it.each([
    [1, "timezone"],
    [2, "vehicle-type"],
    [3, "inverter-type"],
    [4, "home-location"],
  ])(
    "checklist item %i edits the %s step",
    async (index, stepId) => {
      const onSkipTo = vi.fn();
      renderWithProviders(
        <StepNextHarness
          def={doneStep}
          stepProps={makeStepProps({ onSkipTo })}
        />,
      );

      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: /Edit/ })).toHaveLength(5);
      });

      fireEvent.click(screen.getAllByRole("button", { name: /Edit/ })[index]);

      expect(onSkipTo).toHaveBeenCalledWith(stepId);
    },
  );

  // ---- API calls ----

  it("'Go to Dashboard' calls wizard.complete and navigates to /", async () => {
    vi.mocked(trpc.config.system.get.useQuery).mockReturnValue({
      data: { timezone: "UTC" },
      isLoading: false,
      error: null,
    } as never);
    vi.mocked(trpc.vehicle.list.useQuery).mockReturnValue({
      data: { vehicles: [] },
      isLoading: false,
      error: null,
    } as never);

    // Wire mutate -> onSuccess so both halves of the flow run.
    mockCompleteMutate.mockImplementation(() => {
      captured.completeOnSuccess?.();
    });

    renderWithProviders(
      <StepNextHarness def={doneStep} stepProps={makeStepProps()} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Setup Complete!")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Go to Dashboard/ }));

    await waitFor(() => {
      expect(mockCompleteMutate).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(globalThis.history.pushState).toHaveBeenCalledWith(null, "", "/");
    });
  });
});
