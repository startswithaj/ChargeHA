import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../../client/src/test-utils.tsx";
import { StepNextHarness } from "../../../../client/src/components/Wizard/steps/test-helpers/StepNextHarness.tsx";
import { ocppSetupStep } from "./OcppSetupStep.tsx";

const mocks = vi.hoisted(() => ({ setConfigMutate: vi.fn() }));

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
});
