import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../../../client/src/test-utils.tsx";
import {
  defaultAutocompleteState,
  installResizeObserverPolyfill,
  makeDefaultProps,
  makeVehicleState,
  mockGeocodeQuery,
} from "./test-helpers/dialogHarness.ts";

vi.mock("../../../../client/src/hooks/useAddressAutocomplete.ts", () => ({
  useAddressAutocomplete: vi.fn(() => ({
    query: "",
    suggestions: [],
    open: false,
    updateQuery: vi.fn(),
    setQuery: vi.fn(),
    setOpen: vi.fn(),
    clear: vi.fn(),
  })),
}));

vi.mock("./trpc.ts", () => ({
  trpc: {
    useUtils: () => ({
      client: {
        plugin: {
          vehicle: {
            simulated: {
              geocode: { query: mockGeocodeQuery },
            },
          },
        },
      },
    }),
  },
}));

import { SimulatedVehicleDialog } from "./SimulatedVehicleDialog.tsx";
import { useAddressAutocomplete } from "../../../../client/src/hooks/useAddressAutocomplete.ts";

describe("SimulatedVehicleDialog", () => {
  const defaultProps = makeDefaultProps();

  beforeEach(() => {
    vi.clearAllMocks();
    // Radix Switch uses ResizeObserver which jsdom doesn't provide
    installResizeObserverPolyfill();
    vi.mocked(useAddressAutocomplete).mockReturnValue(
      defaultAutocompleteState(),
    );
  });

  afterEach(cleanup);

  // ---- Basic rendering (consolidated smoke test) ----

  it("renders all static fields, buttons, and helper text", () => {
    renderWithProviders(<SimulatedVehicleDialog {...defaultProps} />);

    expect(
      screen.getByText(/Override runtime state for this simulated vehicle/),
    ).toBeInTheDocument();
    expect(screen.getByText("Plugged In")).toBeInTheDocument();
    expect(screen.getByText("Location")).toBeInTheDocument();
    expect(screen.getByText("Charge Limit")).toBeInTheDocument();
    expect(screen.getByText("Battery Level")).toBeInTheDocument();
    expect(screen.getByText("Save")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
    expect(screen.getByText("Lookup")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Latitude")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Longitude")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Sets the simulated GPS position for home/away detection.",
      ),
    ).toBeInTheDocument();
  });

  // ---- Pre-populated state from props ----

  it("pre-populates lat/lng from lastLocation prop", () => {
    renderWithProviders(
      <SimulatedVehicleDialog
        {...defaultProps}
        lastLocation={{ latitude: 37.7749, longitude: -122.4194 }}
      />,
    );

    expect(screen.getByPlaceholderText("Latitude")).toHaveValue(37.7749);
    expect(screen.getByPlaceholderText("Longitude")).toHaveValue(-122.4194);
  });

  it("shows default charge limit of 80% when no vehicleState provided", () => {
    renderWithProviders(<SimulatedVehicleDialog {...defaultProps} />);

    expect(screen.getByText("80%")).toBeInTheDocument();
  });

  it("pre-populates charge limit from vehicleState prop", () => {
    const vehicleState = makeVehicleState({
      isPluggedIn: false,
      chargeLimit: 90,
    });

    renderWithProviders(
      <SimulatedVehicleDialog {...defaultProps} vehicleState={vehicleState} />,
    );

    expect(screen.getByText("90%")).toBeInTheDocument();
  });

  // ---- Cancel button ----

  it("calls onCancel when Cancel is clicked", () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <SimulatedVehicleDialog {...defaultProps} onCancel={onCancel} />,
    );

    fireEvent.click(screen.getByText("Cancel"));

    expect(onCancel).toHaveBeenCalledOnce();
  });

  // ---- Battery level stepper ----
  // Battery Level stepper is first (index 0), Charge Limit stepper is second (index 1)

  it("pre-populates battery level from vehicleState.batteryLevel", () => {
    const vehicleState = makeVehicleState({ batteryLevel: 65 });

    renderWithProviders(
      <SimulatedVehicleDialog {...defaultProps} vehicleState={vehicleState} />,
    );

    expect(screen.getByText("65%")).toBeInTheDocument();
  });

  it("increments battery level by 5 when + is clicked", () => {
    renderWithProviders(<SimulatedVehicleDialog {...defaultProps} />);

    // Battery Level + is the first + button (index 0)
    const plusButtons = screen.getAllByText("+");
    fireEvent.click(plusButtons[0]);

    expect(screen.getByText("55%")).toBeInTheDocument();
  });

  it("decrements battery level by 5 when − is clicked", () => {
    renderWithProviders(<SimulatedVehicleDialog {...defaultProps} />);

    // Battery Level − is the first − button (index 0)
    const minusButtons = screen.getAllByText("−");
    fireEvent.click(minusButtons[0]);

    expect(screen.getByText("45%")).toBeInTheDocument();
  });

  it("includes socPercent in onSave data", async () => {
    const onSave = vi.fn().mockResolvedValue(null);
    renderWithProviders(
      <SimulatedVehicleDialog {...defaultProps} onSave={onSave} />,
    );

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          socPercent: 50,
        }),
      );
    });
  });

  // ---- Charge limit stepper ----

  it("increments charge limit by 5 when + is clicked", () => {
    renderWithProviders(<SimulatedVehicleDialog {...defaultProps} />);

    // Charge Limit + is the second + button (index 1)
    const plusButtons = screen.getAllByText("+");
    fireEvent.click(plusButtons[1]);

    expect(screen.getByText("85%")).toBeInTheDocument();
  });

  it("decrements charge limit by 5 when − is clicked", () => {
    renderWithProviders(<SimulatedVehicleDialog {...defaultProps} />);

    // Charge Limit − is the second − button (index 1)
    const minusButtons = screen.getAllByText("−");
    fireEvent.click(minusButtons[1]);

    expect(screen.getByText("75%")).toBeInTheDocument();
  });

  it("does not decrement charge limit below 50", () => {
    const vehicleState = makeVehicleState({
      batteryLevel: 50,
      chargeLimit: 50,
    });

    renderWithProviders(
      <SimulatedVehicleDialog {...defaultProps} vehicleState={vehicleState} />,
    );

    // Charge Limit − is the second − button (index 1)
    const decrementBtn = screen.getAllByText("−")[1].closest("button");
    expect(decrementBtn).toBeDisabled();
  });

  it("does not increment charge limit above 100", () => {
    const vehicleState = makeVehicleState({
      batteryLevel: 90,
      chargeLimit: 100,
    });

    renderWithProviders(
      <SimulatedVehicleDialog {...defaultProps} vehicleState={vehicleState} />,
    );

    // Charge Limit + is the second + button (index 1)
    const incrementBtn = screen.getAllByText("+")[1].closest("button");
    expect(incrementBtn).toBeDisabled();
  });

  // ---- Lat/Lng input fields ----

  it("updates latitude input value when typed into", () => {
    renderWithProviders(<SimulatedVehicleDialog {...defaultProps} />);

    const latInput = screen.getByPlaceholderText("Latitude");
    fireEvent.change(latInput, { target: { value: "51.5074" } });

    expect(latInput).toHaveValue(51.5074);
  });

  it("updates longitude input value when typed into", () => {
    renderWithProviders(<SimulatedVehicleDialog {...defaultProps} />);

    const lngInput = screen.getByPlaceholderText("Longitude");
    fireEvent.change(lngInput, { target: { value: "-0.1278" } });

    expect(lngInput).toHaveValue(-0.1278);
  });

  // ---- Form submission ----

  it("calls onSave with isPluggedIn and chargeLimit when form is submitted with no location", async () => {
    const onSave = vi.fn().mockResolvedValue(null);
    renderWithProviders(
      <SimulatedVehicleDialog {...defaultProps} onSave={onSave} />,
    );

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          isPluggedIn: true,
          chargeLimit: 80,
        }),
      );
    });
  });

  it("calls onSave with latitude and longitude when both are filled in", async () => {
    const onSave = vi.fn().mockResolvedValue(null);
    renderWithProviders(
      <SimulatedVehicleDialog {...defaultProps} onSave={onSave} />,
    );

    fireEvent.change(screen.getByPlaceholderText("Latitude"), {
      target: { value: "37.7749" },
    });
    fireEvent.change(screen.getByPlaceholderText("Longitude"), {
      target: { value: "-122.4194" },
    });

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          latitude: 37.7749,
          longitude: -122.4194,
          isPluggedIn: true,
          chargeLimit: 80,
        }),
      );
    });
  });

  it("shows validation error when latitude is out of range", async () => {
    renderWithProviders(<SimulatedVehicleDialog {...defaultProps} />);

    fireEvent.change(screen.getByPlaceholderText("Latitude"), {
      target: { value: "999" },
    });
    fireEvent.change(screen.getByPlaceholderText("Longitude"), {
      target: { value: "0" },
    });

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(
        screen.getByText("Latitude must be between -90 and 90."),
      ).toBeInTheDocument();
    });
  });

  it("shows validation error when longitude is out of range", async () => {
    renderWithProviders(<SimulatedVehicleDialog {...defaultProps} />);

    fireEvent.change(screen.getByPlaceholderText("Latitude"), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByPlaceholderText("Longitude"), {
      target: { value: "999" },
    });

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(
        screen.getByText("Longitude must be between -180 and 180."),
      ).toBeInTheDocument();
    });
  });

  it("shows validation error when lat/lng are non-numeric strings", async () => {
    renderWithProviders(<SimulatedVehicleDialog {...defaultProps} />);

    // Force NaN by setting the raw state via typing non-numeric (number inputs parse NaN)
    const latInput = screen.getByPlaceholderText("Latitude");
    // Directly dispatch a change event with an unparseable string by bypassing type="number"
    Object.defineProperty(latInput, "value", {
      writable: true,
      value: "abc",
    });
    fireEvent.change(latInput, { target: { value: "abc" } });

    const lngInput = screen.getByPlaceholderText("Longitude");
    Object.defineProperty(lngInput, "value", {
      writable: true,
      value: "def",
    });
    fireEvent.change(lngInput, { target: { value: "def" } });

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Latitude and longitude must be valid numbers.",
        ),
      ).toBeInTheDocument();
    });
  });

  it("shows server error message when onSave returns an error string", async () => {
    const onSave = vi.fn().mockResolvedValue("Server error occurred");
    renderWithProviders(
      <SimulatedVehicleDialog {...defaultProps} onSave={onSave} />,
    );

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(screen.getByText("Server error occurred")).toBeInTheDocument();
    });
  });

  it("shows Saving... while the form is submitting", async () => {
    let resolvePromise!: (value: string | null) => void;
    const onSave = vi.fn(
      () =>
        new Promise<string | null>((res) => {
          resolvePromise = res;
        }),
    );

    renderWithProviders(
      <SimulatedVehicleDialog {...defaultProps} onSave={onSave} />,
    );

    fireEvent.click(screen.getByText("Save"));

    expect(await screen.findByText("Saving...")).toBeInTheDocument();

    resolvePromise(null);

    await waitFor(() => {
      expect(screen.getByText("Save")).toBeInTheDocument();
    });
  });

  // ---- Geocode / Lookup ----

  it("Lookup button is disabled when address query is empty", () => {
    renderWithProviders(<SimulatedVehicleDialog {...defaultProps} />);

    const lookupBtn = screen.getByText("Lookup").closest("button");
    expect(lookupBtn).toBeDisabled();
  });

  it("Lookup button is enabled when address query has content", () => {
    vi.mocked(useAddressAutocomplete).mockReturnValue({
      ...defaultAutocompleteState(),
      query: "1600 Amphitheatre Parkway",
    });

    renderWithProviders(<SimulatedVehicleDialog {...defaultProps} />);

    const lookupBtn = screen.getByText("Lookup").closest("button");
    expect(lookupBtn).not.toBeDisabled();
  });

  it("calls geocodeAddress and populates lat/lng on successful lookup", async () => {
    const setQuery = vi.fn();
    const clear = vi.fn();

    vi.mocked(useAddressAutocomplete).mockReturnValue({
      ...defaultAutocompleteState(),
      query: "1600 Amphitheatre Parkway",
      setQuery,
      clear,
    });

    mockGeocodeQuery.mockResolvedValue({
      latitude: 37.422,
      longitude: -122.084,
      displayName: "1600 Amphitheatre Pkwy, Mountain View, CA",
    });

    renderWithProviders(<SimulatedVehicleDialog {...defaultProps} />);

    fireEvent.click(screen.getByText("Lookup"));

    await waitFor(() => {
      expect(mockGeocodeQuery).toHaveBeenCalledWith({
        q: "1600 Amphitheatre Parkway",
      });
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Latitude")).toHaveValue(37.422);
      expect(screen.getByPlaceholderText("Longitude")).toHaveValue(-122.084);
    });

    expect(setQuery).toHaveBeenCalledWith(
      "1600 Amphitheatre Pkwy, Mountain View, CA",
    );
    expect(clear).toHaveBeenCalled();
  });

  it("shows geocode error when geocodeAddress throws", async () => {
    vi.mocked(useAddressAutocomplete).mockReturnValue({
      ...defaultAutocompleteState(),
      query: "bad address",
    });

    mockGeocodeQuery.mockRejectedValue(new Error("Not found"));

    renderWithProviders(<SimulatedVehicleDialog {...defaultProps} />);

    fireEvent.click(screen.getByText("Lookup"));

    await waitFor(() => {
      expect(screen.getByText("Not found")).toBeInTheDocument();
    });
  });

  it("shows fallback geocode error for non-Error rejection", async () => {
    vi.mocked(useAddressAutocomplete).mockReturnValue({
      ...defaultAutocompleteState(),
      query: "bad address",
    });

    mockGeocodeQuery.mockRejectedValue("some string error");

    renderWithProviders(<SimulatedVehicleDialog {...defaultProps} />);

    fireEvent.click(screen.getByText("Lookup"));

    await waitFor(() => {
      expect(screen.getByText("Geocoding failed")).toBeInTheDocument();
    });
  });

  it("shows 'Looking up...' while geocoding is in progress", async () => {
    vi.mocked(useAddressAutocomplete).mockReturnValue({
      ...defaultAutocompleteState(),
      query: "some address",
    });

    let resolveGeo!: (value: {
      latitude: number;
      longitude: number;
      displayName: string;
    }) => void;
    mockGeocodeQuery.mockReturnValue(
      new Promise((res) => {
        resolveGeo = res;
      }),
    );

    renderWithProviders(<SimulatedVehicleDialog {...defaultProps} />);

    fireEvent.click(screen.getByText("Lookup"));

    expect(await screen.findByText("Looking up...")).toBeInTheDocument();

    resolveGeo({
      latitude: 1,
      longitude: 2,
      displayName: "Somewhere",
    });

    await waitFor(() => {
      expect(screen.getByText("Lookup")).toBeInTheDocument();
    });
  });

  // ---- Enter key triggers geocode ----

  it("pressing Enter in address field triggers geocode", async () => {
    const clear = vi.fn();
    vi.mocked(useAddressAutocomplete).mockReturnValue({
      ...defaultAutocompleteState(),
      query: "123 Main St",
      clear,
    });

    mockGeocodeQuery.mockResolvedValue({
      latitude: 40.0,
      longitude: -74.0,
      displayName: "123 Main St, Somewhere",
    });

    renderWithProviders(<SimulatedVehicleDialog {...defaultProps} />);

    const addressInput = screen.getByPlaceholderText(
      "Search for an address...",
    );
    fireEvent.keyDown(addressInput, { key: "Enter" });

    await waitFor(() => {
      expect(mockGeocodeQuery).toHaveBeenCalledWith({ q: "123 Main St" });
    });
  });

  // ---- outside click closes dropdown ----

  it("closes autocomplete dropdown when clicking outside", () => {
    const setOpen = vi.fn();
    vi.mocked(useAddressAutocomplete).mockReturnValue({
      ...defaultAutocompleteState(),
      query: "1600 Amp",
      suggestions: [
        {
          lat: "37.422",
          lon: "-122.084",
          display_name: "1600 Amphitheatre Pkwy",
        },
      ],
      open: true,
      setOpen,
    });

    renderWithProviders(<SimulatedVehicleDialog {...defaultProps} />);

    // Click outside the wrapper
    fireEvent.mouseDown(document.body);

    expect(setOpen).toHaveBeenCalledWith(false);
  });

  // ---- focus opens dropdown ----

  it("opens autocomplete dropdown on focus when suggestions exist", () => {
    const setOpen = vi.fn();
    vi.mocked(useAddressAutocomplete).mockReturnValue({
      ...defaultAutocompleteState(),
      query: "1600 Amp",
      suggestions: [
        {
          lat: "37.422",
          lon: "-122.084",
          display_name: "1600 Amphitheatre Pkwy",
        },
      ],
      setOpen,
    });

    renderWithProviders(<SimulatedVehicleDialog {...defaultProps} />);

    const addressInput = screen.getByPlaceholderText(
      "Search for an address...",
    );
    fireEvent.focus(addressInput);

    expect(setOpen).toHaveBeenCalledWith(true);
  });

  it("does not open autocomplete dropdown on focus when no suggestions", () => {
    const setOpen = vi.fn();
    vi.mocked(useAddressAutocomplete).mockReturnValue({
      ...defaultAutocompleteState(),
      setOpen,
    });

    renderWithProviders(<SimulatedVehicleDialog {...defaultProps} />);

    const addressInput = screen.getByPlaceholderText(
      "Search for an address...",
    );
    fireEvent.focus(addressInput);

    expect(setOpen).not.toHaveBeenCalled();
  });

  // ---- Autocomplete suggestions dropdown ----

  it("renders autocomplete suggestions when open is true", () => {
    vi.mocked(useAddressAutocomplete).mockReturnValue({
      ...defaultAutocompleteState(),
      query: "1600 Amp",
      suggestions: [
        {
          lat: "37.422",
          lon: "-122.084",
          display_name: "1600 Amphitheatre Pkwy, Mountain View, CA",
        },
      ],
      open: true,
    });

    renderWithProviders(<SimulatedVehicleDialog {...defaultProps} />);

    expect(
      screen.getByText("1600 Amphitheatre Pkwy, Mountain View, CA"),
    ).toBeInTheDocument();
  });

  it("populates lat/lng when a suggestion is clicked", () => {
    const setQuery = vi.fn();
    const clear = vi.fn();

    vi.mocked(useAddressAutocomplete).mockReturnValue({
      ...defaultAutocompleteState(),
      query: "1600 Amp",
      suggestions: [
        {
          lat: "37.422000",
          lon: "-122.084000",
          display_name: "1600 Amphitheatre Pkwy, Mountain View, CA",
        },
      ],
      open: true,
      setQuery,
      clear,
    });

    renderWithProviders(<SimulatedVehicleDialog {...defaultProps} />);

    fireEvent.click(
      screen.getByText("1600 Amphitheatre Pkwy, Mountain View, CA"),
    );

    // After selecting a suggestion, lat/lng should be populated
    expect(screen.getByPlaceholderText("Latitude")).toHaveValue(37.422);
    expect(screen.getByPlaceholderText("Longitude")).toHaveValue(-122.084);
    expect(setQuery).toHaveBeenCalledWith(
      "1600 Amphitheatre Pkwy, Mountain View, CA",
    );
    expect(clear).toHaveBeenCalled();
  });
});
