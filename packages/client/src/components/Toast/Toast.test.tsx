import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithProviders } from "../../test-utils.tsx";
import { userEvent } from "@testing-library/user-event";

vi.mock("../../hooks/useToast.tsx", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../hooks/useToast.tsx")>(),
  useToast: vi.fn(),
}));

import { type Toast as ToastData, useToast } from "../../hooks/useToast.tsx";
import { ToastContainer } from "./Toast.tsx";

describe("ToastContainer", () => {
  const mockUseToast = vi.mocked(useToast);

  const setToasts = (
    toasts: ToastData[],
    removeToast: () => void = vi.fn(),
  ) => {
    mockUseToast.mockReturnValue({
      toasts,
      addToast: vi.fn(),
      removeToast,
    });
  };

  beforeEach(vi.clearAllMocks);
  afterEach(cleanup);

  // a11y gap: Toast has no role="status"/"alert", so tests fall back to the
  // data-type attribute. Tighten once the component exposes an ARIA role.
  it.each<[ToastData["type"], string]>([
    ["info", "Something happened"],
    ["error", "Error occurred"],
    ["success", "Saved successfully"],
  ])("renders %s toast", (type, message) => {
    setToasts([{ id: 1, message, type }]);

    const { container } = renderWithProviders(<ToastContainer />);

    expect(screen.getByText(message)).toBeInTheDocument();
    expect(container.querySelector(`[data-type='${type}']`))
      .toBeInTheDocument();
  });

  it("dismiss button calls removeToast", async () => {
    const removeToast = vi.fn();
    setToasts([{ id: 42, message: "Dismiss me", type: "info" }], removeToast);

    renderWithProviders(<ToastContainer />);

    const dismissBtn = screen.getByRole("button", { name: "Dismiss" });
    await userEvent.click(dismissBtn);

    expect(removeToast).toHaveBeenCalledWith(42);
  });

  it("renders nothing when no toasts", () => {
    setToasts([]);

    const { container } = renderWithProviders(<ToastContainer />);

    // The ThemeProvider wrapper exists, but no toast container inside it
    expect(container.querySelector("[data-type]")).not.toBeInTheDocument();
  });
});
