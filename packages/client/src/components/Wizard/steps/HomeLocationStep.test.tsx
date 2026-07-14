import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { HomeLocationStep } from "./HomeLocationStep.tsx";
import { StepNextHarness } from "./test-helpers/StepNextHarness.tsx";
import { trpc } from "../../../trpc.ts";
import type { StepProps } from "../WizardShell.tsx";

const { mockHomeSetMutateAsync, mockHomeGetInvalidate } = vi.hoisted(() => ({
  mockHomeSetMutateAsync: vi.fn(),
  mockHomeGetInvalidate: vi.fn(),
}));

vi.mock("../../../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    config: {
      home: {
        get: {
          useQuery: vi.fn(() => ({
            data: { homeLatitude: null, homeLongitude: null },
            isLoading: false,
            error: null,
          })),
        },
        set: {
          useMutation: vi.fn(() => ({
            mutate: vi.fn(),
            mutateAsync: mockHomeSetMutateAsync,
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
    tesla: {
      getConfig: {
        useQuery: vi.fn(() => ({ data: {}, isLoading: false, error: null })),
      },
    },
    useUtils: vi.fn(() => ({
      config: {
        home: {
          get: {
            invalidate: mockHomeGetInvalidate,
          },
        },
      },
      vehicle: {
        location: {
          fetch: vi.fn(),
        },
      },
    })),
    vehicle: {
      list: {
        useQuery: vi.fn(() => ({
          data: { vehicles: [] },
          isLoading: false,
          error: null,
        })),
      },
      refreshState: {
        useMutation: vi.fn(() => ({
          mutate: vi.fn(),
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
}));

vi.mock("./HomeLocationParts.tsx", () => ({
  AddressSearch: () => <div data-testid="address-search" />,
}));

vi.mock("../../StaticMap/StaticMap.tsx", () => ({
  StaticMap: (
    { latitude, longitude }: { latitude: number; longitude: number },
  ) => (
    <div data-testid="static-map" data-lat={latitude} data-lng={longitude} />
  ),
}));

// ---- Tests ----

describe("HomeLocationStep", () => {
  const makeStepProps = (overrides: Partial<StepProps> = {}): StepProps => ({
    onNext: vi.fn(),
    onBack: vi.fn(),
    onSkip: vi.fn(),
    onSkipTo: vi.fn(),
    onSkipToEnd: vi.fn(),
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockHomeSetMutateAsync.mockResolvedValue({});
    vi.mocked(trpc.vehicle.list.useQuery).mockReturnValue({
      data: { vehicles: [] },
      isLoading: false,
      error: null,
    } as never);
  });

  afterEach(() => {
    cleanup();
  });

  // ---- Initial render ----

  it("renders address search component", async () => {
    renderWithProviders(<HomeLocationStep {...makeStepProps()} />);

    await waitFor(() => {
      expect(screen.getByTestId("address-search")).toBeInTheDocument();
    });
  });

  it("renders GPS button", () => {
    renderWithProviders(<HomeLocationStep {...makeStepProps()} />);

    expect(
      screen.getByRole("button", { name: /Use my current location/ }),
    ).toBeInTheDocument();
  });

  // ---- API calls ----

  it("clicking Next saves coordinates via API", async () => {
    vi.mocked(trpc.config.home.get.useQuery).mockReturnValue({
      data: { homeLatitude: -33.868820, homeLongitude: 151.209290 },
      isLoading: false,
      error: null,
    } as never);

    const onNext = vi.fn();
    renderWithProviders(
      <StepNextHarness onAdvance={onNext}>
        <HomeLocationStep {...makeStepProps({ onNext })} />
      </StepNextHarness>,
    );

    // Wait for config to load and coordinates to be set
    await waitFor(() => {
      expect(screen.getByText(/Location set/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(mockHomeSetMutateAsync).toHaveBeenCalledWith({
        homeLatitude: -33.868820,
        homeLongitude: 151.209290,
      });
    });

    await waitFor(() => {
      expect(onNext).toHaveBeenCalled();
    });
  });
});
