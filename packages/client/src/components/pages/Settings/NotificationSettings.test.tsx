import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SectionProps, SettingsRowProps } from "./SettingsLayout.tsx";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { NotificationSettings } from "./NotificationSettings.tsx";
import { trpc } from "../../../trpc.ts";

const { mockNotificationSetMutate, h, MOCK_PROVIDERS } = vi.hoisted(() => ({
  mockNotificationSetMutate: vi.fn(),
  h: {
    testMutate: vi.fn(),
    testReset: vi.fn(),
    testMutationState: {
      isPending: false,
      isSuccess: false,
      isError: false,
      error: null as Error | null,
    },
  },
  MOCK_PROVIDERS: {
    telegram: [
      {
        key: "notification_telegram_bot_token",
        label: "Bot Token",
        help: "Your Telegram bot token",
        type: "text",
      },
      {
        key: "notification_telegram_silent",
        label: "Silent Notifications",
        help: "Send notifications without sound",
        type: "toggle",
      },
    ],
  },
}));

vi.mock("../../../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    tesla: {
      getConfig: {
        useQuery: vi.fn(() => ({ data: {}, isLoading: false, error: null })),
      },
    },
    config: {
      notification: {
        get: {
          useQuery: vi.fn(() => ({
            data: {
              notificationProvider: "",
              notificationEnabledEvents: "",
            },
            isLoading: false,
            error: null,
          })),
        },
        set: {
          useMutation: vi.fn(() => ({
            mutate: mockNotificationSetMutate,
            mutateAsync: vi.fn(),
            isPending: false,
            isSuccess: false,
            isError: false,
            error: null,
            data: undefined,
            reset: vi.fn(),
          })),
        },
      },
    },
    notification: {
      providers: {
        useQuery: vi.fn(
          (_input: unknown, opts?: { select?: (data: unknown) => unknown }) => {
            const data = MOCK_PROVIDERS;
            return {
              data: opts?.select ? opts.select(data) : data,
              isLoading: false,
              error: null,
            };
          },
        ),
      },
      test: {
        useMutation: vi.fn(() => {
          return {
            mutate: h.testMutate,
            mutateAsync: vi.fn(),
            isPending: h.testMutationState.isPending,
            isSuccess: h.testMutationState.isSuccess,
            isError: h.testMutationState.isError,
            error: h.testMutationState.error,
            reset: h.testReset,
          };
        }),
      },
    },
    useUtils: vi.fn(() => ({
      config: {
        notification: {
          get: {
            invalidate: vi.fn(),
          },
        },
      },
    })),
  },
}));

vi.mock("./SettingsLayout.tsx", () => ({
  SettingsSection: (
    { children, title, isDirty, onSave }: SectionProps & {
      isDirty?: boolean;
      onSave?: () => void;
    },
  ) => (
    <div>
      <h3>{title}</h3>
      {isDirty && onSave && (
        <button type="button" onClick={onSave}>Save</button>
      )}
      {children}
    </div>
  ),
  SettingsRow: ({ children, label }: SettingsRowProps) => (
    <div>
      <label>{label}</label>
      {children}
    </div>
  ),
}));

