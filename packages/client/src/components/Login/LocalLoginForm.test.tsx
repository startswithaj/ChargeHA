import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loginMutate: vi.fn(),
  capturedOnSuccess: {} as { fn?: () => void },
  loginState: {
    isPending: false as boolean,
    error: null as { message: string } | null,
  },
  loginUseMutation: vi.fn((opts?: { onSuccess?: () => void }) => {
    mocks.capturedOnSuccess.fn = opts?.onSuccess;
    return {
      mutate: mocks.loginMutate,
      isPending: mocks.loginState.isPending,
      error: mocks.loginState.error,
      reset: vi.fn(),
    };
  }),
}));

vi.mock("../../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    auth: {
      login: {
        useMutation: (opts?: { onSuccess?: () => void }) =>
          mocks.loginUseMutation(opts),
      },
    },
  },
}));

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../test-utils.tsx";
import { LocalLoginForm } from "./LocalLoginForm.tsx";

describe("LocalLoginForm", () => {
  const setLoginMutation = (
    state: { isPending?: boolean; error?: { message: string } | null } = {},
  ) => {
    mocks.loginState.isPending = state.isPending ?? false;
    mocks.loginState.error = state.error ?? null;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.capturedOnSuccess.fn = undefined;
    setLoginMutation();
  });

  afterEach(() => {
    cleanup();
  });

  // ── Form interaction ──

  it("sign in button is disabled when fields are empty", () => {
    renderWithProviders(<LocalLoginForm onSuccess={vi.fn()} />);

    expect(screen.getByRole("button", { name: /Sign in/ })).toBeDisabled();
  });

  it("enables sign in button when both fields have values", () => {
    renderWithProviders(<LocalLoginForm onSuccess={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("Username"), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByPlaceholderText("Password"), {
      target: { value: "password123" },
    });

    expect(screen.getByRole("button", { name: /Sign in/ })).not.toBeDisabled();
  });

  it("calls login mutation on form submit", () => {
    renderWithProviders(<LocalLoginForm onSuccess={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("Username"), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByPlaceholderText("Password"), {
      target: { value: "password123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Sign in/ }));

    expect(mocks.loginMutate).toHaveBeenCalledWith({
      username: "admin",
      password: "password123",
    });
  });

  it("calls onSuccess when login succeeds", () => {
    const onSuccess = vi.fn();
    renderWithProviders(<LocalLoginForm onSuccess={onSuccess} />);

    // Trigger the onSuccess callback that was captured from useMutation
    mocks.capturedOnSuccess.fn?.();

    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  // ── Error display ──

  it("shows 'Invalid username or password' for invalid_credentials error", () => {
    setLoginMutation({ error: { message: "invalid_credentials" } });

    renderWithProviders(<LocalLoginForm onSuccess={vi.fn()} />);

    expect(screen.getByText("Invalid username or password"))
      .toBeInTheDocument();
  });

  it("shows rate limit message for TOO_MANY_REQUESTS error", () => {
    setLoginMutation({
      error: { message: JSON.stringify({ retryAfter: 60000 }) },
    });

    renderWithProviders(<LocalLoginForm onSuccess={vi.fn()} />);

    expect(screen.getByText(/Too many attempts/)).toBeInTheDocument();
    expect(screen.getByText(/60 seconds/)).toBeInTheDocument();
  });

  it("shows generic error message for unknown errors", () => {
    setLoginMutation({ error: { message: "Something went wrong" } });

    renderWithProviders(<LocalLoginForm onSuccess={vi.fn()} />);

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  // ── Pending state ──

  it("shows 'Signing in...' and disables button when pending", () => {
    setLoginMutation({ isPending: true });

    renderWithProviders(<LocalLoginForm onSuccess={vi.fn()} />);

    expect(screen.getByText("Signing in...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Signing in/ })).toBeDisabled();
  });
});
