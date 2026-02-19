import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../../../client/src/test-utils.tsx";
import { TeslaCredentialsStep } from "./TeslaCredentialsStep.tsx";
import { trpc } from "./trpc.ts";
import { makeStepProps } from "./test-helpers/stepProps.ts";

const mocks = vi.hoisted(() => {
  const mutate = vi.fn();
  return {
    mutate,
    defaultResult: {
      mutate,
      mutateAsync: vi.fn(),
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
      tesla: {
        getConfig: {
          invalidate: vi.fn(),
        },
      },
    })),
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
    },
    wizard: {
      tunnelStatus: {
        useQuery: vi.fn(() => ({
          data: { active: false, url: null },
          isLoading: false,
        })),
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
  function setSetConfigState(
    overrides: Partial<typeof mocks.defaultResult>,
  ): void {
    vi.mocked(trpc.tesla.setConfig.useMutation).mockReturnValue({
      ...mocks.defaultResult,
      mutate: mocks.mutate,
      ...overrides,
    } as never);
  }

  function setTunnelActive(url: string): void {
    vi.mocked(trpc.wizard.tunnelStatus.useQuery).mockReturnValue({
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
    renderWithProviders(<TeslaCredentialsStep {...makeStepProps()} />);

    expect(screen.getByLabelText("Client ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Client Secret")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Region" }))
      .toBeInTheDocument();
  });

  it("renders setup instructions, allowed origin, and redirect URI", () => {
    renderWithProviders(<TeslaCredentialsStep {...makeStepProps()} />);

    expect(screen.getByText(/developer\.tesla\.com/)).toBeInTheDocument();
    expect(screen.getByText(/Create Application/)).toBeInTheDocument();
    expect(screen.getByText(/Authorization Code and Machine-to-Machine/))
      .toBeInTheDocument();
    expect(screen.getByText(/Vehicle Information/)).toBeInTheDocument();
    expect(screen.getByText(/Vehicle Location/)).toBeInTheDocument();
    expect(screen.getByText(/Vehicle Charging Management/)).toBeInTheDocument();
    expect(screen.getByText(/Allowed Origin URLs/)).toBeInTheDocument();
    expect(screen.getByText(/Allowed Redirect URIs/)).toBeInTheDocument();
  });

  // ---- User interactions ----

  it.each([
    ["NA", /NA \(North America/],
    ["EU", /EU \(Europe/],
    ["CN", /CN \(China\)/],
  ])("Region dropdown shows %s option", async (_label, expected) => {
    renderWithProviders(<TeslaCredentialsStep {...makeStepProps()} />);

    fireEvent.click(screen.getByRole("combobox", { name: "Region" }));

    await waitFor(() => {
      // Radix Select duplicates selected option text — use getAllByText
      expect(screen.getAllByText(expected).length).toBeGreaterThanOrEqual(1);
    });
  });

  // ---- Validation ----

  it("Save button is disabled when required fields are empty", () => {
    renderWithProviders(<TeslaCredentialsStep {...makeStepProps()} />);

    const saveButton = screen.getByRole("button", { name: /Save & Continue/ });
    expect(saveButton).toBeDisabled();

    // Fill only client ID — still disabled
    fireEvent.change(screen.getByLabelText("Client ID"), {
      target: { value: "test-client-id" },
    });
    expect(saveButton).toBeDisabled();

    // Fill client secret too — now enabled
    fireEvent.change(screen.getByLabelText("Client Secret"), {
      target: { value: "ta-secret.test" },
    });
    expect(saveButton).not.toBeDisabled();
  });

  // ---- API calls ----

  it("clicking Save & Continue calls setConfig with credentials", async () => {
    renderWithProviders(
      <TeslaCredentialsStep {...makeStepProps()} />,
    );

    fireEvent.change(screen.getByLabelText("Client ID"), {
      target: { value: "test-client-id" },
    });
    fireEvent.change(screen.getByLabelText("Client Secret"), {
      target: { value: "ta-secret.test" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Save & Continue/ }));

    await waitFor(() => {
      expect(mocks.mutate).toHaveBeenCalledWith(
        {
          teslaClientId: "test-client-id",
          teslaClientSecret: "ta-secret.test",
          teslaRegion: "na",
        },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
    });
  });

  it("shows error message when save fails", async () => {
    setSetConfigState({
      isError: true,
      error: new Error("Failed to save config"),
    });

    renderWithProviders(<TeslaCredentialsStep {...makeStepProps()} />);

    await waitFor(() => {
      expect(screen.getByText("Failed to save config")).toBeInTheDocument();
    });
  });

  it("shows 'Saving...' while mutation is pending", async () => {
    setSetConfigState({ isPending: true });

    renderWithProviders(<TeslaCredentialsStep {...makeStepProps()} />);

    await waitFor(() => {
      expect(screen.getByText("Saving...")).toBeInTheDocument();
    });
  });

  // ---- Tunnel behavior ----

  it("uses tunnel URL for callout, allowed origin, and redirect URI", async () => {
    setTunnelActive("https://test-tunnel.trycloudflare.com");

    renderWithProviders(<TeslaCredentialsStep {...makeStepProps()} />);

    await waitFor(() => {
      expect(
        screen.getByText(/Cloudflare Tunnel is active/),
      ).toBeInTheDocument();
      expect(
        screen.getByText("https://test-tunnel.trycloudflare.com"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "https://test-tunnel.trycloudflare.com/api/vehicle/tesla/callback",
        ),
      ).toBeInTheDocument();
    });
  });
});