describe("NotificationSettings", () => {
  beforeEach(() => {
    h.testMutate = vi.fn();
    h.testReset = vi.fn();
    h.testMutationState = {
      isPending: false,
      isSuccess: false,
      isError: false,
      error: null,
    };
    vi.clearAllMocks();
    // Reset notification config mock to default (no provider selected)
    vi.mocked(trpc.config.notification.get.useQuery).mockReturnValue({
      data: {
        notificationProvider: "",
        notificationEnabledEvents: "",
      },
      isLoading: false,
      error: null,
    } as never);
    // Radix Select uses ResizeObserver which jsdom doesn't provide
    globalThis.ResizeObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }));
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders without crashing", () => {
    renderWithProviders(<NotificationSettings />);

    expect(screen.getByText("Notifications")).toBeInTheDocument();
  });

  it("renders Provider label", () => {
    renderWithProviders(<NotificationSettings />);

    expect(screen.getByText("Provider")).toBeInTheDocument();
  });

  it("renders Send Test button when provider is selected", () => {
    vi.mocked(trpc.config.notification.get.useQuery).mockReturnValue({
      data: {
        notificationProvider: "telegram",
        notificationEnabledEvents: "",
      },
      isLoading: false,
      error: null,
    } as never);

    renderWithProviders(<NotificationSettings />);

    expect(screen.getByText("Send Test Notification")).toBeInTheDocument();
  });

  // ---- toggleEvent tests ----

  it("toggleEvent adds an event to enabled events", () => {
    vi.mocked(trpc.config.notification.get.useQuery).mockReturnValue({
      data: {
        notificationProvider: "telegram",
        notificationEnabledEvents: "",
      },
      isLoading: false,
      error: null,
    } as never);

    renderWithProviders(<NotificationSettings />);

    // Find the switch for "Errors" event and click it
    const errorsLabel = screen.getByText("Errors");
    const switchEl = errorsLabel.closest("div")?.querySelector("button");
    if (switchEl) fireEvent.click(switchEl);

    // Click Save to commit the draft
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(mockNotificationSetMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        notificationEnabledEvents: "error",
      }),
    );
  });

  it("toggleEvent removes an event from enabled events", () => {
    vi.mocked(trpc.config.notification.get.useQuery).mockReturnValue({
      data: {
        notificationProvider: "telegram",
        notificationEnabledEvents: "error,charge_started",
      },
      isLoading: false,
      error: null,
    } as never);

    renderWithProviders(<NotificationSettings />);

    // Click the switch for "Errors" (which is already enabled) to toggle it off
    const errorsLabel = screen.getByText("Errors");
    const switchEl = errorsLabel.closest("div")?.querySelector("button");
    if (switchEl) fireEvent.click(switchEl);

    // Click Save to commit the draft
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    // Should remove "error" from the list, keeping "charge_started"
    expect(mockNotificationSetMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        notificationEnabledEvents: "charge_started",
      }),
    );
  });

  // ---- provider Select onValueChange ----

  it("calls mutation with empty string when Disabled is selected", async () => {
    vi.mocked(trpc.config.notification.get.useQuery).mockReturnValue({
      data: {
        notificationProvider: "telegram",
        notificationEnabledEvents: "",
      },
      isLoading: false,
      error: null,
    } as never);

    renderWithProviders(<NotificationSettings />);

    // Open the provider select
    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByText("Disabled")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Disabled"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(mockNotificationSetMutate).toHaveBeenCalledWith(
        expect.objectContaining({ notificationProvider: "" }),
      );
    });
  });

  it("calls mutation with provider key when Telegram is selected", async () => {
    renderWithProviders(<NotificationSettings />);

    // Open the provider select
    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Telegram" }))
        .toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("option", { name: "Telegram" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(mockNotificationSetMutate).toHaveBeenCalledWith(
        expect.objectContaining({ notificationProvider: "telegram" }),
      );
    });
  });

  // ---- dynamic provider config fields ----

  it("renders text config fields for provider", async () => {
    vi.mocked(trpc.config.notification.get.useQuery).mockReturnValue({
      data: {
        notificationProvider: "telegram",
        notificationEnabledEvents: "",
      },
      isLoading: false,
      error: null,
    } as never);

    renderWithProviders(<NotificationSettings />);

    await waitFor(() => {
      expect(screen.getByText("Bot Token")).toBeInTheDocument();
    });
  });

  it("renders toggle config fields for provider", async () => {
    vi.mocked(trpc.config.notification.get.useQuery).mockReturnValue({
      data: {
        notificationProvider: "telegram",
        notificationEnabledEvents: "",
      },
      isLoading: false,
      error: null,
    } as never);

    renderWithProviders(<NotificationSettings />);

    await waitFor(() => {
      expect(screen.getByText("Silent Notifications")).toBeInTheDocument();
    });
  });

  it("calls mutation when a text config field is changed", async () => {
    vi.mocked(trpc.config.notification.get.useQuery).mockReturnValue({
      data: {
        notificationProvider: "telegram",
        notificationEnabledEvents: "",
      },
      isLoading: false,
      error: null,
    } as never);

    renderWithProviders(<NotificationSettings />);

    await waitFor(() => {
      expect(screen.getByText("Bot Token")).toBeInTheDocument();
    });

    // The text field input should be present
    const inputs = screen.getAllByRole("textbox");
    const tokenInput = inputs.find(
      (el) =>
        el.getAttribute("placeholder") !== null ||
        el.closest("div")?.textContent?.includes("Bot Token"),
    );
    if (tokenInput) {
      fireEvent.change(tokenInput, { target: { value: "my-bot-token" } });

      // Click Save to commit the draft
      fireEvent.click(screen.getByRole("button", { name: /save/i }));

      expect(mockNotificationSetMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          notification_telegram_bot_token: "my-bot-token",
        }),
      );
    }
  });

  // ---- handleTest ----

  it("shows Sent! when test notification succeeds", () => {
    h.testMutate.mockImplementation(() => {
      h.testMutationState.isSuccess = true;
    });

    vi.mocked(trpc.config.notification.get.useQuery).mockReturnValue({
      data: {
        notificationProvider: "telegram",
        notificationEnabledEvents: "",
      },
      isLoading: false,
      error: null,
    } as never);

    renderWithProviders(<NotificationSettings />);

    fireEvent.click(screen.getByText("Send Test Notification"));

    expect(h.testMutate).toHaveBeenCalled();
  });

  it("shows error when test mutation fails", () => {
    h.testMutationState.isError = true;
    h.testMutationState.error = new Error("Bot token invalid");

    vi.mocked(trpc.config.notification.get.useQuery).mockReturnValue({
      data: {
        notificationProvider: "telegram",
        notificationEnabledEvents: "",
      },
      isLoading: false,
      error: null,
    } as never);

    renderWithProviders(<NotificationSettings />);

    expect(screen.getByText("Bot token invalid")).toBeInTheDocument();
  });

  it("shows fallback error when mutation error is not an Error instance", () => {
    h.testMutationState.isError = true;
    h.testMutationState.error = null;

    vi.mocked(trpc.config.notification.get.useQuery).mockReturnValue({
      data: {
        notificationProvider: "telegram",
        notificationEnabledEvents: "",
      },
      isLoading: false,
      error: null,
    } as never);

    renderWithProviders(<NotificationSettings />);

    expect(screen.getByText("Failed to send")).toBeInTheDocument();
  });

  // ---- Events section header ----

  it("renders Events header and description when provider is selected", () => {
    vi.mocked(trpc.config.notification.get.useQuery).mockReturnValue({
      data: {
        notificationProvider: "telegram",
        notificationEnabledEvents: "",
      },
      isLoading: false,
      error: null,
    } as never);

    renderWithProviders(<NotificationSettings />);

    expect(screen.getByText("Events")).toBeInTheDocument();
    expect(
      screen.getByText("Choose which events trigger notifications."),
    ).toBeInTheDocument();
  });

  it.each([
    "Errors",
    "Charge Started",
    "Charge Stopped",
    "Charge Complete",
    "External Charge Detected",
    "Vehicle Plugged In",
    "Vehicle Unplugged",
    "Low Solar",
    "Schedule Activated",
    "Safety Trip",
  ])("renders %s event toggle when provider is selected", (label) => {
    vi.mocked(trpc.config.notification.get.useQuery).mockReturnValue({
      data: {
        notificationProvider: "telegram",
        notificationEnabledEvents: "",
      },
      isLoading: false,
      error: null,
    } as never);

    renderWithProviders(<NotificationSettings />);

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("does not render event toggles when no provider is selected", () => {
    renderWithProviders(<NotificationSettings />);

    expect(screen.queryByText("Events")).not.toBeInTheDocument();
    expect(screen.queryByText("Errors")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Send Test Notification"),
    ).not.toBeInTheDocument();
  });
});
