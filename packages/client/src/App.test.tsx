import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

// Mock all page components so tests focus on routing, not page internals
vi.mock("./components/pages/Dashboard/Dashboard.tsx", () => ({
  Dashboard: () => <div>Dashboard Page</div>,
}));
vi.mock("./components/pages/Stats/Stats.tsx", () => ({
  Stats: () => <div>Stats Page</div>,
}));
vi.mock("./components/pages/Schedules/Schedules.tsx", () => ({
  Schedules: () => <div>Schedules Page</div>,
}));
vi.mock("./components/pages/Logs/Logs.tsx", () => ({
  Logs: () => <div>Logs Page</div>,
}));
vi.mock("./components/pages/Settings/Settings.tsx", () => ({
  Settings: () => <div>Settings Page</div>,
}));
vi.mock("./components/ConnectionBadge/ConnectionBadge.tsx", () => ({
  ConnectionBadge: () => <div>ConnectionBadge</div>,
}));
vi.mock("./components/Wizard/WizardShell.tsx", () => ({
  WizardShell: ({ onComplete }: { onComplete?: () => void }) => (
    <div>
      Wizard Page
      <button type="button" onClick={onComplete}>Complete Wizard</button>
    </div>
  ),
}));
vi.mock("./components/Login/LoginPage.tsx", () => ({
  LoginPage: (
    { authMode, onSuccess, errorCode }: {
      authMode: string;
      onSuccess: () => void;
      errorCode?: string | null;
    },
  ) => (
    <div>
      Login Page
      <span data-testid="auth-mode">{authMode}</span>
      {errorCode && <span data-testid="error-code">{errorCode}</span>}
      <button type="button" onClick={onSuccess}>Login</button>
    </div>
  ),
}));
vi.mock("./components/ui/Spinner.tsx", () => ({
  Spinner: () => <div data-testid="auth-loading">Loading...</div>,
}));
vi.mock("@chargeha/plugins/componentRegistry", () => ({
  vehiclePluginOptions: [
    { id: "tesla", label: "Tesla", description: "Tesla", iconKey: "car" },
    {
      id: "simulated",
      label: "Simulated",
      description: "Sim",
      iconKey: "monitor",
    },
  ],
  energyPluginOptions: [
    {
      id: "fronius_local",
      label: "Fronius Local",
      description: "Fronius",
      iconKey: "server",
    },
  ],
  vehiclePluginSteps: {
    tesla: [
      {
        id: "tesla-key-gen",
        label: "Key Generation",
        componentKey: "tesla-key-generation",
      },
      {
        id: "tesla-auth",
        label: "Authorization",
        componentKey: "tesla-auth",
      },
    ],
    simulated: [],
  },
  energyPluginSteps: {
    fronius_local: [
      {
        id: "fronius-setup",
        label: "Fronius Setup",
        componentKey: "fronius-local-setup",
      },
    ],
  },
  pluginComponents: {},
}));
vi.mock("./hooks/useWizardState.ts", () => ({
  useWizardState: vi.fn(() => ({
    stepId: "welcome",
    vehicleType: "",
    energyType: "",
    setStepId: vi.fn(),
    commitSelection: vi.fn(),
    isLoading: false,
  })),
}));

type AuthMode = "none" | "local" | "oidc";

const mocks = vi.hoisted(() => {
  const logoutMutate = vi.fn();
  return {
    wizardStatusUseQuery: vi.fn(() => ({
      data: { completed: true, firstRun: false },
      isPending: false,
      error: null,
    })),
    authSessionUseQuery: vi.fn((): {
      data:
        | {
          authenticated: boolean;
          authMode: string;
          resetAuthActive?: boolean;
        }
        | undefined;
      isPending: boolean;
      error: null;
    } => ({
      data: { authenticated: true, authMode: "none" },
      isPending: false,
      error: null,
    })),
    logoutMutate,
    logoutUseMutation: vi.fn(() => ({
      mutate: logoutMutate,
      isPending: false,
    })),
  };
});

