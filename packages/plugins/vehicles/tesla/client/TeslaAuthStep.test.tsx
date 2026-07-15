import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../../../client/src/test-utils.tsx";
import { TeslaAuthStep } from "./TeslaAuthStep.tsx";
import { StepNextHarness } from "../../../../client/src/components/Wizard/steps/test-helpers/StepNextHarness.tsx";
import { makeStepProps } from "./test-helpers/stepProps.ts";

const mocks = vi.hoisted(() => ({
  getAuthUrlMutate: vi.fn(),
  teslaStatusUseQuery: vi.fn(),
  capturedOnSuccess: { current: undefined } as {
    current: ((data: { url: string; state: string }) => void) | undefined;
  },
  capturedOnError: { current: undefined } as {
    current: (() => void) | undefined;
  },
  authUrlError: { current: null } as {
    current: { message: string } | null;
  },
}));

vi.mock("./trpc.ts", () => ({
  trpc: {
    plugin: {
      vehicle: {
        tesla: {
          teslaStatus: {
            useQuery: (...args: unknown[]) =>
              mocks.teslaStatusUseQuery(...args),
          },
          getAuthUrl: {
            useMutation: vi.fn((opts?: {
              onSuccess?: (data: { url: string; state: string }) => void;
              onError?: () => void;
            }) => {
              mocks.capturedOnSuccess.current = opts?.onSuccess;
              mocks.capturedOnError.current = opts?.onError;
              return {
                mutate: mocks.getAuthUrlMutate,
                error: mocks.authUrlError.current,
                isPending: false,
                reset: vi.fn(),
              };
            }),
          },
          tunnelStatus: {
            useQuery: vi.fn(() => ({
              data: { active: false, url: null },
              isLoading: false,
            })),
          },
        },
      },
    },
  },
}));

// ---- Tests ----

describe("TeslaAuthStep", () => {
  let originalOpen: typeof globalThis.open;

  function setTeslaStatus(
    overrides: { authenticated?: boolean; hasCredentials?: boolean } = {},
  ): void {
    mocks.teslaStatusUseQuery.mockReturnValue({
      data: {
        authenticated: false,
        hasCredentials: true,
        ...overrides,
      },
      isLoading: false,
      error: null,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.capturedOnSuccess.current = undefined;
    mocks.capturedOnError.current = undefined;
    mocks.authUrlError.current = null;
    originalOpen = globalThis.open;
    globalThis.open = vi.fn();

    setTeslaStatus();

    // Default: mutate triggers onSuccess
    mocks.getAuthUrlMutate.mockImplementation(() => {
      mocks.capturedOnSuccess.current?.({
        url: "https://auth.tesla.com/oauth2/v3/authorize?client_id=test",
        state: "test-state",
      });
    });
  });

  afterEach(() => {
    globalThis.open = originalOpen;
    cleanup();
  });

  // ---- Initial render ----

  it("renders authorization button in idle state", () => {
    renderWithProviders(<TeslaAuthStep {...makeStepProps()} />);

    expect(
      screen.getByRole("button", { name: /Authorize with Tesla/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Authorize ChargeHA to access your Tesla account/))
      .toBeInTheDocument();
  });

  // ---- User interactions / API calls ----

  it("clicking Authorize calls mutation, opens new window, and shows polling", async () => {
    renderWithProviders(<TeslaAuthStep {...makeStepProps()} />);

    fireEvent.click(
      screen.getByRole("button", { name: /Authorize with Tesla/ }),
    );

    await waitFor(() => {
      expect(mocks.getAuthUrlMutate).toHaveBeenCalledTimes(1);
      expect(globalThis.open).toHaveBeenCalledWith(
        "https://auth.tesla.com/oauth2/v3/authorize?client_id=test",
        "_blank",
      );
      expect(screen.getByText(/Waiting for authentication/))
        .toBeInTheDocument();
    });
  });

  it("enables Next when already authenticated", async () => {
    setTeslaStatus({ authenticated: true });

    const onNext = vi.fn();
    renderWithProviders(
      <StepNextHarness onAdvance={onNext}>
        <TeslaAuthStep {...makeStepProps({ onNext })} />
      </StepNextHarness>,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Tesla account authorized successfully/),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("shows error state when auth URL mutation fails", async () => {
    mocks.authUrlError.current = { message: "Failed to start authorization" };
    mocks.getAuthUrlMutate.mockImplementation(() => {
      mocks.capturedOnError.current?.();
    });

    renderWithProviders(<TeslaAuthStep {...makeStepProps()} />);

    fireEvent.click(
      screen.getByRole("button", { name: /Authorize with Tesla/ }),
    );

    await waitFor(() => {
      expect(screen.getByText("Failed to start authorization"))
        .toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /Try Again/ }))
      .toBeInTheDocument();
  });

  // ---- Tunnel behavior ----

  it("uses the stable browser origin even when a tunnel is active", async () => {
    const { trpc } = await import("./trpc.ts");
    vi.mocked(trpc.plugin.vehicle.tesla.tunnelStatus.useQuery).mockReturnValue({
      data: { active: true, url: "https://test-tunnel.trycloudflare.com" },
      isLoading: false,
    } as never);

    renderWithProviders(<TeslaAuthStep {...makeStepProps()} />);

    fireEvent.click(
      screen.getByRole("button", { name: /Authorize with Tesla/ }),
    );

    // jsdom origin is localhost (stable) — the tunnel must NOT hijack OAuth.
    await waitFor(() => {
      expect(mocks.getAuthUrlMutate).toHaveBeenCalledWith({
        origin: globalThis.location.origin,
      });
    });
  });

  it("Try Again button retries the auth flow", async () => {
    // First call triggers error
    mocks.getAuthUrlMutate.mockImplementationOnce(() => {
      mocks.capturedOnError.current?.();
    });

    renderWithProviders(<TeslaAuthStep {...makeStepProps()} />);

    fireEvent.click(
      screen.getByRole("button", { name: /Authorize with Tesla/ }),
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Try Again/ }))
        .toBeInTheDocument();
    });

    // Retry calls mutate again
    fireEvent.click(screen.getByRole("button", { name: /Try Again/ }));

    await waitFor(() => {
      expect(mocks.getAuthUrlMutate).toHaveBeenCalledTimes(2);
    });
  });
});
