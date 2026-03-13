import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../test-utils.tsx";
import { OidcLoginButton } from "./OidcLoginButton.tsx";

describe("OidcLoginButton", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders 'Sign in with SSO' button", () => {
    renderWithProviders(<OidcLoginButton />);

    expect(screen.getByRole("button", { name: /Sign in with SSO/ }))
      .toBeInTheDocument();
  });

  it("navigates to /auth/oidc/login on click", () => {
    // Mock location.href setter
    const hrefSetter = vi.fn();
    Object.defineProperty(globalThis, "location", {
      value: { ...globalThis.location, href: "" },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(globalThis.location, "href", {
      set: hrefSetter,
      get: () => "",
      configurable: true,
    });

    renderWithProviders(<OidcLoginButton />);
    fireEvent.click(screen.getByRole("button", { name: /Sign in with SSO/ }));

    expect(hrefSetter).toHaveBeenCalledWith("/auth/oidc/login");
  });
});
