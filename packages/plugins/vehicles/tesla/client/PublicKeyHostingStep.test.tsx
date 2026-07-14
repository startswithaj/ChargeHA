import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../../../client/src/test-utils.tsx";
import { PublicKeyHostingStep } from "./PublicKeyHostingStep.tsx";
import { trpc } from "./trpc.ts";
import { makeStepProps } from "./test-helpers/stepProps.ts";

const mocks = vi.hoisted(() => ({
  teslaSetConfigMutateAsync: vi.fn(),
}));

vi.mock("./trpc.ts", () => ({
  trpc: {
    tesla: {
      getConfig: {
        useQuery: vi.fn(() => ({
          data: { ecPublicKeyPem: "", teslaPublicKeyDomain: "" },
          isLoading: false,
          error: null,
        })),
      },
      setConfig: {
        useMutation: vi.fn(() => ({
          mutate: vi.fn(),
          mutateAsync: mocks.teslaSetConfigMutateAsync,
          isPending: false,
          isSuccess: false,
          isError: false,
          error: null,
          data: undefined,
          reset: vi.fn(),
        })),
      },
    },
    wizard: {
      tunnelStatus: {
        useQuery: vi.fn(() => ({
          data: { active: false, url: null },
          isLoading: false,
          refetch: vi.fn(),
        })),
      },
      startTunnel: {
        useMutation: vi.fn(() => ({
          mutate: vi.fn(),
          isPending: false,
          error: null,
        })),
      },
      stopTunnel: {
        useMutation: vi.fn(() => ({
          mutate: vi.fn(),
          isPending: false,
          error: null,
        })),
      },
    },
    useUtils: vi.fn(() => ({
      tesla: {
        getConfig: {
          invalidate: vi.fn(),
        },
      },
    })),
  },
}));

vi.mock("../../../../client/src/hooks/useConfig.ts", () => ({
  useConfig: vi.fn(() => ({ config: {}, isLoading: false })),
}));

// ---- Tests ----

