import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { HomeLocationSection } from "./HomeLocationSection.tsx";

const { mockMutate, h } = vi.hoisted(() => ({
  mockMutate: vi.fn(),
  h: {
    saveStatus: { state: "idle" as const, tick: 0 } as {
      state: "idle" | "saving" | "saved";
      tick: number;
    },
    vehiclesData: null as unknown,
    acState: {
      query: "",
      setQuery: vi.fn(),
      updateQuery: vi.fn(),
      suggestions: [] as unknown[],
      open: false,
      setOpen: vi.fn(),
      clear: vi.fn(),
    },
    geoState: {
      geoStatus: "idle" as "idle" | "loading" | "error",
      geoError: "",
      geoLoadingMsg: "",
      setGeoStatus: vi.fn(),
      setGeoError: vi.fn(),
      setGeoLoadingMsg: vi.fn(),
      handleBrowserLocation: vi.fn(),
      handleVehicleLocation: vi.fn(),
    },
    capturedGeocodeMutationOpts: {} as {
      mutationFn?: (q: string) => Promise<unknown>;
      onMutate?: () => void;
      onSuccess?: (result: unknown) => void;
      onError?: (err: unknown) => void;
    },
  },
}));

vi.mock("../../../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    vehicle: {
      list: {
        useQuery: vi.fn(() => ({
          data: h.vehiclesData,
        })),
      },
    },
    useUtils: vi.fn(() => ({
      client: {
        config: {
          geocode: {
            query: vi.fn(() =>
              Promise.resolve({
                latitude: 48.123456,
                longitude: 11.654321,
                displayName: "Munich, Germany",
              })
            ),
          },
        },
      },
    })),
  },
}));

vi.mock("../../../hooks/useSectionConfig.ts", () => ({
  useHomeConfigMutation: vi.fn(() => ({
    mutate: mockMutate,
    saveStatus: h.saveStatus,
  })),
}));

vi.mock("../../../hooks/useAddressAutocomplete.ts", () => ({
  useAddressAutocomplete: vi.fn(() => h.acState),
}));

vi.mock("../../../hooks/useLocationFetcher.ts", () => ({
  useLocationFetcher: vi.fn(() => h.geoState),
}));

vi.mock("../../StaticMap/StaticMap.tsx", () => ({
  StaticMap: vi.fn((
    { latitude, longitude }: { latitude: number; longitude: number },
  ) => <div data-testid="static-map">{`${latitude},${longitude}`}</div>),
}));

vi.mock("./SettingsLayout.tsx", () => ({
  SettingsSection: vi.fn(
    ({
      title,
      children,
    }: {
      title: string;
      children: ReactNode;
    }) => (
      <div data-testid="settings-section">
        <div>{title}</div>
        {children}
      </div>
    ),
  ),
}));

vi.mock("./AddressSearchInput.tsx", () => ({
  AddressSearchInput: vi.fn(
    ({
      onSelect,
      onLookup,
      disabled,
    }: {
      onSelect: (s: unknown) => void;
      onLookup: () => void;
      disabled: boolean;
    }) => (
      <div data-testid="address-search-input">
        <button
          type="button"
          data-testid="select-suggestion"
          onClick={() =>
            onSelect({
              lat: "48.1",
              lon: "11.6",
              display_name: "Mock Place",
            })}
        >
          Select
        </button>
        <button type="button" data-testid="lookup" onClick={onLookup}>
          Lookup
        </button>
        <span data-testid="search-disabled">{String(disabled)}</span>
      </div>
    ),
  ),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useMutation: vi.fn((opts: Record<string, unknown>) => {
      h.capturedGeocodeMutationOpts = opts;
      return {
        mutate: vi.fn((q: string) => {
          if (h.capturedGeocodeMutationOpts.onMutate) {
            h.capturedGeocodeMutationOpts.onMutate();
          }
          const fn = h.capturedGeocodeMutationOpts.mutationFn;
          if (fn) {
            fn(q)
              .then((result: unknown) => {
                if (h.capturedGeocodeMutationOpts.onSuccess) {
                  h.capturedGeocodeMutationOpts.onSuccess(result);
                }
              })
              .catch((err: unknown) => {
                if (h.capturedGeocodeMutationOpts.onError) {
                  h.capturedGeocodeMutationOpts.onError(err);
                }
              });
          }
        }),
      };
    }),
  };
});

// ── Tests ──

