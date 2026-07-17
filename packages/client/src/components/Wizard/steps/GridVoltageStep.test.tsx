import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { gridVoltageStep } from "./GridVoltageStep.tsx";
import { trpc } from "../../../trpc.ts";
import { StepNextHarness } from "./test-helpers/StepNextHarness.tsx";

const { mockMutate } = vi.hoisted(() => ({ mockMutate: vi.fn() }));

vi.mock("../../../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    vehicle: {
      list: {
        useQuery: vi.fn(() => ({
          data: { vehicles: [] },
          isLoading: false,
          error: null,
        })),
      },
    },
    // useSolarConfig / useSolarConfigMutation depend on these tRPC paths
    config: {
      solar: {
        get: {
          useQuery: vi.fn(() => ({
            data: { gridVoltage: 230 },
            isLoading: false,
            error: null,
          })),
        },
        set: {
          useMutation: vi.fn(() => ({
            mutate: mockMutate,
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
    energy: {
      realtime: {
        useQuery: vi.fn(() => ({
          data: undefined,
          isLoading: false,
          error: null,
        })),
      },
    },
    subscription: {
      onEvents: {
        useSubscription: vi.fn(),
      },
    },
    useUtils: vi.fn(() => ({
      config: {
        solar: {
          get: { invalidate: vi.fn() },
        },
      },
      energy: {
        realtime: { setData: vi.fn() },
      },
    })),
  },
}));

// Radix Select uses ScrollArea which requires ResizeObserver
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Radix Select calls scrollIntoView on focused items
Element.prototype.scrollIntoView = vi.fn();

// ---- Tests ----

describe("GridVoltageStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset to default mock values
    vi.mocked(trpc.vehicle.list.useQuery).mockReturnValue({
      data: { vehicles: [] },
      isLoading: false,
      error: null,
    } as never);

    vi.mocked(trpc.config.solar.get.useQuery).mockReturnValue({
      data: { gridVoltage: 230 },
      isLoading: false,
      error: null,
    } as never);

    vi.mocked(trpc.energy.realtime.useQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    } as never);
  });

  afterEach(() => {
    cleanup();
  });

  // ---- Rendering ----

  it("renders the description text", () => {
    renderWithProviders(<StepNextHarness def={gridVoltageStep} />);

    expect(
      screen.getByText(/this setting is used as a fallback/),
    ).toBeInTheDocument();
  });

  it.each<[string, { gridVoltage: number } | undefined, string]>([
    ["explicit 120V", { gridVoltage: 120 }, "120V (North America, Japan)"],
    [
      "missing config defaults to 230V",
      undefined,
      "230V (Europe, Asia, Africa, Australia)",
    ],
  ])("renders dropdown selection (%s)", (_label, data, expectedText) => {
    vi.mocked(trpc.config.solar.get.useQuery).mockReturnValue({
      data,
      isLoading: false,
      error: null,
    } as never);

    renderWithProviders(<StepNextHarness def={gridVoltageStep} />);

    expect(screen.getByText(expectedText)).toBeInTheDocument();
  });

  // ---- Detected readings callout ----

  type Vehicle = { name: string; state: { chargerVoltage: number } };
  type ReadingsRow = [
    string,
    { realtime: { gridVoltageV: number } } | undefined,
    Vehicle[],
    string[], // present
    string[], // absent
  ];

  it.each<ReadingsRow>([
    [
      "inverter voltage only",
      { realtime: { gridVoltageV: 232.7 } },
      [],
      ["Detected voltage readings:", "Inverter/Smart Meter: 233V"],
      [],
    ],
    [
      "vehicle voltage >= 100V only",
      undefined,
      [{ name: "Model 3", state: { chargerVoltage: 241 } }],
      ["Detected voltage readings:", "Model 3: 241V"],
      [],
    ],
    [
      "no valid readings",
      undefined,
      [],
      [],
      ["Detected voltage readings:"],
    ],
    [
      "vehicle voltage < 100V is junk and filtered",
      undefined,
      [{ name: "Model Y", state: { chargerVoltage: 2 } }],
      [],
      ["Detected voltage readings:", "Model Y"],
    ],
    [
      "inverter + vehicle readings, junk filtered",
      { realtime: { gridVoltageV: 230.4 } },
      [
        { name: "Model 3", state: { chargerVoltage: 241 } },
        { name: "Leaf", state: { chargerVoltage: 50 } },
      ],
      [
        "Detected voltage readings:",
        "Inverter/Smart Meter: 230V",
        "Model 3: 241V",
      ],
      ["Leaf"],
    ],
  ])(
    "detected readings callout: %s",
    (_label, energyData, vehicles, present, absent) => {
      vi.mocked(trpc.energy.realtime.useQuery).mockReturnValue({
        data: energyData,
        isLoading: false,
        error: null,
      } as never);

      vi.mocked(trpc.vehicle.list.useQuery).mockReturnValue({
        data: { vehicles },
        isLoading: false,
        error: null,
      } as never);

      renderWithProviders(<StepNextHarness def={gridVoltageStep} />);

      present.forEach((text) =>
        expect(screen.getByText(text)).toBeInTheDocument()
      );
      absent.forEach((text) =>
        expect(screen.queryByText(new RegExp(text))).not.toBeInTheDocument()
      );
    },
  );

  // ---- User interactions ----

  it("renders no step-owned continue button — the shell's Next advances", () => {
    renderWithProviders(<StepNextHarness def={gridVoltageStep} />);

    expect(screen.queryByRole("button", { name: "Continue" }))
      .not.toBeInTheDocument();
  });
});
