import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { renderWithProviders } from "../../test-utils.tsx";

vi.mock("../ConnectionBadge/ConnectionBadge.tsx", () => ({
  ConnectionBadge: () => <div data-testid="connection-badge" />,
}));

import { AppLayout } from "./AppLayout.tsx";

describe("AppLayout", () => {
  beforeEach(vi.clearAllMocks);
  afterEach(cleanup);
  const defaultProps = {
    appearance: "dark" as const,
    onToggleAppearance: vi.fn(),
    activePage: "dashboard" as const,
    onNavigate: vi.fn(),
  };

  it("renders the brand name", () => {
    renderWithProviders(
      <AppLayout {...defaultProps}>
        <div />
      </AppLayout>,
    );

    expect(screen.getByText(/Charge/)).toBeInTheDocument();
    expect(screen.getByText("HA")).toBeInTheDocument();
  });

  it.each(["Dashboard", "Stats", "Schedules", "Logs", "Settings"])(
    "renders %s nav link",
    (label) => {
      renderWithProviders(
        <AppLayout {...defaultProps}>
          <div />
        </AppLayout>,
      );

      expect(screen.getByText(label)).toBeInTheDocument();
    },
  );

  it("renders the connection badge", () => {
    renderWithProviders(
      <AppLayout {...defaultProps}>
        <div />
      </AppLayout>,
    );

    expect(screen.getByTestId("connection-badge")).toBeInTheDocument();
  });

  it.each([
    { appearance: "dark" as const, ariaChecked: "true" },
    { appearance: "light" as const, ariaChecked: "false" },
  ])(
    "renders the theme toggle switch reflecting $appearance appearance",
    ({ appearance, ariaChecked }) => {
      renderWithProviders(
        <AppLayout {...defaultProps} appearance={appearance}>
          <div />
        </AppLayout>,
      );

      expect(screen.getByRole("switch")).toHaveAttribute(
        "aria-checked",
        ariaChecked,
      );
    },
  );

  it("renders children content", () => {
    renderWithProviders(
      <AppLayout {...defaultProps}>
        <div data-testid="child-content">Hello</div>
      </AppLayout>,
    );

    expect(screen.getByTestId("child-content")).toBeInTheDocument();
  });

  it.each(["local" as const, "oidc" as const])(
    "shows logout for %s authMode",
    (authMode) => {
      renderWithProviders(
        <AppLayout {...defaultProps} authMode={authMode} onLogout={vi.fn()}>
          <div />
        </AppLayout>,
      );

      expect(screen.getByRole("button", { name: "Log out" }))
        .toBeInTheDocument();
    },
  );

  it.each([
    { case: "authMode='none'", authMode: "none" as const, onLogout: vi.fn() },
    { case: "authMode undefined", authMode: undefined, onLogout: vi.fn() },
    {
      case: "onLogout undefined",
      authMode: "local" as const,
      onLogout: undefined,
    },
  ])("hides logout when $case", ({ authMode, onLogout }) => {
    renderWithProviders(
      <AppLayout {...defaultProps} authMode={authMode} onLogout={onLogout}>
        <div />
      </AppLayout>,
    );

    expect(screen.queryByRole("button", { name: "Log out" })).not
      .toBeInTheDocument();
  });

  it("calls onLogout when logout button is clicked", async () => {
    const onLogout = vi.fn();
    renderWithProviders(
      <AppLayout {...defaultProps} authMode="local" onLogout={onLogout}>
        <div />
      </AppLayout>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it("calls onNavigate when desktop nav link is clicked", async () => {
    const onNavigate = vi.fn();
    renderWithProviders(
      <AppLayout {...defaultProps} onNavigate={onNavigate}>
        <div />
      </AppLayout>,
    );

    await userEvent.click(screen.getByText("Stats"));
    expect(onNavigate).toHaveBeenCalledWith("stats");
  });

  it("toggles mobile menu open and closed", async () => {
    renderWithProviders(
      <AppLayout {...defaultProps}>
        <div />
      </AppLayout>,
    );

    // Open the menu
    await userEvent.click(
      screen.getByRole("button", { name: "Open menu" }),
    );
    // Mobile menu shows nav items (duplicated from header)
    expect(screen.getAllByText("Stats").length).toBeGreaterThanOrEqual(2);

    // Close the menu and verify it actually closed
    await userEvent.click(
      screen.getByRole("button", { name: "Close menu" }),
    );
    expect(screen.queryByRole("button", { name: "Close menu" })).not
      .toBeInTheDocument();
    expect(screen.getAllByText("Stats")).toHaveLength(1);
  });

  it("closes mobile menu when navigating via mobile nav", async () => {
    const onNavigate = vi.fn();
    renderWithProviders(
      <AppLayout {...defaultProps} onNavigate={onNavigate}>
        <div />
      </AppLayout>,
    );

    // Open mobile menu
    await userEvent.click(
      screen.getByRole("button", { name: "Open menu" }),
    );

    // Click a mobile nav link — the duplicated ones are in the mobile menu
    const logsLinks = screen.getAllByText("Logs");
    // Click the last one (mobile menu)
    await userEvent.click(logsLinks[logsLinks.length - 1]);
    expect(onNavigate).toHaveBeenCalledWith("logs");
    expect(screen.queryByRole("button", { name: "Close menu" })).not
      .toBeInTheDocument();
  });

  it("shows logout in mobile menu when authenticated", async () => {
    const onLogout = vi.fn();
    renderWithProviders(
      <AppLayout {...defaultProps} authMode="local" onLogout={onLogout}>
        <div />
      </AppLayout>,
    );

    // Open mobile menu
    await userEvent.click(
      screen.getByRole("button", { name: "Open menu" }),
    );

    // Mobile menu shows "Log out" text
    expect(screen.getByText("Log out")).toBeInTheDocument();
  });

  it("hides mobile logout when no auth", async () => {
    renderWithProviders(
      <AppLayout {...defaultProps}>
        <div />
      </AppLayout>,
    );

    // Open mobile menu
    await userEvent.click(
      screen.getByRole("button", { name: "Open menu" }),
    );

    // No logout buttons at all
    expect(screen.queryByRole("button", { name: "Log out" })).not
      .toBeInTheDocument();
  });

  it("highlights active page in nav", () => {
    renderWithProviders(
      <AppLayout {...defaultProps} activePage="settings">
        <div />
      </AppLayout>,
    );

    expect(screen.getByText("Settings")).toHaveClass("navLinkActive");
  });
});
