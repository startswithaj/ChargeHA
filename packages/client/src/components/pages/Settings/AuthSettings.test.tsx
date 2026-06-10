import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type React from "react";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { AuthSettings } from "./AuthSettings.tsx";

// ── Mock function refs ──

const {
  mockChangePasswordMutate,
  mockChangeModeMutate,
  mockUpdateOidcConfigMutate,
  mockSessionInvalidate,
  mockSessionUseQuery,
  captured,
} = vi.hoisted(() => ({
  mockChangePasswordMutate: vi.fn(),
  mockChangeModeMutate: vi.fn(),
  mockUpdateOidcConfigMutate: vi.fn(),
  mockSessionInvalidate: vi.fn(),
  mockSessionUseQuery: vi.fn(() => ({
    data: { authenticated: true, authMode: "local" } as {
      authenticated: boolean;
      authMode: string;
    },
    isLoading: false,
    error: null,
  })),
  captured: {
    changePasswordOpts: {} as {
      onSuccess?: () => void;
      onError?: (err: unknown) => void;
    },
    changeModeOpts: {} as {
      onSuccess?: () => void;
      onError?: (err: unknown) => void;
    },
    updateOidcConfigOpts: {} as {
      onSuccess?: () => void;
      onError?: (err: unknown) => void;
    },
  },
}));

vi.mock("../../../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    auth: {
      session: {
        useQuery: () => mockSessionUseQuery(),
      },
      changePassword: {
        useMutation: vi.fn((opts?: {
          onSuccess?: () => void;
          onError?: (err: unknown) => void;
        }) => {
          captured.changePasswordOpts = opts ?? {};
          return {
            mutate: mockChangePasswordMutate,
            isPending: false,
            isError: false,
            error: null,
          };
        }),
      },
      oidcConfig: {
        useQuery: vi.fn(() => ({
          data: {
            issuerUrl: "https://auth.example.com",
            clientId: "chargeha",
            baseUrl: "https://chargeha.example.com",
          },
          isLoading: false,
          error: null,
        })),
      },
      updateOidcConfig: {
        useMutation: vi.fn((opts?: {
          onSuccess?: () => void;
          onError?: (err: unknown) => void;
        }) => {
          captured.updateOidcConfigOpts = opts ?? {};
          return {
            mutate: mockUpdateOidcConfigMutate,
            isPending: false,
            isError: false,
            error: null,
          };
        }),
      },
      changeMode: {
        useMutation: vi.fn((opts?: {
          onSuccess?: () => void;
          onError?: (err: unknown) => void;
        }) => {
          captured.changeModeOpts = opts ?? {};
          return {
            mutate: mockChangeModeMutate,
            isPending: false,
            isError: false,
            error: null,
          };
        }),
      },
    },
    useUtils: vi.fn(() => ({
      auth: {
        session: {
          invalidate: mockSessionInvalidate,
        },
      },
    })),
  },
}));

vi.mock("./SettingsLayout.tsx", () => ({
  SettingsSection: (
    { children, title }: { children: React.ReactNode; title: string },
  ) => (
    <div data-testid="settings-section">
      <h3>{title}</h3>
      {children}
    </div>
  ),
  SettingsRow: (
    { children, label }: { children: React.ReactNode; label: string },
  ) => (
    <div
      data-testid={`settings-row-${label.toLowerCase().replace(/\s/g, "-")}`}
    >
      <label>{label}</label>
      {children}
    </div>
  ),
}));

// ── Tests ──

