import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../../../client/src/test-utils.tsx";
import { VirtualKeyPairingStep } from "./VirtualKeyPairingStep.tsx";
import { trpc } from "./trpc.ts";
import { makeStepProps } from "./test-helpers/stepProps.ts";

const mocks = vi.hoisted(() => ({
  checkKeyPairingMutate: vi.fn(),
  capturedCheckOnSuccess: { current: undefined } as {
    current: ((result: { paired: boolean | null }) => void) | undefined;
  },
}));

vi.mock("./trpc.ts", () => ({
  trpc: {
    tesla: {
      getConfig: {
        useQuery: vi.fn(() => ({
          data: {
            teslaPublicKeyDomain: "https://chargeha.example.com",
            ecPublicKeyPem: "",
          },
          isLoading: false,
          error: null,
        })),
      },
      checkKeyPairing: {
        useMutation: vi.fn(
          (
            opts?: { onSuccess?: (result: { paired: boolean | null }) => void },
          ) => {
            mocks.capturedCheckOnSuccess.current = opts?.onSuccess;
            return {
              mutate: mocks.checkKeyPairingMutate,
              isPending: false,
              error: null,
              data: null,
            };
          },
        ),
      },
    },
    vehicle: {
      list: {
        useQuery: vi.fn(() => ({
          data: { vehicles: [] },
          isLoading: false,
          error: null,
        })),
      },
    },
  },
}));

vi.mock("qrcode.react", () => ({
  QRCodeSVG: ({ value }: { value: string }) => (
    <svg data-testid="qr-svg" data-value={value} />
  ),
}));

// ---- Tests ----

describe("VirtualKeyPairingStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.capturedCheckOnSuccess.current = undefined;
    vi.mocked(trpc.vehicle.list.useQuery).mockReturnValue({
      data: {
        vehicles: [
          {
            id: "5YJ3E1EA1LF000001",
            name: "My Model 3",
            adapterType: "tesla",
            priority: 1,
            config: "{}",
            mode: "auto",
            state: null,
          },
        ],
      },
      isLoading: false,
      error: null,
    } as never);
  });

  afterEach(() => {
    cleanup();
  });

  // ---- Initial render ----

  it("renders pairing instructions for each selected vehicle", async () => {
    renderWithProviders(<VirtualKeyPairingStep {...makeStepProps()} />);

    await waitFor(() => {
      expect(screen.getByText("My Model 3")).toBeInTheDocument();
      expect(screen.getByText(/5YJ3E1EA1LF000001/)).toBeInTheDocument();
    });
  });

  it("shows pairing URL containing the domain", async () => {
    renderWithProviders(<VirtualKeyPairingStep {...makeStepProps()} />);

    await waitFor(() => {
      expect(
        screen.getByText(
          "https://tesla.com/_ak/chargeha.example.com",
        ),
      ).toBeInTheDocument();
    });
  });

  it("renders QR code element", async () => {
    renderWithProviders(<VirtualKeyPairingStep {...makeStepProps()} />);

    await waitFor(() => {
      expect(screen.getByTestId("qr-code")).toBeInTheDocument();
    });
  });

  // ---- API calls ----

  it("verify button calls checkKeyPairing mutation", async () => {
    renderWithProviders(<VirtualKeyPairingStep {...makeStepProps()} />);

    await waitFor(() => {
      expect(screen.getByText("Verify Pairing")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Verify Pairing"));

    await waitFor(() => {
      expect(mocks.checkKeyPairingMutate).toHaveBeenCalledTimes(1);
    });
  });

  it("shows success after successful verification", async () => {
    // Make mutate trigger onSuccess with paired: true
    mocks.checkKeyPairingMutate.mockImplementation(() => {
      mocks.capturedCheckOnSuccess.current?.({ paired: true });
    });

    renderWithProviders(<VirtualKeyPairingStep {...makeStepProps()} />);

    await waitFor(() => {
      expect(screen.getByText("Verify Pairing")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Verify Pairing"));

    await waitFor(() => {
      expect(
        screen.getByText(/Virtual key paired successfully/),
      ).toBeInTheDocument();
    });
  });
});
