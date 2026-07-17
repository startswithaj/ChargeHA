import "@testing-library/jest-dom/vitest";
import { assertExists } from "@std/assert";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { authStep } from "./AuthStep.tsx";
import { StepNextHarness } from "./test-helpers/StepNextHarness.tsx";
import type { StepProps } from "../flow.ts";

const {
  mockSetAuthModeMutateAsync,
  mockSaveOidcConfigMutateAsync,
  mockSessionRefetch,
} = vi.hoisted(() => ({
  mockSetAuthModeMutateAsync: vi.fn(),
  mockSaveOidcConfigMutateAsync: vi.fn(),
  mockSessionRefetch: vi.fn(),
}));

vi.mock("../../../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    wizard: {
      setAuthMode: {
        useMutation: vi.fn(() => ({
          mutateAsync: mockSetAuthModeMutateAsync,
          isPending: false,
          isError: false,
          error: null,
        })),
      },
      saveOidcConfig: {
        useMutation: vi.fn(() => ({
          mutateAsync: mockSaveOidcConfigMutateAsync,
          isPending: false,
          isError: false,
          error: null,
        })),
      },
    },
    auth: {
      session: {
        useQuery: vi.fn(() => ({
          data: null,
          refetch: mockSessionRefetch,
        })),
      },
    },
  },
}));

const { mockIsFeatureEnabled } = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn(() => true),
}));

vi.mock("../../../lib/featureFlags.ts", async (orig) => {
  const actual = await orig() as typeof import("../../../lib/featureFlags.ts");
  return {
    ...actual,
    demoMode: { ...actual.demoMode, allows: mockIsFeatureEnabled },
  };
});

// ---- Tests ----