vi.mock("./trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    wizard: {
      status: {
        useQuery: () => mocks.wizardStatusUseQuery(),
      },
    },
    auth: {
      session: {
        useQuery: (_input: unknown, _opts?: unknown) =>
          mocks.authSessionUseQuery(),
      },
      logout: {
        useMutation: () => mocks.logoutUseMutation(),
      },
    },
    subscription: {
      onEvents: {
        useSubscription: vi.fn(),
      },
    },
    vehicle: {
      initializePlugin: {
        useMutation: vi.fn(() => ({
          mutate: vi.fn(),
          isPending: false,
        })),
      },
      getPlugins: { invalidate: vi.fn() },
    },
    energy: {
      initializePlugin: {
        useMutation: vi.fn(() => ({
          mutate: vi.fn(),
          isPending: false,
        })),
      },
      getPlugins: { invalidate: vi.fn() },
    },
    useUtils: vi.fn(() => ({
      energy: {
        realtime: { setData: vi.fn() },
        getPlugins: { invalidate: vi.fn() },
      },
      vehicle: {
        list: { setData: vi.fn(), invalidate: vi.fn() },
        getPlugins: { invalidate: vi.fn() },
      },
    })),
    createClient: vi.fn(() => ({})),
    Provider: ({ children }: { children: React.ReactNode }) => children,
  },
}));

import { App } from "./App.tsx";

