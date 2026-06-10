import "@testing-library/jest-dom/vitest";
import { assertExists } from "@std/assert";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

type AuthMode = "none" | "local" | "oidc";

const mocks = vi.hoisted(() => ({
  authSessionUseQuery: vi.fn((): {
    data:
      | { authenticated: boolean; authMode: string; resetAuthActive?: boolean }
      | undefined;
    isPending: boolean;
    error: null;
  } => ({
    data: { authenticated: true, authMode: "none" },
    isPending: false,
    error: null,
  })),
  logoutMutate: vi.fn(),
  logoutUseMutation: vi.fn((opts?: { onSuccess?: () => void }) => {
    mocks.capturedLogout.onSuccess = opts?.onSuccess;
    return { mutate: mocks.logoutMutate, isPending: false };
  }),
  invalidateQueries: vi.fn(),
  clear: vi.fn(),
  capturedLogout: {} as { onSuccess?: () => void },
  navigate: vi.fn(),
}));

vi.mock("../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    auth: {
      session: {
        useQuery: (_input: unknown, _opts?: unknown) =>
          mocks.authSessionUseQuery(),
      },
      logout: {
        useMutation: (opts?: { onSuccess?: () => void }) =>
          mocks.logoutUseMutation(opts),
      },
    },
  },
}));

vi.mock("../lib/trpcSetup.ts", () => ({
  queryClient: {
    invalidateQueries: (opts: unknown) => mocks.invalidateQueries(opts),
    clear: () => mocks.clear(),
  },
}));

vi.mock("./Login/LoginPage.tsx", () => ({
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

vi.mock("./ui/Spinner.tsx", () => ({
  Spinner: () => <div data-testid="spinner">Loading...</div>,
}));

vi.mock("../hooks/useRouter.ts", () => ({
  useRouter: () => ({
    route: { type: "app", page: "dashboard" },
    navigate: mocks.navigate,
  }),
}));

import { AuthGate } from "./AuthGate.tsx";

describe("AuthGate", () => {
  const mockChildren = vi.fn(({ authMode, onLogout }) => (
    <div>
      Authenticated Content
      <span data-testid="child-auth-mode">{authMode}</span>
      <button type="button" onClick={onLogout}>Logout</button>
    </div>
  ));

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

  const setAuthUndefined = () => {
    mocks.authSessionUseQuery.mockReturnValue({
      data: undefined,
      isPending: false,
      error: null,
    });
  };

  beforeEach(() => {
    mocks.logoutMutate.mockClear();
    mocks.invalidateQueries.mockClear();
    mocks.clear.mockClear();
    mocks.capturedLogout.onSuccess = undefined;
    setAuth({ authenticated: true, authMode: "none" });
    globalThis.history.pushState(null, "", "/");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mocks.navigate.mockClear();
    mockChildren.mockClear();
  });

  it("shows spinner while auth session is pending", () => {
    setAuthPending();

    render(
      <AuthGate>{mockChildren}</AuthGate>,
    );

    expect(screen.getByTestId("spinner")).toBeInTheDocument();
    expect(screen.queryByText("Authenticated Content")).not.toBeInTheDocument();
    expect(screen.queryByText("Login Page")).not.toBeInTheDocument();
  });

  it("shows login page when not authenticated", () => {
    setAuth({ authenticated: false, authMode: "local" });

    render(
      <AuthGate>{mockChildren}</AuthGate>,
    );

    expect(screen.getByText("Login Page")).toBeInTheDocument();
    expect(screen.getByTestId("auth-mode")).toHaveTextContent("local");
    expect(screen.queryByText("Authenticated Content")).not.toBeInTheDocument();
  });

  it("renders children when authMode is none", () => {
    setAuth({ authenticated: true, authMode: "none" });

    render(
      <AuthGate>{mockChildren}</AuthGate>,
    );

    expect(screen.getByText("Authenticated Content")).toBeInTheDocument();
    expect(screen.getByTestId("child-auth-mode")).toHaveTextContent("none");
  });

  it("renders children when authenticated with local auth", () => {
    setAuth({ authenticated: true, authMode: "local" });

    render(
      <AuthGate>{mockChildren}</AuthGate>,
    );

    expect(screen.getByText("Authenticated Content")).toBeInTheDocument();
    expect(screen.getByTestId("child-auth-mode")).toHaveTextContent("local");
  });

  it("proceeds when authMode is none even if authenticated is false", () => {
    setAuth({ authenticated: false, authMode: "none" });

    render(
      <AuthGate>{mockChildren}</AuthGate>,
    );

    // authMode "none" means no auth required, so children render regardless
    expect(screen.getByText("Authenticated Content")).toBeInTheDocument();
  });

  it("shows RESET_AUTH banner when resetAuthActive is true", () => {
    setAuth({ authenticated: true, authMode: "local", resetAuthActive: true });

    render(
      <AuthGate>{mockChildren}</AuthGate>,
    );

    expect(
      screen.getByText(
        "Authentication is disabled via RESET_AUTH environment variable",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Authenticated Content")).toBeInTheDocument();
  });

  it.each([
    { label: "absent", resetAuthActive: undefined },
    { label: "false", resetAuthActive: false },
  ])(
    "does not show RESET_AUTH banner when resetAuthActive is $label",
    ({ resetAuthActive }) => {
      setAuth({ authenticated: true, authMode: "local", resetAuthActive });

      render(
        <AuthGate>{mockChildren}</AuthGate>,
      );

      expect(
        screen.queryByText(
          "Authentication is disabled via RESET_AUTH environment variable",
        ),
      ).not.toBeInTheDocument();
    },
  );

  it("passes login error code from URL params", () => {
    globalThis.history.pushState(null, "", "/login?error=provider_denied");
    setAuth({ authenticated: false, authMode: "oidc" });

    render(
      <AuthGate>{mockChildren}</AuthGate>,
    );

    expect(screen.getByTestId("error-code")).toHaveTextContent(
      "provider_denied",
    );
  });

  it("login success navigates to dashboard and invalidates auth session", async () => {
    setAuth({ authenticated: false, authMode: "local" });

    render(
      <AuthGate>{mockChildren}</AuthGate>,
    );

    await userEvent.click(screen.getByText("Login"));

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: [["auth", "session"]],
    });
    expect(mocks.navigate).toHaveBeenCalledWith({
      type: "app",
      page: "dashboard",
    });
  });

  it("logout button calls mutate", async () => {
    setAuth({ authenticated: true, authMode: "local" });

    render(
      <AuthGate>{mockChildren}</AuthGate>,
    );

    await userEvent.click(screen.getByText("Logout"));
    expect(mocks.logoutMutate).toHaveBeenCalled();
  });

  it("logout onSuccess clears cache, pushes /login, and invalidates auth session", () => {
    setAuth({ authenticated: true, authMode: "local" });

    render(
      <AuthGate>{mockChildren}</AuthGate>,
    );

    // Invoke the captured onSuccess callback
    assertExists(mocks.capturedLogout.onSuccess);
    mocks.capturedLogout.onSuccess();

    expect(mocks.clear).toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith({ type: "login" });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: [["auth", "session"]],
    });
  });

  it("defaults authMode to none when authData is undefined", () => {
    setAuthUndefined();

    render(
      <AuthGate>{mockChildren}</AuthGate>,
    );

    // authData is undefined, authMode defaults to "none", canProceed is true
    expect(screen.getByText("Authenticated Content")).toBeInTheDocument();
    expect(screen.getByTestId("child-auth-mode")).toHaveTextContent("none");
  });
});
