import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../../../client/src/test-utils.tsx";
import { teslaCredentialsStep } from "./TeslaCredentialsStep.tsx";
import { StepNextHarness } from "../../../../client/src/components/Wizard/steps/test-helpers/StepNextHarness.tsx";
import { trpc } from "./trpc.ts";

const mocks = vi.hoisted(() => {
  const mutate = vi.fn();
  const mutateAsync = vi.fn();
  return {
    mutate,
    mutateAsync,
    defaultResult: {
      mutate,
      mutateAsync,
      isPending: false,
      isSuccess: false,
      isError: false,
      error: null as Error | null,
      data: undefined,
      reset: vi.fn(),
    },
  };
});

vi.mock("./trpc.ts", () => ({
  trpc: {
    useUtils: vi.fn(() => ({
      plugin: {
        vehicle: {
          tesla: {
            getConfig: {
              invalidate: vi.fn(),
            },
          },
        },
      },
    })),
    plugin: {
      vehicle: {
        tesla: {
          getConfig: {
            useQuery: vi.fn(() => ({
              data: {
                teslaClientId: "",
                teslaClientSecret: "",
                teslaRegion: "na",
              },
              isLoading: false,
              error: null,
            })),
          },
          setConfig: {
            useMutation: vi.fn(() => mocks.defaultResult),
          },
          teslaStatus: {
            useQuery: vi.fn(() => ({
              data: { authenticated: false, keyPaired: null },
              isLoading: false,
            })),
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

// Radix Select uses ScrollArea which requires ResizeObserver
globalThis.ResizeObserver = function ResizeObserver() {
  return {
    observe() {},
    unobserve() {},
    disconnect() {},
  };
} as unknown as typeof ResizeObserver;

// Radix Select calls scrollIntoView on focused items
Element.prototype.scrollIntoView = vi.fn();

// ---- Tests ----

describe("TeslaCredentialsStep", () => {
  function setTunnelActive(url: string): void {
    vi.mocked(trpc.plugin.vehicle.tesla.tunnelStatus.useQuery).mockReturnValue({
      data: { active: true, url },
      isLoading: false,
    } as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // ---- Initial render ----

  it("renders Client ID, Client Secret, and Region inputs", () => {
    renderWithProviders(<StepNextHarness def={teslaCredentialsStep} />);

    expect(screen.getByLabelText("Client ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Client Secret")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Region" }))
      .toBeInTheDocument();
  });

  it("renders setup instructions and the browser-origin redirect URI", () => {
    renderWithProviders(<StepNextHarness def={teslaCredentialsStep} />);

    expect(screen.getByText(/developer\.tesla\.com/)).toBeInTheDocument();
    expect(screen.getByText(/Create Application/)).toBeInTheDocument();
    expect(screen.getByText(/Authorization Code and Machine-to-Machine/))
      .toBeInTheDocument();
    expect(screen.getByText(/Vehicle Information/)).toBeInTheDocument();
    expect(screen.getByText(/Vehicle Location/)).toBeInTheDocument();
    expect(screen.getByText(/Vehicle Charging Management/)).toBeInTheDocument();
    expect(screen.getByText(/Allowed Redirect URI\(s\)/)).toBeInTheDocument();
    // jsdom origin is localhost — a stable origin, used directly.
    expect(
      screen.getByText(
        `${globalThis.location.origin}/api/vehicle/tesla/callback`,
      ),
    ).toBeInTheDocument();
  });

  // ---- User interactions ----

  it.each([
    ["NA", /NA \(North America/],
    ["EU", /EU \(Europe/],
    ["CN", /CN \(China\)/],
  ])("Region dropdown shows %s option", async (_label, expected) => {
    renderWithProviders(<StepNextHarness def={teslaCredentialsStep} />);

    fireEvent.click(screen.getByRole("combobox", { name: "Region" }));

    await waitFor(() => {
      // Radix Select duplicates selected option text — use getAllByText
      expect(screen.getAllByText(expected).length).toBeGreaterThanOrEqual(1);
    });
  });

  // ---- Validation ----

  it("Next is disabled when required fields are empty", () => {
    renderWithProviders(
      <StepNextHarness def={teslaCredentialsStep} onAdvance={vi.fn()} />,
    );

    const nextButton = screen.getByRole("button", { name: "Next" });
    expect(nextButton).toBeDisabled();
    expect(
      screen.getByText("Enter your Client ID and Client Secret to continue"),
    ).toBeInTheDocument();

    // Fill only client ID — still disabled
    fireEvent.change(screen.getByLabelText("Client ID"), {
      target: { value: "test-client-id" },
    });
    expect(nextButton).toBeDisabled();

    // Fill client secret too — now enabled
    fireEvent.change(screen.getByLabelText("Client Secret"), {
      target: { value: "ta-secret.test" },
    });
    expect(nextButton).not.toBeDisabled();
  });

  // ---- API calls ----

  it("clicking Next calls setConfig with credentials", async () => {
    const onNext = vi.fn();
    mocks.mutateAsync.mockResolvedValue({});
    renderWithProviders(
      <StepNextHarness def={teslaCredentialsStep} onAdvance={onNext} />,
    );

    fireEvent.change(screen.getByLabelText("Client ID"), {
      target: { value: "test-client-id" },
    });
    fireEvent.change(screen.getByLabelText("Client Secret"), {
      target: { value: "ta-secret.test" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        teslaClientId: "test-client-id",
        teslaClientSecret: "ta-secret.test",
        teslaRegion: "na",
      });
    });
    await waitFor(() => {
      expect(onNext).toHaveBeenCalledTimes(1);
    });
  });

  it("shows the reason beside Next when the save fails", async () => {
    mocks.mutateAsync.mockRejectedValue(new Error("Failed to save config"));

    renderWithProviders(<StepNextHarness def={teslaCredentialsStep} />);

    fireEvent.change(screen.getByLabelText("Client ID"), {
      target: { value: "test-client-id" },
    });
    fireEvent.change(screen.getByLabelText("Client Secret"), {
      target: { value: "ta-secret.test" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // The step throws the reason and stays put; the host renders it next to the
    // button that failed rather than each step rendering its own error block.
    expect(await screen.findByText("Failed to save config"))
      .toBeInTheDocument();
  });

  it("shows 'Saving...' on Next while the save is in flight", async () => {
    let resolveSave = (_v: unknown) => {};
    mocks.mutateAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );

    renderWithProviders(
      <StepNextHarness def={teslaCredentialsStep} onAdvance={vi.fn()} />,
    );

    fireEvent.change(screen.getByLabelText("Client ID"), {
      target: { value: "test-client-id" },
    });
    fireEvent.change(screen.getByLabelText("Client Secret"), {
      target: { value: "ta-secret.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(screen.getByText("Saving...")).toBeInTheDocument();
    });
    resolveSave({});
  });

  // ---- Tunnel behavior ----

  it("keeps the stable browser origin for OAuth even when a tunnel is active", async () => {
    setTunnelActive("https://test-tunnel.trycloudflare.com");

    renderWithProviders(<StepNextHarness def={teslaCredentialsStep} />);

    // jsdom origin is localhost (stable) — the tunnel must NOT hijack OAuth.
    await waitFor(() => {
      expect(
        screen.getByText(
          `${globalThis.location.origin}/api/vehicle/tesla/callback`,
        ),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByText(/Cloudflare Tunnel is active/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Allowed Returned URL\(s\)/),
    ).not.toBeInTheDocument();
  });
});
