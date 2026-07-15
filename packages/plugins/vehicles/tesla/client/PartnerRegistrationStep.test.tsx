import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../../../client/src/test-utils.tsx";
import { PartnerRegistrationStep } from "./PartnerRegistrationStep.tsx";
import { trpc } from "./trpc.ts";

const mocks = vi.hoisted(() => {
  const registerMutate = vi.fn();
  return {
    registerMutate,
    defaultResult: {
      mutate: registerMutate,
      isSuccess: false,
      isError: false,
      isPending: false,
      error: null as { message: string } | null,
      data: null as { success: boolean; message: string } | null,
    },
  };
});

vi.mock("./trpc.ts", () => ({
  trpc: {
    plugin: {
      vehicle: {
        tesla: {
          registerPartner: {
            useMutation: vi.fn(() => mocks.defaultResult),
          },
        },
      },
    },
  },
}));

// ---- Tests ----

describe("PartnerRegistrationStep", () => {
  function setRegisterPartnerState(
    overrides: Partial<typeof mocks.defaultResult>,
  ): void {
    vi.mocked(trpc.plugin.vehicle.tesla.registerPartner.useMutation)
      .mockReturnValue({
        ...mocks.defaultResult,
        mutate: mocks.registerMutate,
        ...overrides,
      } as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // ---- API calls ----

  it("calls registerPartner mutation on mount", async () => {
    renderWithProviders(<PartnerRegistrationStep />);

    await waitFor(() => {
      expect(mocks.registerMutate).toHaveBeenCalledTimes(1);
    });
  });

  it.each(
    [
      [
        "pending",
        { isPending: true },
        /Registering partner account\.\.\./,
      ],
      [
        "success",
        {
          isSuccess: true,
          data: { success: true, message: "Partner registration successful" },
        },
        /Partner registration successful/,
      ],
      [
        "error",
        {
          isError: true,
          error: { message: "Tesla client credentials not configured" },
        },
        /Tesla client credentials not configured/,
      ],
    ] as const,
  )(
    "renders %s state",
    async (_label, overrides, expected) => {
      setRegisterPartnerState(overrides);

      renderWithProviders(<PartnerRegistrationStep />);

      await waitFor(() => {
        expect(screen.getByText(expected)).toBeInTheDocument();
      });
    },
  );

  // ---- User interactions ----

  it("retry button re-calls the mutation", async () => {
    setRegisterPartnerState({
      isError: true,
      error: { message: "Failed to obtain partner token" },
    });

    renderWithProviders(<PartnerRegistrationStep />);

    // Wait for error state
    await waitFor(() => {
      expect(
        screen.getByText("Failed to obtain partner token"),
      ).toBeInTheDocument();
    });

    // Click retry
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));

    // Should call mutate again (once on mount + once on retry)
    await waitFor(() => {
      expect(mocks.registerMutate).toHaveBeenCalledTimes(2);
    });
  });
});