describe("HomeLocationSection", () => {
  beforeEach(() => {
    mockMutate.mockReset();
    h.vehiclesData = null;
    h.saveStatus = { state: "idle", tick: 0 };
    h.acState = {
      query: "",
      setQuery: vi.fn(),
      updateQuery: vi.fn(),
      suggestions: [],
      open: false,
      setOpen: vi.fn(),
      clear: vi.fn(),
    };
    h.geoState = {
      geoStatus: "idle",
      geoError: "",
      geoLoadingMsg: "",
      setGeoStatus: vi.fn(),
      setGeoError: vi.fn(),
      setGeoLoadingMsg: vi.fn(),
      handleBrowserLocation: vi.fn(),
      handleVehicleLocation: vi.fn(),
    };
    h.capturedGeocodeMutationOpts = {};
  });

  afterEach(() => {
    cleanup();
  });

  it("renders Home Location section", () => {
    renderWithProviders(<HomeLocationSection homeConfig={null} />);
    expect(screen.getByText("Home Location")).toBeInTheDocument();
  });

  it.each<
    [string, null | { homeLatitude: null; homeLongitude: null }]
  >([
    ["homeConfig is null", null],
    ["coords are null", { homeLatitude: null, homeLongitude: null }],
  ])("shows 'no location set' when %s", (_label, homeConfig) => {
    renderWithProviders(<HomeLocationSection homeConfig={homeConfig} />);
    expect(screen.getByText(/No location set/)).toBeInTheDocument();
  });

  it("shows map and coordinates when coords are set", () => {
    renderWithProviders(
      <HomeLocationSection
        homeConfig={{ homeLatitude: -37.8136, homeLongitude: 144.9631 }}
      />,
    );

    expect(screen.getByTestId("static-map")).toBeInTheDocument();
    expect(screen.getByText(/-37.813600, 144.963100/)).toBeInTheDocument();
    // No "no location set" message
    expect(screen.queryByText(/No location set/)).not.toBeInTheDocument();
  });

  it("renders Use my current location button", () => {
    renderWithProviders(<HomeLocationSection homeConfig={null} />);
    expect(
      screen.getByText(/Use my current location/),
    ).toBeInTheDocument();
  });

  it("renders vehicle GPS buttons when vehicles are available", () => {
    h.vehiclesData = {
      vehicles: [
        {
          id: "VIN1",
          name: "Model 3",
          adapterType: "tesla",
          createdAt: "",
          updatedAt: "",
        },
        {
          id: "VIN2",
          name: "Model Y",
          adapterType: "tesla",
          createdAt: "",
          updatedAt: "",
        },
      ],
    };

    renderWithProviders(<HomeLocationSection homeConfig={null} />);
    expect(screen.getByText(/Use Model 3 GPS/)).toBeInTheDocument();
    expect(screen.getByText(/Use Model Y GPS/)).toBeInTheDocument();
  });

  it("calls handleBrowserLocation when Use my current location is clicked", () => {
    renderWithProviders(<HomeLocationSection homeConfig={null} />);
    fireEvent.click(screen.getByText(/Use my current location/));
    expect(h.geoState.handleBrowserLocation).toHaveBeenCalled();
  });

  it("calls handleVehicleLocation when vehicle GPS button is clicked", () => {
    h.vehiclesData = {
      vehicles: [
        {
          id: "VIN1",
          name: "Model 3",
          adapterType: "tesla",
          createdAt: "",
          updatedAt: "",
        },
      ],
    };

    renderWithProviders(<HomeLocationSection homeConfig={null} />);
    fireEvent.click(screen.getByText(/Use Model 3 GPS/));
    expect(h.geoState.handleVehicleLocation).toHaveBeenCalledWith(
      "VIN1",
      expect.any(Function),
    );
  });

  it("disables buttons when geoStatus is loading", () => {
    h.geoState.geoStatus = "loading";
    renderWithProviders(<HomeLocationSection homeConfig={null} />);

    expect(
      screen.getByText(/Use my current location/).closest("button"),
    ).toBeDisabled();
  });

  it("shows loading message when loading with a message", () => {
    h.geoState.geoStatus = "loading";
    h.geoState.geoLoadingMsg = "Getting your location...";

    renderWithProviders(<HomeLocationSection homeConfig={null} />);
    expect(screen.getByText("Getting your location...")).toBeInTheDocument();
  });

  it("shows error message when geo status is error", () => {
    h.geoState.geoStatus = "error";
    h.geoState.geoError = "Location permission denied";

    renderWithProviders(<HomeLocationSection homeConfig={null} />);
    expect(
      screen.getByText("Location permission denied"),
    ).toBeInTheDocument();
  });

  it("renders Clear button when coords are set", () => {
    renderWithProviders(
      <HomeLocationSection
        homeConfig={{ homeLatitude: -37.8, homeLongitude: 144.9 }}
      />,
    );

    expect(screen.getByText("Clear")).toBeInTheDocument();
  });

  it("clears coords when Clear button is clicked", () => {
    renderWithProviders(
      <HomeLocationSection
        homeConfig={{ homeLatitude: -37.8, homeLongitude: 144.9 }}
      />,
    );

    fireEvent.click(screen.getByText("Clear"));
    expect(mockMutate).toHaveBeenCalledWith({
      homeLatitude: null,
      homeLongitude: null,
    });
  });

  it("renders a link to Google Maps when coords are set", () => {
    renderWithProviders(
      <HomeLocationSection
        homeConfig={{ homeLatitude: -37.8136, homeLongitude: 144.9631 }}
      />,
    );

    const link = screen.getByText(/-37.813600, 144.963100/).closest("a");
    expect(link).toHaveAttribute(
      "href",
      "https://www.google.com/maps?q=-37.8136,144.9631",
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("calls mutation with parsed coords when a suggestion is selected", () => {
    renderWithProviders(<HomeLocationSection homeConfig={null} />);
    fireEvent.click(screen.getByTestId("select-suggestion"));

    expect(mockMutate).toHaveBeenCalledWith({
      homeLatitude: expect.any(Number),
      homeLongitude: expect.any(Number),
    });
  });

  it.each<[string, string]>([
    ["empty", ""],
    ["whitespace", "   "],
  ])("does not geocode on lookup when query is %s", (_label, query) => {
    h.acState.query = query;
    renderWithProviders(<HomeLocationSection homeConfig={null} />);
    fireEvent.click(screen.getByTestId("lookup"));
    expect(h.geoState.setGeoStatus).not.toHaveBeenCalled();
  });

  it("onMutate callback resets geo state", () => {
    h.acState.query = "Munich";
    renderWithProviders(<HomeLocationSection homeConfig={null} />);

    if (h.capturedGeocodeMutationOpts.onMutate) {
      h.capturedGeocodeMutationOpts.onMutate();
    }
    expect(h.geoState.setGeoStatus).toHaveBeenCalledWith("loading");
    expect(h.geoState.setGeoError).toHaveBeenCalledWith("");
    expect(h.geoState.setGeoLoadingMsg).toHaveBeenCalledWith("");
    expect(h.acState.clear).toHaveBeenCalled();
  });

  it("onSuccess callback sets coords and resets geo status", () => {
    h.acState.query = "Munich";
    renderWithProviders(<HomeLocationSection homeConfig={null} />);

    if (h.capturedGeocodeMutationOpts.onSuccess) {
      h.capturedGeocodeMutationOpts.onSuccess({
        latitude: 48.123456,
        longitude: 11.654321,
        displayName: "Munich, Germany",
      });
    }
    expect(mockMutate).toHaveBeenCalledWith({
      homeLatitude: 48.123456,
      homeLongitude: 11.654321,
    });
    expect(h.acState.setQuery).toHaveBeenCalledWith("Munich, Germany");
    expect(h.geoState.setGeoStatus).toHaveBeenCalledWith("idle");
  });

  it("onError callback sets error message from Error instance", () => {
    h.acState.query = "Munich";
    renderWithProviders(<HomeLocationSection homeConfig={null} />);

    if (h.capturedGeocodeMutationOpts.onError) {
      h.capturedGeocodeMutationOpts.onError(new Error("Network error"));
    }
    expect(h.geoState.setGeoError).toHaveBeenCalledWith("Network error");
    expect(h.geoState.setGeoStatus).toHaveBeenCalledWith("error");
  });

  it("onError callback uses fallback message for non-Error", () => {
    h.acState.query = "Munich";
    renderWithProviders(<HomeLocationSection homeConfig={null} />);

    if (h.capturedGeocodeMutationOpts.onError) {
      h.capturedGeocodeMutationOpts.onError("something");
    }
    expect(h.geoState.setGeoError).toHaveBeenCalledWith("Geocoding failed");
  });

  it("passes search disabled state to AddressSearchInput", () => {
    h.geoState.geoStatus = "loading";
    renderWithProviders(<HomeLocationSection homeConfig={null} />);
    expect(screen.getByTestId("search-disabled")).toHaveTextContent("true");
  });

  it("shows address search input", () => {
    renderWithProviders(<HomeLocationSection homeConfig={null} />);
    expect(screen.getByTestId("address-search-input")).toBeInTheDocument();
  });
});
