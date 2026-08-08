import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../../client/src/test-utils.tsx";
import { StepNextHarness } from "../../../../client/src/components/Wizard/steps/test-helpers/StepNextHarness.tsx";
import { ocppSetupStep } from "./OcppSetupStep.tsx";

const mocks = vi.hoisted(() => ({
  setConfigMutate: vi.fn(),
  testMutate: vi.fn(),
}));

vi.mock("./trpc.ts", () => ({
  trpc: {
    plugin: {
      charger: {
        ocpp: {
          getConfig: {
            useQuery: vi.fn(() => ({ data: {}, isLoading: false })),
          },
          setConfig: {
            useMutation: vi.fn(() => ({
              mutate: mocks.setConfigMutate,
              mutateAsync: mocks.setConfigMutate,
              isPending: false,
            })),
          },
          testConnection: {
            useMutation: vi.fn(() => ({
              mutate: mocks.testMutate,
              isPending: false,
            })),
          },
          beginPairing: { useMutation: vi.fn(() => ({ mutate: vi.fn() })) },
          cancelPairing: { useMutation: vi.fn(() => ({ mutate: vi.fn() })) },
          pairingStatus: {
            useQuery: vi.fn(() => ({
              data: {
                pairing: {
                  armed: false,
                  expiresAt: null,
                  announcedId: null,
                  info: null,
                  seen: [],
                },
                knocking: null,
                baseUrls: [],
              },
            })),
          },
        },
      },
    },
  },
}));

describe("ocppSetupStep", () => {
  afterEach(() => {
    cleanup();
    mocks.setConfigMutate.mockReset();
  });

  it("typing in a field fires no mutation — only Next saves", () => {
    renderWithProviders(
      <StepNextHarness def={ocppSetupStep} stepProps={{ chargerId: null }} />,
    );

    // No accessible label association on this field — find it by its
    // default value ("32", the OCPP_DEFAULTS max amps) instead.
    fireEvent.change(screen.getByDisplayValue("32"), {
      target: { value: "16" },
    });

    expect(mocks.setConfigMutate).not.toHaveBeenCalled();
  });

  it("Next is blocked until an ID exists, and a typed one is enough", () => {
    renderWithProviders(
      <StepNextHarness def={ocppSetupStep} stepProps={{ chargerId: null }} />,
    );

    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByText("Detect a charger, or enter its ID"))
      .toBeInTheDocument();

    // No charger has answered pairing here — the mock reports `seen: []`.
    fireEvent.change(screen.getByPlaceholderText("not detected yet"), {
      target: { value: "CP-1234" },
    });

    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("Test Connection is disabled until there is a charger ID", () => {
    renderWithProviders(
      <StepNextHarness def={ocppSetupStep} stepProps={{ chargerId: null }} />,
    );

    expect(screen.getByRole("button", { name: "Test Connection" }))
      .toBeDisabled();
    expect(screen.getByText("Detect or enter a Charger ID first."))
      .toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("not detected yet"), {
      target: { value: "CP-1234" },
    });

    // Re-queried, not reused: the step is keyed by charger id, so changing the
    // id remounts it and any earlier verdict goes with the old node.
    const testButton = screen.getByRole("button", { name: "Test Connection" });
    expect(testButton).toBeEnabled();

    fireEvent.click(testButton);
    // Addressed by charge point id, not row id — no row exists at this step.
    expect(mocks.testMutate).toHaveBeenCalledWith({ chargePointId: "CP-1234" });
  });
});