describe("PublicKeyHostingStep", () => {
  const TEST_PUBLIC_KEY =
    "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEtest\n-----END PUBLIC KEY-----";

  let originalFetch: typeof globalThis.fetch;

  function setTunnel(active: boolean, url: string | null): void {
    vi.mocked(trpc.wizard.tunnelStatus.useQuery).mockReturnValue({
      data: { active, url },
      isLoading: false,
      refetch: vi.fn(),
    } as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;

    vi.mocked(trpc.tesla.getConfig.useQuery).mockReturnValue({
      data: {
        teslaPublicKeyDomain: "https://chargeha.example.com",
        ecPublicKeyPem: TEST_PUBLIC_KEY,
      },
      isLoading: false,
      error: null,
    } as never);

    setTunnel(false, null);

    mocks.teslaSetConfigMutateAsync.mockResolvedValue({});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllGlobals();
    cleanup();
  });

  // ---- Initial render ----

  it("renders internet-accessible yes/no question", async () => {
    renderWithProviders(<PublicKeyHostingStep {...makeStepProps()} />);

    await waitFor(() => {
      expect(
        screen.getByText(/Yes — ChargeHA is internet-accessible/),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/No — ChargeHA runs on my local network only/),
      ).toBeInTheDocument();
    });
  });

  // ---- User interactions ----

  /** The Yes flow needs an origin Tesla could reach — jsdom's localhost
   *  origin correctly disables it, so stub a public https origin. */
  const stubPublicOrigin = () =>
    vi.stubGlobal("location", {
      origin: "https://chargeha.example.com",
    } as Location);

  it("hints that Tesla likely can't reach an unreachable browser origin", () => {
    // jsdom origin is http://localhost:3000 — unreachable from Tesla.
    renderWithProviders(<PublicKeyHostingStep {...makeStepProps()} />);

    expect(screen.getByText(/likely can't fetch the key from this address/))
      .toBeInTheDocument();
    // Yes stays clickable — the hint advises, it doesn't block.
    expect(screen.getByLabelText("Yes, internet accessible"))
      .not.toHaveAttribute("aria-disabled", "true");
  });

  it("selecting Yes shows public key URL using browser origin", async () => {
    stubPublicOrigin();
    renderWithProviders(<PublicKeyHostingStep {...makeStepProps()} />);

    fireEvent.click(
      screen.getByLabelText("Yes, internet accessible"),
    );

    const expectedOrigin = globalThis.location.origin;
    await waitFor(() => {
      expect(
        screen.getByText(
          `${expectedOrigin}/.well-known/appspecific/com.tesla.3p.public-key.pem`,
        ),
      ).toBeInTheDocument();
    });
  });

  it("selecting No shows 3 hosting method options", async () => {
    renderWithProviders(<PublicKeyHostingStep {...makeStepProps()} />);

    fireEvent.click(
      screen.getByLabelText("No, not internet accessible"),
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Host it myself")).toBeInTheDocument();
      expect(screen.getByLabelText("Host on GitHub Pages")).toBeInTheDocument();
      expect(screen.getByLabelText("Set it up with AI")).toBeInTheDocument();
    });
  });

  it.each([
    ["Host it myself", /Host your public key on any static hosting service/],
    ["Host on GitHub Pages", /Host your public key on GitHub Pages/],
    ["Set it up with AI", /Copy this prompt and paste it into/],
  ])("%s shows method-specific instructions", async (label, expected) => {
    renderWithProviders(<PublicKeyHostingStep {...makeStepProps()} />);

    fireEvent.click(screen.getByLabelText("No, not internet accessible"));

    await waitFor(() => {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText(label));

    await waitFor(() => {
      expect(screen.getByText(expected)).toBeInTheDocument();
    });
  });

  // ---- API calls ----

  it("verify (Yes flow) fetches public key URL and shows success", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(TEST_PUBLIC_KEY),
    });
    globalThis.fetch = mockFetch;
    stubPublicOrigin();

    renderWithProviders(<PublicKeyHostingStep {...makeStepProps()} />);

    fireEvent.click(
      screen.getByLabelText("Yes, internet accessible"),
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Verify/ }))
        .toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Verify/ }));

    const expectedOrigin = globalThis.location.origin;
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        `${expectedOrigin}/.well-known/appspecific/com.tesla.3p.public-key.pem`,
        { cache: "no-store" },
      );
    });

    await waitFor(() => {
      expect(
        screen.getByText("Public key verified successfully."),
      ).toBeInTheDocument();
    });
  });

  // ---- Tunnel behavior ----

  it("shows tunnel auto-display when tunnel is active", async () => {
    setTunnel(true, "https://test-tunnel.trycloudflare.com");

    renderWithProviders(<PublicKeyHostingStep {...makeStepProps()} />);

    await waitFor(() => {
      expect(
        screen.getByText(
          /Your public key is being served via the Cloudflare Tunnel/,
        ),
      ).toBeInTheDocument();
    });

    // Yes/No cards should NOT be shown
    expect(
      screen.queryByLabelText("Yes, internet accessible"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("No, not internet accessible"),
    ).not.toBeInTheDocument();
  });

  it("shows 'Use Cloudflare Tunnel' as a hosting option in No flow", async () => {
    renderWithProviders(<PublicKeyHostingStep {...makeStepProps()} />);

    fireEvent.click(screen.getByLabelText("No, not internet accessible"));

    await waitFor(() => {
      expect(screen.getByLabelText("Use Cloudflare Tunnel"))
        .toBeInTheDocument();
      expect(screen.getByLabelText("Host it myself")).toBeInTheDocument();
      expect(screen.getByLabelText("Host on GitHub Pages")).toBeInTheDocument();
      expect(screen.getByLabelText("Set it up with AI")).toBeInTheDocument();
    });
  });

  it("selecting tunnel option shows Start Tunnel button", async () => {
    renderWithProviders(<PublicKeyHostingStep {...makeStepProps()} />);

    fireEvent.click(screen.getByLabelText("No, not internet accessible"));

    await waitFor(() => {
      expect(screen.getByLabelText("Use Cloudflare Tunnel"))
        .toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Use Cloudflare Tunnel"));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Start Tunnel/ }),
      ).toBeInTheDocument();
    });
  });

  // ---- API calls ----

  it("No flow: verify saves domain to tesla config before checking", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(TEST_PUBLIC_KEY),
    });
    globalThis.fetch = mockFetch;

    renderWithProviders(<PublicKeyHostingStep {...makeStepProps()} />);

    // Select No → Host it myself
    fireEvent.click(screen.getByLabelText("No, not internet accessible"));
    await waitFor(() => {
      expect(screen.getByLabelText("Host it myself")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText("Host it myself"));

    // Type a domain
    const input = await waitFor(() =>
      screen.getByPlaceholderText("https://example.com")
    );
    fireEvent.change(input, {
      target: { value: "https://myhost.example.com" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Verify/ }));

    await waitFor(() => {
      expect(mocks.teslaSetConfigMutateAsync).toHaveBeenCalledWith({
        teslaPublicKeyDomain: "https://myhost.example.com",
      });
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "https://myhost.example.com/.well-known/appspecific/com.tesla.3p.public-key.pem",
        { cache: "no-store" },
      );
    });
  });
});