describe("AuthStep", () => {
  const makeStepProps = (overrides: Partial<StepProps> = {}): StepProps => ({
    onNext: vi.fn(),
    onBack: vi.fn(),
    onSkipTo: vi.fn(),
    onSkipToEnd: vi.fn(),
    ...overrides,
  });

  /** Render the step through the real StepHost — the step's gate and its save
   *  both come back from useStep, so the harness drives them together. */
  const renderAuthStep = (props: StepProps) =>
    renderWithProviders(
      <StepNextHarness
        def={authStep}
        stepProps={props}
        onAdvance={props.onNext}
      />,
    );

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockIsFeatureEnabled.mockReturnValue(true);
    // Reset location search
    globalThis.history.replaceState({}, "", "/");
  });

  // ---- Initial render ----

  it("renders three auth mode cards", () => {
    mockSessionRefetch.mockResolvedValue({ data: null });
    renderAuthStep(makeStepProps());

    expect(screen.getByText("No Authentication")).toBeInTheDocument();
    expect(screen.getByText("Username & Password")).toBeInTheDocument();
    expect(screen.getByText("OpenID Connect (OIDC)")).toBeInTheDocument();
  });

  it("does not show any form initially", () => {
    mockSessionRefetch.mockResolvedValue({ data: null });
    renderAuthStep(makeStepProps());

    expect(screen.queryByTestId("local-form")).not.toBeInTheDocument();
    expect(screen.queryByTestId("oidc-form")).not.toBeInTheDocument();
  });

  it("shows description text", () => {
    mockSessionRefetch.mockResolvedValue({ data: null });
    renderAuthStep(makeStepProps());

    expect(
      screen.getByText(/Choose how you want to protect access/),
    ).toBeInTheDocument();
  });

  // ---- No Authentication mode ----

  it("selects 'No Authentication' and calls setAuthMode mutation", async () => {
    mockSessionRefetch.mockResolvedValue({ data: null });
    const onNext = vi.fn();
    mockSetAuthModeMutateAsync.mockResolvedValue({ success: true });
    renderAuthStep(makeStepProps({ onNext }));

    fireEvent.click(screen.getByText("No Authentication"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(mockSetAuthModeMutateAsync).toHaveBeenCalledWith({
        mode: "none",
        localConfig: undefined,
        oidcConfig: undefined,
      });
    });
    await waitFor(() => {
      expect(onNext).toHaveBeenCalledTimes(1);
    });
  });

  // ---- Username & Password mode ----

  it("shows local form when Username & Password is selected", () => {
    mockSessionRefetch.mockResolvedValue({ data: null });
    renderAuthStep(makeStepProps());

    fireEvent.click(screen.getByText("Username & Password"));

    expect(screen.getByTestId("local-form")).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("shows validation error when username is empty for local mode", async () => {
    mockSessionRefetch.mockResolvedValue({ data: null });
    const onNext = vi.fn();
    renderAuthStep(makeStepProps({ onNext }));

    fireEvent.click(screen.getByText("Username & Password"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(screen.getByText("Username is required")).toBeInTheDocument();
    });
    expect(mockSetAuthModeMutateAsync).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });

  it("shows validation error when password is too short for local mode", async () => {
    mockSessionRefetch.mockResolvedValue({ data: null });
    const onNext = vi.fn();
    renderAuthStep(makeStepProps({ onNext }));

    fireEvent.click(screen.getByText("Username & Password"));
    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(
        screen.getByText("Password is required"),
      ).toBeInTheDocument();
    });
    expect(mockSetAuthModeMutateAsync).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });

  it("calls setAuthMode with local config when form is valid", async () => {
    mockSessionRefetch.mockResolvedValue({ data: null });
    const onNext = vi.fn();
    mockSetAuthModeMutateAsync.mockResolvedValue({ success: true });
    renderAuthStep(makeStepProps({ onNext }));

    fireEvent.click(screen.getByText("Username & Password"));
    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "password123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(mockSetAuthModeMutateAsync).toHaveBeenCalledWith({
        mode: "local",
        localConfig: { username: "admin", password: "password123" },
        oidcConfig: undefined,
      });
    });
    await waitFor(() => {
      expect(onNext).toHaveBeenCalledTimes(1);
    });
  });

  // ---- OIDC mode ----

  it("disables the OIDC option in demo mode", () => {
    mockIsFeatureEnabled.mockReturnValue(false);
    mockSessionRefetch.mockResolvedValue({ data: null });
    renderAuthStep(makeStepProps());

    const oidcCard = screen
      .getByText("OpenID Connect (OIDC)")
      .closest('[role="button"]');
    assertExists(oidcCard);
    expect(oidcCard).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(oidcCard);
    expect(screen.queryByTestId("oidc-form")).not.toBeInTheDocument();
  });

  it("shows OIDC form when OpenID Connect is selected", () => {
    mockSessionRefetch.mockResolvedValue({ data: null });
    renderAuthStep(makeStepProps());

    fireEvent.click(screen.getByText("OpenID Connect (OIDC)"));

    expect(screen.getByTestId("oidc-form")).toBeInTheDocument();
    expect(screen.getByLabelText("Issuer URL")).toBeInTheDocument();
    expect(screen.getByLabelText("Client ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Client Secret")).toBeInTheDocument();
    expect(screen.getByLabelText("Base URL")).toBeInTheDocument();
  });

  type OidcStage = {
    issuerUrl?: string;
    clientId?: string;
    clientSecret?: string;
    baseUrl?: string;
  };
  it.each<[string, OidcStage, string]>([
    ["all empty", {}, "Issuer URL is required"],
    [
      "issuer only",
      { issuerUrl: "https://auth.example.com" },
      "Client ID is required",
    ],
    [
      "issuer + clientId",
      { issuerUrl: "https://auth.example.com", clientId: "chargeha" },
      "Client secret is required",
    ],
    [
      "issuer + clientId + secret",
      {
        issuerUrl: "https://auth.example.com",
        clientId: "chargeha",
        clientSecret: "secret123",
      },
      "Base URL is required",
    ],
  ])(
    "OIDC validation: %s -> %s",
    async (_label, stage, expectedError) => {
      mockSessionRefetch.mockResolvedValue({ data: null });
      const onNext = vi.fn();
      renderAuthStep(makeStepProps({ onNext }));

      fireEvent.click(screen.getByText("OpenID Connect (OIDC)"));
      const fields: Array<[string, string | undefined]> = [
        ["Issuer URL", stage.issuerUrl],
        ["Client ID", stage.clientId],
        ["Client Secret", stage.clientSecret],
        ["Base URL", stage.baseUrl],
      ];
      fields
        .filter(([, value]) => value !== undefined)
        .forEach(([label, value]) =>
          fireEvent.change(screen.getByLabelText(label), {
            target: { value },
          })
        );
      fireEvent.click(screen.getByRole("button", { name: "Next" }));

      await waitFor(() => {
        expect(screen.getByText(expectedError)).toBeInTheDocument();
      });
      expect(onNext).not.toHaveBeenCalled();
    },
  );

  it("calls saveOidcConfig and redirects to OIDC login for OIDC mode", async () => {
    mockSessionRefetch.mockResolvedValue({ data: null });
    const onNext = vi.fn();
    mockSaveOidcConfigMutateAsync.mockResolvedValue({ success: true });

    // Mock location.href setter
    const hrefSetter = vi.fn();
    const originalLocation = globalThis.location;
    Object.defineProperty(globalThis, "location", {
      value: { ...originalLocation, href: "", search: "" },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(globalThis.location, "href", {
      set: hrefSetter,
      get: () => "",
      configurable: true,
    });

    renderAuthStep(makeStepProps({ onNext }));

    fireEvent.click(screen.getByText("OpenID Connect (OIDC)"));
    fireEvent.change(screen.getByLabelText("Issuer URL"), {
      target: { value: "https://auth.example.com" },
    });
    fireEvent.change(screen.getByLabelText("Client ID"), {
      target: { value: "chargeha" },
    });
    fireEvent.change(screen.getByLabelText("Client Secret"), {
      target: { value: "secret123" },
    });
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://chargeha.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(mockSaveOidcConfigMutateAsync).toHaveBeenCalledWith({
        issuerUrl: "https://auth.example.com",
        clientId: "chargeha",
        clientSecret: "secret123",
        baseUrl: "https://chargeha.example.com",
      });
    });

    await waitFor(() => {
      expect(hrefSetter).toHaveBeenCalledWith(
        "/auth/oidc/login?return=wizard",
      );
    });

    // Should NOT call setAuthMode for OIDC
    expect(mockSetAuthModeMutateAsync).not.toHaveBeenCalled();
    // Should NOT call onNext (redirect handles navigation)
    expect(onNext).not.toHaveBeenCalled();

    // Restore
    Object.defineProperty(globalThis, "location", {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  it("shows error when saveOidcConfig mutation fails", async () => {
    mockSessionRefetch.mockResolvedValue({ data: null });
    const onNext = vi.fn();
    mockSaveOidcConfigMutateAsync.mockRejectedValue(
      new Error("OIDC discovery failed"),
    );
    renderAuthStep(makeStepProps({ onNext }));

    fireEvent.click(screen.getByText("OpenID Connect (OIDC)"));
    fireEvent.change(screen.getByLabelText("Issuer URL"), {
      target: { value: "https://auth.example.com" },
    });
    fireEvent.change(screen.getByLabelText("Client ID"), {
      target: { value: "chargeha" },
    });
    fireEvent.change(screen.getByLabelText("Client Secret"), {
      target: { value: "secret123" },
    });
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://chargeha.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(
        screen.getByText("OIDC discovery failed"),
      ).toBeInTheDocument();
    });
    expect(onNext).not.toHaveBeenCalled();
  });

  it("shows error when setAuthMode mutation fails", async () => {
    mockSessionRefetch.mockResolvedValue({ data: null });
    const onNext = vi.fn();
    mockSetAuthModeMutateAsync.mockRejectedValue(
      new Error("Failed to save auth settings"),
    );
    renderAuthStep(makeStepProps({ onNext }));

    fireEvent.click(screen.getByText("No Authentication"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(
        screen.getByText("Failed to save auth settings"),
      ).toBeInTheDocument();
    });
    expect(onNext).not.toHaveBeenCalled();
  });

  // ---- OIDC error display from URL ----

  it("displays OIDC error from URL query param on mount", async () => {
    mockSessionRefetch.mockResolvedValue({ data: null });
    globalThis.history.replaceState({}, "", "/wizard?error=provider_denied");
    renderAuthStep(makeStepProps());

    await waitFor(() => {
      expect(
        screen.getByText("The identity provider denied the request."),
      ).toBeInTheDocument();
    });
  });

  it("auto-selects OIDC mode when error param present", async () => {
    mockSessionRefetch.mockResolvedValue({ data: null });
    globalThis.history.replaceState(
      {},
      "",
      "/wizard?error=token_exchange_failed",
    );
    renderAuthStep(makeStepProps());

    await waitFor(() => {
      expect(screen.getByTestId("oidc-form")).toBeInTheDocument();
    });
  });

  // ---- Auto-advance on OIDC session ----

  it("auto-advances when session shows OIDC authenticated", async () => {
    const onNext = vi.fn();
    mockSessionRefetch.mockResolvedValue({
      data: { authenticated: true, authMode: "oidc" },
    });
    renderAuthStep(makeStepProps({ onNext }));

    await waitFor(() => {
      expect(onNext).toHaveBeenCalledTimes(1);
    });
  });

  it("does not auto-advance when session is not authenticated", async () => {
    const onNext = vi.fn();
    mockSessionRefetch.mockResolvedValue({
      data: { authenticated: false, authMode: "none" },
    });
    renderAuthStep(makeStepProps({ onNext }));

    // Flush microtasks deterministically (no fixed sleep).
    await Promise.resolve();
    await Promise.resolve();
    expect(onNext).not.toHaveBeenCalled();
  });

  it("pre-selects the already-configured auth mode on return", async () => {
    mockSessionRefetch.mockResolvedValue({
      data: { authenticated: false, authMode: "local" },
    });
    renderAuthStep(makeStepProps());

    // The local form renders only when "local" is the selected mode, so its
    // presence proves the configured mode was pre-selected on mount.
    await waitFor(() => {
      expect(screen.getByTestId("local-form")).toBeInTheDocument();
    });
  });

  // ---- Redirect URI display ----

  it("shows computed redirect URI when base URL is entered", () => {
    mockSessionRefetch.mockResolvedValue({ data: null });
    renderAuthStep(makeStepProps());

    fireEvent.click(screen.getByText("OpenID Connect (OIDC)"));
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://chargeha.example.com" },
    });

    const redirectInput = screen.getByLabelText("Redirect URI");
    expect(redirectInput).toBeInTheDocument();
    expect(redirectInput).toHaveValue(
      "https://chargeha.example.com/auth/oidc/callback",
    );
  });

  it("redirect URI is read-only", () => {
    mockSessionRefetch.mockResolvedValue({ data: null });
    renderAuthStep(makeStepProps());

    fireEvent.click(screen.getByText("OpenID Connect (OIDC)"));
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://example.com" },
    });

    const redirectInput = screen.getByLabelText("Redirect URI");
    expect(redirectInput).toHaveAttribute("readonly");
  });

  it("strips trailing slashes from base URL for redirect URI", () => {
    mockSessionRefetch.mockResolvedValue({ data: null });
    renderAuthStep(makeStepProps());

    fireEvent.click(screen.getByText("OpenID Connect (OIDC)"));
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://chargeha.example.com/" },
    });

    const redirectInput = screen.getByLabelText("Redirect URI");
    expect(redirectInput).toHaveValue(
      "https://chargeha.example.com/auth/oidc/callback",
    );
  });

  // ---- No mode selected ----

  it("disables Next with a hint when no mode is selected", async () => {
    mockSessionRefetch.mockResolvedValue({ data: null });
    const onNext = vi.fn();
    renderAuthStep(makeStepProps({ onNext }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    });
    expect(
      screen.getByText("Select an authentication mode to continue"),
    ).toBeInTheDocument();
    expect(onNext).not.toHaveBeenCalled();
  });

  // ---- Mode switching ----

  it.each<[string, string, string, string, string]>([
    [
      "local -> oidc",
      "Username & Password",
      "local-form",
      "OpenID Connect (OIDC)",
      "oidc-form",
    ],
    [
      "oidc -> local",
      "OpenID Connect (OIDC)",
      "oidc-form",
      "Username & Password",
      "local-form",
    ],
  ])(
    "switching modes (%s) hides previous form and shows new",
    (_label, firstLabel, firstFormId, secondLabel, secondFormId) => {
      mockSessionRefetch.mockResolvedValue({ data: null });
      renderAuthStep(makeStepProps());

      fireEvent.click(screen.getByText(firstLabel));
      expect(screen.getByTestId(firstFormId)).toBeInTheDocument();

      fireEvent.click(screen.getByText(secondLabel));
      expect(screen.queryByTestId(firstFormId)).not.toBeInTheDocument();
      expect(screen.getByTestId(secondFormId)).toBeInTheDocument();
    },
  );

  it("clears validation error when switching modes", async () => {
    mockSessionRefetch.mockResolvedValue({ data: null });
    renderAuthStep(makeStepProps());

    // Trigger a validation error
    fireEvent.click(screen.getByText("Username & Password"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(screen.getByText("Username is required")).toBeInTheDocument();
    });

    // Switch mode — error should clear
    fireEvent.click(screen.getByText("No Authentication"));
    expect(screen.queryByText("Username is required")).not.toBeInTheDocument();
  });

  // ---- Keyboard navigation ----

  it("selects mode via Enter key on card", async () => {
    mockSessionRefetch.mockResolvedValue({ data: null });
    const onNext = vi.fn();
    mockSetAuthModeMutateAsync.mockResolvedValue({ success: true });
    renderAuthStep(makeStepProps({ onNext }));

    const card = screen.getByText("No Authentication").closest(
      "[role=button]",
    );
    assertExists(card);
    fireEvent.keyDown(card, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(onNext).toHaveBeenCalledTimes(1);
    });
  });

  it("selects mode via Space key on card", () => {
    mockSessionRefetch.mockResolvedValue({ data: null });
    renderAuthStep(makeStepProps());

    const card = screen.getByText("Username & Password").closest(
      "[role=button]",
    );
    assertExists(card);
    fireEvent.keyDown(card, { key: " " });

    expect(screen.getByTestId("local-form")).toBeInTheDocument();
  });
});