describe("AuthSettings", () => {
  const pushStateSpy = () =>
    vi.spyOn(globalThis.history, "pushState").mockImplementation(() => {});

  // Open the auth mode Select and click an option by its role
  const selectMode = async (optionName: string) => {
    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByRole("option", { name: optionName }))
        .toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("option", { name: optionName }));
  };

  beforeEach(() => {
    // Radix Select uses ResizeObserver which jsdom doesn't provide
    globalThis.ResizeObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }));
    Element.prototype.scrollIntoView = vi.fn();
    mockSessionUseQuery.mockReturnValue({
      data: { authenticated: true, authMode: "local" },
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  // ── Current mode display ──

  it("renders the Authentication section", () => {
    renderWithProviders(<AuthSettings />);
    expect(screen.getByText("Authentication")).toBeInTheDocument();
  });

  it.each<[string, string]>([
    ["local", "Username & Password"],
    ["none", "No Authentication"],
    ["oidc", "OpenID Connect (OIDC)"],
  ])("shows %s mode label in current-mode row", (authMode, label) => {
    mockSessionUseQuery.mockReturnValue({
      data: { authenticated: true, authMode },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<AuthSettings />);
    const row = screen.getByTestId("settings-row-auth-mode");
    expect(within(row).getByText(label)).toBeInTheDocument();
  });

  // ── Password change form visibility ──

  it("shows Change Password form when current mode is local", () => {
    renderWithProviders(<AuthSettings />);
    expect(screen.getByTestId("change-password-form")).toBeInTheDocument();
    expect(screen.getByLabelText("Current Password")).toBeInTheDocument();
    expect(screen.getByLabelText("New Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm New Password")).toBeInTheDocument();
  });

  it.each(["none", "oidc"])(
    "does not show Change Password form when current mode is %s",
    (authMode) => {
      mockSessionUseQuery.mockReturnValue({
        data: { authenticated: true, authMode },
        isLoading: false,
        error: null,
      });
      renderWithProviders(<AuthSettings />);
      expect(
        screen.queryByTestId("change-password-form"),
      ).not.toBeInTheDocument();
    },
  );

  // ── Password change validation ──

  it("shows error when new password is empty", () => {
    renderWithProviders(<AuthSettings />);

    fireEvent.change(screen.getByLabelText("Current Password"), {
      target: { value: "oldpass123" },
    });
    fireEvent.change(screen.getByLabelText("New Password"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Confirm New Password"), {
      target: { value: "" },
    });
    fireEvent.submit(screen.getByTestId("change-password-form"));

    expect(
      screen.getByText("New password is required"),
    ).toBeInTheDocument();
    expect(mockChangePasswordMutate).not.toHaveBeenCalled();
  });

  it("shows error when passwords do not match", () => {
    renderWithProviders(<AuthSettings />);

    fireEvent.change(screen.getByLabelText("Current Password"), {
      target: { value: "oldpass123" },
    });
    fireEvent.change(screen.getByLabelText("New Password"), {
      target: { value: "newpassword1" },
    });
    fireEvent.change(screen.getByLabelText("Confirm New Password"), {
      target: { value: "newpassword2" },
    });
    fireEvent.submit(screen.getByTestId("change-password-form"));

    expect(
      screen.getByText("New passwords do not match"),
    ).toBeInTheDocument();
    expect(mockChangePasswordMutate).not.toHaveBeenCalled();
  });

  // ── Password change mutation ──

  it("calls changePassword mutation with correct input", () => {
    renderWithProviders(<AuthSettings />);

    fireEvent.change(screen.getByLabelText("Current Password"), {
      target: { value: "oldpass123" },
    });
    fireEvent.change(screen.getByLabelText("New Password"), {
      target: { value: "newpassword123" },
    });
    fireEvent.change(screen.getByLabelText("Confirm New Password"), {
      target: { value: "newpassword123" },
    });
    fireEvent.submit(screen.getByTestId("change-password-form"));

    expect(mockChangePasswordMutate).toHaveBeenCalledWith({
      currentPassword: "oldpass123",
      newPassword: "newpassword123",
    });
  });

  it("shows success message on password change", async () => {
    renderWithProviders(<AuthSettings />);

    fireEvent.change(screen.getByLabelText("Current Password"), {
      target: { value: "oldpass123" },
    });
    fireEvent.change(screen.getByLabelText("New Password"), {
      target: { value: "newpassword123" },
    });
    fireEvent.change(screen.getByLabelText("Confirm New Password"), {
      target: { value: "newpassword123" },
    });
    fireEvent.submit(screen.getByTestId("change-password-form"));

    // Trigger the onSuccess callback
    act(() => {
      captured.changePasswordOpts.onSuccess?.();
    });

    await waitFor(() => {
      expect(
        screen.getByText("Password changed successfully"),
      ).toBeInTheDocument();
    });
  });

  it("shows error on password change failure", async () => {
    renderWithProviders(<AuthSettings />);

    fireEvent.change(screen.getByLabelText("Current Password"), {
      target: { value: "wrongpass" },
    });
    fireEvent.change(screen.getByLabelText("New Password"), {
      target: { value: "newpassword123" },
    });
    fireEvent.change(screen.getByLabelText("Confirm New Password"), {
      target: { value: "newpassword123" },
    });
    fireEvent.submit(screen.getByTestId("change-password-form"));

    // Trigger the onError callback
    act(() => {
      captured.changePasswordOpts.onError?.(
        { message: "Invalid credentials" } as Error,
      );
    });

    await waitFor(() => {
      expect(
        screen.getByText("Current password is incorrect"),
      ).toBeInTheDocument();
    });
  });

  // ── Mode change: warning dialog for "none" ──

  it("shows warning dialog when selecting none mode", async () => {
    renderWithProviders(<AuthSettings />);

    await selectMode("No Authentication");

    await waitFor(() => {
      expect(
        screen.getByText("Remove Authentication?"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          /Anyone on your network will have full access/,
        ),
      ).toBeInTheDocument();
    });
  });

  // ── Mode change form: local → oidc ──

  it("shows mode change form when selecting a different mode", async () => {
    renderWithProviders(<AuthSettings />);

    await selectMode("OpenID Connect (OIDC)");

    await waitFor(() => {
      expect(screen.getByTestId("mode-change-form")).toBeInTheDocument();
    });
  });

  it("shows re-auth field when switching from local mode", async () => {
    renderWithProviders(<AuthSettings />);

    await selectMode("OpenID Connect (OIDC)");

    await waitFor(() => {
      expect(
        screen.getByText("Current Password (re-authentication)"),
      ).toBeInTheDocument();
    });
  });

  it("does not show re-auth field when switching from none mode", async () => {
    mockSessionUseQuery.mockReturnValue({
      data: { authenticated: true, authMode: "none" },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<AuthSettings />);

    await selectMode("Username & Password");

    await waitFor(() => {
      expect(screen.getByTestId("mode-change-form")).toBeInTheDocument();
    });

    expect(
      screen.queryByText("Current Password (re-authentication)"),
    ).not.toBeInTheDocument();
  });

  it("calls changeMode mutation with correct shape for oidc switch", async () => {
    renderWithProviders(<AuthSettings />);

    await selectMode("OpenID Connect (OIDC)");

    await waitFor(() => {
      expect(screen.getByTestId("mode-change-form")).toBeInTheDocument();
    });

    const modeForm = screen.getByTestId("mode-change-form");

    // Fill re-auth password (scoped to mode-change-form to avoid clash with change-password form)
    fireEvent.change(
      within(modeForm).getByLabelText("Current Password"),
      { target: { value: "mypassword" } },
    );

    // Fill OIDC config
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

    fireEvent.submit(screen.getByTestId("mode-change-form"));

    expect(mockChangeModeMutate).toHaveBeenCalledWith({
      newMode: "oidc",
      currentPassword: "mypassword",
      localConfig: undefined,
      oidcConfig: {
        issuerUrl: "https://auth.example.com",
        clientId: "chargeha",
        clientSecret: "secret123",
        baseUrl: "https://chargeha.example.com",
      },
    });
  });

  // ── Mode change redirects ──

  it("redirects to login after switching to authenticated mode", async () => {
    const pushState = pushStateSpy();

    renderWithProviders(<AuthSettings />);

    await selectMode("OpenID Connect (OIDC)");

    await waitFor(() => {
      expect(screen.getByTestId("mode-change-form")).toBeInTheDocument();
    });

    // Trigger the onSuccess callback from changeMode
    act(() => {
      captured.changeModeOpts.onSuccess?.();
    });

    await waitFor(() => {
      expect(mockSessionInvalidate).toHaveBeenCalled();
      expect(pushState).toHaveBeenCalledWith(null, "", "/login");
    });
  });

  it("redirects to dashboard after switching to none mode", async () => {
    const pushState = pushStateSpy();

    renderWithProviders(<AuthSettings />);

    await selectMode("No Authentication");

    // Confirm the warning dialog
    await waitFor(() => {
      expect(
        screen.getByText("Remove Authentication?"),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Remove Authentication"));

    // Now the mode change form should be visible
    await waitFor(() => {
      expect(screen.getByTestId("mode-change-form")).toBeInTheDocument();
    });

    // Trigger the onSuccess callback from changeMode
    act(() => {
      captured.changeModeOpts.onSuccess?.();
    });

    await waitFor(() => {
      expect(mockSessionInvalidate).toHaveBeenCalled();
      expect(pushState).toHaveBeenCalledWith(null, "", "/");
    });
  });

  // ── Mode change form cancel ──

  it("hides mode change form on cancel", async () => {
    renderWithProviders(<AuthSettings />);

    await selectMode("OpenID Connect (OIDC)");

    await waitFor(() => {
      expect(screen.getByTestId("mode-change-form")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Cancel"));

    expect(
      screen.queryByTestId("mode-change-form"),
    ).not.toBeInTheDocument();
  });

  // ── Mode change form validation ──

  it("shows error when re-auth password is missing for local mode switch", async () => {
    renderWithProviders(<AuthSettings />);

    await selectMode("OpenID Connect (OIDC)");

    await waitFor(() => {
      expect(screen.getByTestId("mode-change-form")).toBeInTheDocument();
    });

    // Fill OIDC config but not re-auth password
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

    fireEvent.submit(screen.getByTestId("mode-change-form"));

    expect(
      screen.getByText(
        "Current password is required to change auth mode",
      ),
    ).toBeInTheDocument();
    expect(mockChangeModeMutate).not.toHaveBeenCalled();
  });

  it("shows OIDC config fields in mode change form", async () => {
    renderWithProviders(<AuthSettings />);

    await selectMode("OpenID Connect (OIDC)");

    await waitFor(() => {
      expect(screen.getByTestId("oidc-config-form")).toBeInTheDocument();
      expect(screen.getByLabelText("Issuer URL")).toBeInTheDocument();
      expect(screen.getByLabelText("Client ID")).toBeInTheDocument();
      expect(screen.getByLabelText("Client Secret")).toBeInTheDocument();
      expect(screen.getByLabelText("Base URL")).toBeInTheDocument();
    });
  });

  it("shows local config fields when switching to local mode from none", async () => {
    mockSessionUseQuery.mockReturnValue({
      data: { authenticated: true, authMode: "none" },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<AuthSettings />);

    await selectMode("Username & Password");

    await waitFor(() => {
      expect(screen.getByTestId("local-config-form")).toBeInTheDocument();
      expect(screen.getByLabelText("Username")).toBeInTheDocument();
      expect(screen.getByLabelText("Password")).toBeInTheDocument();
    });
  });

  it("shows mode change error from mutation", async () => {
    renderWithProviders(<AuthSettings />);

    await selectMode("OpenID Connect (OIDC)");

    await waitFor(() => {
      expect(screen.getByTestId("mode-change-form")).toBeInTheDocument();
    });

    // Trigger the onError callback
    act(() => {
      captured.changeModeOpts.onError?.(
        { message: "Unauthorized" } as Error,
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("mode-change-error")).toBeInTheDocument();
      expect(screen.getByText("Unauthorized")).toBeInTheDocument();
    });
  });

  // ── OIDC edit button visibility ──

  it("shows Edit OIDC Settings button when current mode is oidc", () => {
    mockSessionUseQuery.mockReturnValue({
      data: { authenticated: true, authMode: "oidc" },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<AuthSettings />);

    expect(screen.getByTestId("edit-oidc-button")).toBeInTheDocument();
    expect(screen.getByText("Edit OIDC Settings")).toBeInTheDocument();
  });

  it.each(["local", "none"])(
    "does not show Edit OIDC Settings button when current mode is %s",
    (authMode) => {
      mockSessionUseQuery.mockReturnValue({
        data: { authenticated: true, authMode },
        isLoading: false,
        error: null,
      });
      renderWithProviders(<AuthSettings />);

      expect(screen.queryByTestId("edit-oidc-button")).not.toBeInTheDocument();
    },
  );

  // ── OIDC edit form ──

  it("shows OIDC edit form when edit button is clicked", () => {
    mockSessionUseQuery.mockReturnValue({
      data: { authenticated: true, authMode: "oidc" },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<AuthSettings />);

    fireEvent.click(screen.getByTestId("edit-oidc-button"));

    expect(screen.getByTestId("oidc-edit-form")).toBeInTheDocument();
  });

  it("pre-populates OIDC edit form with current config", () => {
    mockSessionUseQuery.mockReturnValue({
      data: { authenticated: true, authMode: "oidc" },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<AuthSettings />);

    fireEvent.click(screen.getByTestId("edit-oidc-button"));

    expect(screen.getByLabelText("Issuer URL")).toHaveValue(
      "https://auth.example.com",
    );
    expect(screen.getByLabelText("Client ID")).toHaveValue("chargeha");
    expect(screen.getByLabelText("Client Secret")).toHaveValue("");
    expect(screen.getByLabelText("Base URL")).toHaveValue(
      "https://chargeha.example.com",
    );
  });

  it("hides OIDC edit form on cancel", () => {
    mockSessionUseQuery.mockReturnValue({
      data: { authenticated: true, authMode: "oidc" },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<AuthSettings />);

    fireEvent.click(screen.getByTestId("edit-oidc-button"));
    expect(screen.getByTestId("oidc-edit-form")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Cancel"));

    expect(screen.queryByTestId("oidc-edit-form")).not.toBeInTheDocument();
    // Edit button should re-appear
    expect(screen.getByTestId("edit-oidc-button")).toBeInTheDocument();
  });

  it("calls updateOidcConfig mutation on form submit", () => {
    mockSessionUseQuery.mockReturnValue({
      data: { authenticated: true, authMode: "oidc" },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<AuthSettings />);

    fireEvent.click(screen.getByTestId("edit-oidc-button"));

    // Fill in client secret (required, not pre-populated)
    fireEvent.change(screen.getByLabelText("Client Secret"), {
      target: { value: "new-secret" },
    });

    fireEvent.submit(screen.getByTestId("oidc-edit-form"));

    expect(mockUpdateOidcConfigMutate).toHaveBeenCalledWith({
      issuerUrl: "https://auth.example.com",
      clientId: "chargeha",
      clientSecret: "new-secret",
      baseUrl: "https://chargeha.example.com",
    });
  });

  it("shows validation error when client secret is empty on OIDC edit", () => {
    mockSessionUseQuery.mockReturnValue({
      data: { authenticated: true, authMode: "oidc" },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<AuthSettings />);

    fireEvent.click(screen.getByTestId("edit-oidc-button"));

    // Submit without filling client secret
    fireEvent.submit(screen.getByTestId("oidc-edit-form"));

    expect(
      screen.getByText("Client secret is required"),
    ).toBeInTheDocument();
    expect(mockUpdateOidcConfigMutate).not.toHaveBeenCalled();
  });

  it("shows error from updateOidcConfig mutation failure", async () => {
    mockSessionUseQuery.mockReturnValue({
      data: { authenticated: true, authMode: "oidc" },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<AuthSettings />);

    fireEvent.click(screen.getByTestId("edit-oidc-button"));

    fireEvent.change(screen.getByLabelText("Client Secret"), {
      target: { value: "new-secret" },
    });
    fireEvent.submit(screen.getByTestId("oidc-edit-form"));

    // Trigger the onError callback
    act(() => {
      captured.updateOidcConfigOpts.onError?.(
        { message: "Discovery endpoint unreachable" } as Error,
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("oidc-edit-error")).toBeInTheDocument();
      expect(
        screen.getByText("Discovery endpoint unreachable"),
      ).toBeInTheDocument();
    });
  });

  // ── OIDC error from URL ──

  it("displays OIDC error from URL query param on mount", async () => {
    mockSessionUseQuery.mockReturnValue({
      data: { authenticated: true, authMode: "oidc" },
      isLoading: false,
      error: null,
    });
    globalThis.history.replaceState({}, "", "/settings?error=provider_denied");
    renderWithProviders(<AuthSettings />);

    await waitFor(() => {
      expect(screen.getByTestId("oidc-error")).toBeInTheDocument();
      expect(
        screen.getByText("The identity provider denied the request."),
      ).toBeInTheDocument();
    });
  });

  it("cleans error from URL after reading it", async () => {
    mockSessionUseQuery.mockReturnValue({
      data: { authenticated: true, authMode: "oidc" },
      isLoading: false,
      error: null,
    });
    globalThis.history.replaceState(
      {},
      "",
      "/settings?error=token_exchange_failed",
    );
    renderWithProviders(<AuthSettings />);

    await waitFor(() => {
      expect(screen.getByTestId("oidc-error")).toBeInTheDocument();
    });

    // URL should be cleaned
    expect(globalThis.location.search).toBe("");
  });

  it("displays success banner from oidc_updated URL param on mount", async () => {
    mockSessionUseQuery.mockReturnValue({
      data: { authenticated: true, authMode: "oidc" },
      isLoading: false,
      error: null,
    });
    globalThis.history.replaceState({}, "", "/settings?oidc_updated=1");
    renderWithProviders(<AuthSettings />);

    await waitFor(() => {
      expect(screen.getByTestId("oidc-success")).toBeInTheDocument();
      expect(
        screen.getByText("OIDC configuration updated successfully."),
      ).toBeInTheDocument();
    });
  });

  it("cleans oidc_updated from URL after reading it", async () => {
    mockSessionUseQuery.mockReturnValue({
      data: { authenticated: true, authMode: "oidc" },
      isLoading: false,
      error: null,
    });
    globalThis.history.replaceState({}, "", "/settings?oidc_updated=1");
    renderWithProviders(<AuthSettings />);

    await waitFor(() => {
      expect(screen.getByTestId("oidc-success")).toBeInTheDocument();
    });

    expect(globalThis.location.search).toBe("");
  });

  it("clears OIDC error when edit button is clicked", async () => {
    mockSessionUseQuery.mockReturnValue({
      data: { authenticated: true, authMode: "oidc" },
      isLoading: false,
      error: null,
    });
    globalThis.history.replaceState(
      {},
      "",
      "/settings?error=provider_unreachable",
    );
    renderWithProviders(<AuthSettings />);

    await waitFor(() => {
      expect(screen.getByTestId("oidc-error")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("edit-oidc-button"));

    expect(screen.queryByTestId("oidc-error")).not.toBeInTheDocument();
  });
});
