import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithProviders } from "../../test-utils.tsx";
import { LoginPage } from "./LoginPage.tsx";

// Mock child components to test LoginPage logic in isolation
vi.mock("./LocalLoginForm.tsx", () => ({
  LocalLoginForm: ({ onSuccess }: { onSuccess: () => void }) => (
    <div data-testid="local-login-form" onClick={onSuccess}>
      LocalLoginForm
    </div>
  ),
}));

vi.mock("./OidcLoginButton.tsx", () => ({
  OidcLoginButton: () => (
    <div data-testid="oidc-login-button">OidcLoginButton</div>
  ),
}));

describe("LoginPage", () => {
  afterEach(() => {
    cleanup();
  });

  // ── Branding ──

  it("renders logo and branding", () => {
    renderWithProviders(
      <LoginPage authMode="local" onSuccess={vi.fn()} />,
    );

    expect(screen.getByAltText("ChargeHA")).toBeInTheDocument();
    expect(screen.getByText("HA")).toBeInTheDocument();
  });

  // ── Auth mode rendering ──

  it("renders LocalLoginForm when authMode is 'local'", () => {
    renderWithProviders(
      <LoginPage authMode="local" onSuccess={vi.fn()} />,
    );

    expect(screen.getByTestId("local-login-form")).toBeInTheDocument();
    expect(screen.queryByTestId("oidc-login-button")).not.toBeInTheDocument();
  });

  it("renders OidcLoginButton when authMode is 'oidc'", () => {
    renderWithProviders(
      <LoginPage authMode="oidc" onSuccess={vi.fn()} />,
    );

    expect(screen.getByTestId("oidc-login-button")).toBeInTheDocument();
    expect(screen.queryByTestId("local-login-form")).not.toBeInTheDocument();
  });

  it("renders neither form when authMode is 'none'", () => {
    renderWithProviders(
      <LoginPage authMode="none" onSuccess={vi.fn()} />,
    );

    expect(screen.queryByTestId("local-login-form")).not.toBeInTheDocument();
    expect(screen.queryByTestId("oidc-login-button")).not.toBeInTheDocument();
  });

  // ── Error messages ──

  it.each<[string, RegExp | string]>([
    ["provider_denied", "Access was denied by your identity provider"],
    ["state_mismatch", /Login session expired/],
    ["token_exchange_failed", /Authentication failed/],
    ["provider_unreachable", "Could not reach your identity provider"],
    ["some_unknown_error", "some_unknown_error"],
  ])("shows error banner for errorCode %s", (errorCode, expected) => {
    renderWithProviders(
      <LoginPage
        authMode="oidc"
        onSuccess={vi.fn()}
        errorCode={errorCode}
      />,
    );

    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("does not show error banner when no error code", () => {
    renderWithProviders(
      <LoginPage authMode="local" onSuccess={vi.fn()} />,
    );

    // No error banner text
    expect(screen.queryByText("Access was denied")).not.toBeInTheDocument();
    expect(screen.queryByText("Login session expired")).not.toBeInTheDocument();
  });
});