describe("App", () => {
  const setAuth = (p: {
    authenticated: boolean;
    authMode: AuthMode;
    resetAuthActive?: boolean;
  }) => {
    mocks.authSessionUseQuery.mockReturnValue({
      data: {
        authenticated: p.authenticated,
        authMode: p.authMode,
        ...(p.resetAuthActive !== undefined
          ? { resetAuthActive: p.resetAuthActive }
          : {}),
      },
      isPending: false,
      error: null,
    });
  };

  const setAuthPending = () => {
    mocks.authSessionUseQuery.mockReturnValue({
      data: undefined,
      isPending: true,
      error: null,
    });
  };

  const setWizard = (p: { completed: boolean; firstRun: boolean }) => {
    mocks.wizardStatusUseQuery.mockReturnValue({
      data: { completed: p.completed, firstRun: p.firstRun },
      isPending: false,
      error: null,
    });
  };

  const mockWizardDefault = () => {
    setWizard({ completed: true, firstRun: false });
  };

  const mockAuthDefault = () => {
    setAuth({ authenticated: true, authMode: "none" });
  };

  describe("routing", () => {
    beforeEach(() => {
      // jsdom doesn't implement matchMedia
      globalThis.matchMedia = vi.fn().mockReturnValue({ matches: false });
      // Reset to root before each test
      globalThis.history.pushState(null, "", "/");
      mockWizardDefault();
      mockAuthDefault();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("renders Dashboard when path is /", () => {
      render(<App />);
      expect(screen.getByText("Dashboard Page")).toBeInTheDocument();
    });

    it("renders Stats when path is /stats", () => {
      globalThis.history.pushState(null, "", "/stats");
      render(<App />);
      expect(screen.getByText("Stats Page")).toBeInTheDocument();
    });

    it("renders Schedules when path is /schedules", () => {
      globalThis.history.pushState(null, "", "/schedules");
      render(<App />);
      expect(screen.getByText("Schedules Page")).toBeInTheDocument();
    });

    it("renders Settings when path is /settings", () => {
      globalThis.history.pushState(null, "", "/settings");
      render(<App />);
      expect(screen.getByText("Settings Page")).toBeInTheDocument();
    });

    it("renders Logs when path is /logs", () => {
      globalThis.history.pushState(null, "", "/logs");
      render(<App />);
      expect(screen.getByText("Logs Page")).toBeInTheDocument();
    });

    it("falls back to Dashboard for unknown paths", () => {
      globalThis.history.pushState(null, "", "/unknown");
      render(<App />);
      expect(screen.getByText("Dashboard Page")).toBeInTheDocument();
    });

    it("renders WizardShell when path is /wizard", () => {
      globalThis.history.pushState(null, "", "/wizard");
      render(<App />);
      expect(screen.getByText("Wizard Page")).toBeInTheDocument();
    });

    it("navigates to Dashboard when wizard completes", async () => {
      globalThis.history.pushState(null, "", "/wizard");
      render(<App />);
      expect(screen.getByText("Wizard Page")).toBeInTheDocument();

      await userEvent.click(screen.getByText("Complete Wizard"));
      expect(screen.getByText("Dashboard Page")).toBeInTheDocument();
      expect(globalThis.location.pathname).toBe("/");
    });

    it("navigates when a nav link is clicked", async () => {
      render(<App />);
      expect(screen.getByText("Dashboard Page")).toBeInTheDocument();

      await userEvent.click(screen.getByText("Stats"));
      expect(screen.getByText("Stats Page")).toBeInTheDocument();
      expect(globalThis.location.pathname).toBe("/stats");
    });

    it("updates URL on each navigation", async () => {
      render(<App />);

      await userEvent.click(screen.getByText("Schedules"));
      expect(globalThis.location.pathname).toBe("/schedules");

      await userEvent.click(screen.getByText("Settings"));
      expect(globalThis.location.pathname).toBe("/settings");

      await userEvent.click(screen.getByText("Dashboard"));
      expect(globalThis.location.pathname).toBe("/");
    });

    it("responds to browser back/forward (popstate)", async () => {
      render(<App />);

      // Navigate forward: Dashboard -> Stats -> Settings
      await userEvent.click(screen.getByText("Stats"));
      await userEvent.click(screen.getByText("Settings"));
      expect(screen.getByText("Settings Page")).toBeInTheDocument();

      // Simulate browser back
      globalThis.history.back();
      await waitFor(() => {
        expect(screen.getByText("Stats Page")).toBeInTheDocument();
      });

      // Simulate browser back again
      globalThis.history.back();
      await waitFor(() => {
        expect(screen.getByText("Dashboard Page")).toBeInTheDocument();
      });

      // Simulate browser forward
      globalThis.history.forward();
      await waitFor(() => {
        expect(screen.getByText("Stats Page")).toBeInTheDocument();
      });
    });

    it("highlights the active nav link", async () => {
      render(<App />);

      const dashboardLink = screen.getByText("Dashboard");
      expect(dashboardLink.className).toContain("navLinkActive");

      await userEvent.click(screen.getByText("Stats"));
      const statsLink = screen.getByText("Stats");
      expect(statsLink.className).toContain("navLinkActive");
      expect(screen.getByText("Dashboard").className).not.toContain(
        "navLinkActive",
      );
    });
  });

  describe("first-run redirect", () => {
    beforeEach(() => {
      globalThis.matchMedia = vi.fn().mockReturnValue({ matches: false });
      globalThis.history.pushState(null, "", "/");
      mockWizardDefault();
      mockAuthDefault();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("redirects to /wizard when API returns firstRun=true", async () => {
      setWizard({ completed: false, firstRun: true });

      render(<App />);

      await waitFor(() => {
        expect(screen.getByText("Wizard Page")).toBeInTheDocument();
      });
      expect(globalThis.location.pathname).toBe("/wizard");
    });

    it("does not redirect when wizard is completed", async () => {
      // default mockWizardDefault already provides completed:true, firstRun:false
      render(<App />);

      await waitFor(() => {
        expect(mocks.wizardStatusUseQuery).toHaveBeenCalled();
      });
      expect(screen.getByText("Dashboard Page")).toBeInTheDocument();
      expect(globalThis.location.pathname).toBe("/");
    });

    it("does not redirect when vehicles exist (env-configured install)", async () => {
      setWizard({ completed: false, firstRun: false });

      render(<App />);

      await waitFor(() => {
        expect(mocks.wizardStatusUseQuery).toHaveBeenCalled();
      });
      expect(screen.getByText("Dashboard Page")).toBeInTheDocument();
      expect(globalThis.location.pathname).toBe("/");
    });
  });

  describe("appearance", () => {
    beforeEach(() => {
      globalThis.history.pushState(null, "", "/");
      localStorage.clear();
      globalThis.ResizeObserver = vi.fn().mockImplementation(() => ({
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
      }));
      mockWizardDefault();
      mockAuthDefault();
    });

    afterEach(() => {
      vi.restoreAllMocks();
      localStorage.clear();
    });

    it("uses dark appearance when matchMedia prefers dark scheme and no stored theme", () => {
      globalThis.matchMedia = vi.fn().mockReturnValue({ matches: true });

      const { container } = render(<App />);

      // Radix Theme applies the appearance as a class on the root element
      const themeRoot = container.querySelector(".radix-themes");
      expect(themeRoot).toBeInTheDocument();
      expect(themeRoot?.className).toContain("dark");
    });

    it("uses light appearance when matchMedia prefers light scheme", () => {
      globalThis.matchMedia = vi.fn().mockReturnValue({ matches: false });

      const { container } = render(<App />);

      const themeRoot = container.querySelector(".radix-themes");
      expect(themeRoot).toBeInTheDocument();
      expect(themeRoot?.className).toContain("light");
    });

    it("uses stored appearance from localStorage", () => {
      localStorage.setItem("chargeha-theme", JSON.stringify("dark"));
      globalThis.matchMedia = vi.fn().mockReturnValue({ matches: false });

      const { container } = render(<App />);

      const themeRoot = container.querySelector(".radix-themes");
      expect(themeRoot?.className).toContain("dark");
    });

    it("toggles appearance when theme switch is clicked", async () => {
      globalThis.matchMedia = vi.fn().mockReturnValue({ matches: false });

      const { container } = render(<App />);

      const themeRoot = container.querySelector(".radix-themes");
      expect(themeRoot?.className).toContain("light");

      // The Radix Switch renders a button[role=switch]
      const switchEl = screen.getByRole("switch");
      await userEvent.click(switchEl);

      // After toggle, should switch to dark
      expect(themeRoot?.className).toContain("dark");
      expect(localStorage.getItem("chargeha-theme")).toBe(
        JSON.stringify("dark"),
      );
    });

    it("toggles back to light from dark", async () => {
      globalThis.matchMedia = vi.fn().mockReturnValue({ matches: true });

      const { container } = render(<App />);

      const themeRoot = container.querySelector(".radix-themes");
      expect(themeRoot?.className).toContain("dark");

      const switchEl = screen.getByRole("switch");
      await userEvent.click(switchEl);

      expect(themeRoot?.className).toContain("light");
      expect(localStorage.getItem("chargeha-theme")).toBe(
        JSON.stringify("light"),
      );
    });
  });

  describe("auth boot check", () => {
    beforeEach(() => {
      globalThis.matchMedia = vi.fn().mockReturnValue({ matches: false });
      globalThis.history.pushState(null, "", "/");
      mockWizardDefault();
      mockAuthDefault();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("shows loading state while auth session is pending", () => {
      setAuthPending();

      render(<App />);

      expect(screen.getByTestId("auth-loading")).toBeInTheDocument();
      expect(screen.queryByText("Dashboard Page")).not.toBeInTheDocument();
      expect(screen.queryByText("Login Page")).not.toBeInTheDocument();
    });

    it("proceeds normally when authMode is 'none'", () => {
      setAuth({ authenticated: true, authMode: "none" });

      render(<App />);

      expect(screen.getByText("Dashboard Page")).toBeInTheDocument();
      expect(screen.queryByText("Login Page")).not.toBeInTheDocument();
    });

    it("shows login page when authenticated is false with local auth", () => {
      setAuth({ authenticated: false, authMode: "local" });

      render(<App />);

      expect(screen.getByText("Login Page")).toBeInTheDocument();
      expect(screen.getByTestId("auth-mode")).toHaveTextContent("local");
      expect(screen.queryByText("Dashboard Page")).not.toBeInTheDocument();
    });

    it("shows login page when authenticated is false with oidc auth", () => {
      setAuth({ authenticated: false, authMode: "oidc" });

      render(<App />);

      expect(screen.getByText("Login Page")).toBeInTheDocument();
      expect(screen.getByTestId("auth-mode")).toHaveTextContent("oidc");
    });

    it("proceeds normally when authenticated is true with local auth", () => {
      setAuth({ authenticated: true, authMode: "local" });

      render(<App />);

      expect(screen.getByText("Dashboard Page")).toBeInTheDocument();
      expect(screen.queryByText("Login Page")).not.toBeInTheDocument();
    });

    it("shows RESET_AUTH warning banner when resetAuthActive is true", () => {
      setAuth({
        authenticated: true,
        authMode: "local",
        resetAuthActive: true,
      });

      render(<App />);

      expect(screen.getByText(
        "Authentication is disabled via RESET_AUTH environment variable",
      )).toBeInTheDocument();
      expect(screen.getByText("Dashboard Page")).toBeInTheDocument();
    });

    it("does not show RESET_AUTH banner when resetAuthActive is absent", () => {
      setAuth({ authenticated: true, authMode: "local" });

      render(<App />);

      expect(screen.queryByText(
        "Authentication is disabled via RESET_AUTH environment variable",
      )).not.toBeInTheDocument();
    });

    it("shows dashboard when auth transitions to authenticated", () => {
      setAuth({ authenticated: false, authMode: "local" });

      const { rerender } = render(<App />);
      expect(screen.getByText("Login Page")).toBeInTheDocument();

      // Simulate auth state change (e.g., after login refetch)
      setAuth({ authenticated: true, authMode: "local" });

      rerender(<App />);
      expect(screen.getByText("Dashboard Page")).toBeInTheDocument();
    });

    it("login success handler navigates to dashboard", async () => {
      setAuth({ authenticated: false, authMode: "local" });

      render(<App />);
      expect(screen.getByText("Login Page")).toBeInTheDocument();

      // Update mock before click so re-render after navigate picks up new value
      setAuth({ authenticated: true, authMode: "local" });

      // Click calls handleLoginSuccess → navigate("dashboard") → pushState + state update
      await act(() => {
        screen.getByText("Login").click();
      });

      // navigate("dashboard") pushed URL to /
      await waitFor(() => {
        expect(globalThis.location.pathname).toBe("/");
      });
    });

    it("passes OIDC error code from URL to login page", () => {
      globalThis.history.pushState(
        null,
        "",
        "/login?error=provider_denied",
      );
      setAuth({ authenticated: false, authMode: "oidc" });

      render(<App />);

      expect(screen.getByText("Login Page")).toBeInTheDocument();
      expect(screen.getByTestId("error-code")).toHaveTextContent(
        "provider_denied",
      );
    });

    it("does not fire wizard query when user is not authenticated", () => {
      setAuth({ authenticated: false, authMode: "local" });

      render(<App />);

      // FirstRunRedirect is inside AuthGate's children — not mounted when unauthenticated
      expect(mocks.wizardStatusUseQuery).not.toHaveBeenCalled();
    });

    it.each<{ authMode: AuthMode; expectButton: boolean }>([
      { authMode: "local", expectButton: true },
      { authMode: "oidc", expectButton: true },
      { authMode: "none", expectButton: false },
    ])(
      "logout button visibility for authMode=$authMode",
      ({ authMode, expectButton }) => {
        setAuth({ authenticated: true, authMode });

        render(<App />);

        const query = screen.queryByRole("button", { name: "Log out" });
        if (expectButton) {
          expect(query).toBeInTheDocument();
        } else {
          expect(query).not.toBeInTheDocument();
        }
      },
    );

    it("calls logout mutation when logout button is clicked", async () => {
      setAuth({ authenticated: true, authMode: "local" });

      render(<App />);

      await userEvent.click(screen.getByRole("button", { name: "Log out" }));
      expect(mocks.logoutMutate).toHaveBeenCalledOnce();
    });
  });
});
