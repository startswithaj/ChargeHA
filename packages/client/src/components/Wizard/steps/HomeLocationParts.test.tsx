import "@testing-library/jest-dom/vitest";
import { assertExists } from "@std/assert";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpdateQuery, mockSetQuery, mockClear, mockSetOpen, st } = vi
  .hoisted(() => ({
    mockUpdateQuery: vi.fn(),
    mockSetQuery: vi.fn(),
    mockClear: vi.fn(),
    mockSetOpen: vi.fn(),
    st: {
      query: "",
      suggestions: [] as Array<
        { lat: string; lon: string; display_name: string }
      >,
      open: false,
      mutate: vi.fn(),
      capturedMutationOpts: {} as Record<
        string,
        (...args: unknown[]) => void
      >,
    },
  }));

vi.mock("../../../hooks/useAddressAutocomplete.ts", () => ({
  useAddressAutocomplete: vi.fn(() => ({
    query: st.query,
    suggestions: st.suggestions,
    open: st.open,
    updateQuery: mockUpdateQuery,
    setQuery: mockSetQuery,
    clear: mockClear,
    setOpen: mockSetOpen,
  })),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@tanstack/react-query")
  >();
  return {
    ...actual,
    useMutation: vi.fn((opts: Record<string, unknown>) => {
      st.capturedMutationOpts = opts as Record<
        string,
        (...args: unknown[]) => void
      >;
      return { mutate: st.mutate };
    }),
  };
});

vi.mock("../../../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    useUtils: vi.fn(() => ({
      client: {
        config: {
          geocode: {
            query: vi.fn(() =>
              Promise.resolve({
                latitude: -37.8136,
                longitude: 144.9631,
                displayName: "Melbourne, VIC, Australia",
              })
            ),
          },
        },
      },
    })),
  },
}));

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { AddressSearch } from "./HomeLocationParts.tsx";

describe("AddressSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    st.query = "";
    st.suggestions = [];
    st.open = false;
    st.mutate = vi.fn();
  });
  afterEach(cleanup);

  const defaultProps = {
    onCoordinatesFound: vi.fn(),
    onGeoStatusChange: vi.fn(),
    onGeoError: vi.fn(),
    onGeoLoadingMsg: vi.fn(),
    geoStatus: "idle" as const,
  };

  it("renders address search input", () => {
    renderWithProviders(<AddressSearch {...defaultProps} />);
    expect(screen.getByLabelText("Address search")).toBeInTheDocument();
  });

  it("renders Lookup button", () => {
    renderWithProviders(<AddressSearch {...defaultProps} />);
    expect(screen.getByText("Lookup")).toBeInTheDocument();
  });

  it.each<[string, string, "idle" | "loading", boolean]>([
    ["empty query / idle", "", "idle", true],
    ["query with text / loading", "Melbourne", "loading", true],
    ["query with text / idle", "Melbourne", "idle", false],
  ])(
    "Lookup button disabled state (%s)",
    (_label, query, geoStatus, disabled) => {
      st.query = query;
      renderWithProviders(
        <AddressSearch {...defaultProps} geoStatus={geoStatus} />,
      );
      const button = screen.getByText("Lookup").closest("button");
      assertExists(button);
      expect(button.hasAttribute("disabled")).toBe(disabled);
    },
  );

  it("calls updateQuery when input changes", () => {
    renderWithProviders(<AddressSearch {...defaultProps} />);
    fireEvent.change(screen.getByLabelText("Address search"), {
      target: { value: "Mel" },
    });
    expect(mockUpdateQuery).toHaveBeenCalledWith("Mel");
  });

  it.each<[string, string, (input: HTMLElement) => void]>([
    [
      "click Lookup",
      "Melbourne",
      () => fireEvent.click(screen.getByText("Lookup")),
    ],
    [
      "Enter key",
      "Sydney",
      (input) => fireEvent.keyDown(input, { key: "Enter" }),
    ],
  ])("triggers geocode mutation via %s", (_label, query, trigger) => {
    st.query = query;
    renderWithProviders(<AddressSearch {...defaultProps} />);
    trigger(screen.getByLabelText("Address search"));
    expect(st.mutate).toHaveBeenCalledWith(query);
  });

  it("does not trigger geocode when query is whitespace", () => {
    st.query = "   ";
    renderWithProviders(<AddressSearch {...defaultProps} />);
    fireEvent.keyDown(screen.getByLabelText("Address search"), {
      key: "Enter",
    });
    expect(st.mutate).not.toHaveBeenCalled();
  });

  it("shows suggestions dropdown when open", () => {
    st.open = true;
    st.suggestions = [
      { lat: "-37.81", lon: "144.96", display_name: "Melbourne" },
      { lat: "-33.87", lon: "151.21", display_name: "Sydney" },
    ];
    renderWithProviders(<AddressSearch {...defaultProps} />);
    expect(screen.getByText("Melbourne")).toBeInTheDocument();
    expect(screen.getByText("Sydney")).toBeInTheDocument();
  });

  it("does not show dropdown when not open", () => {
    st.open = false;
    st.suggestions = [
      { lat: "-37.81", lon: "144.96", display_name: "Melbourne" },
    ];
    renderWithProviders(<AddressSearch {...defaultProps} />);
    expect(screen.queryByText("Melbourne")).not.toBeInTheDocument();
  });

  it("selects suggestion and calls onCoordinatesFound", () => {
    st.open = true;
    st.suggestions = [
      { lat: "-37.813628", lon: "144.963058", display_name: "Melbourne, VIC" },
    ];
    const onCoordinatesFound = vi.fn();
    renderWithProviders(
      <AddressSearch
        {...defaultProps}
        onCoordinatesFound={onCoordinatesFound}
      />,
    );
    fireEvent.click(screen.getByText("Melbourne, VIC"));
    expect(mockSetQuery).toHaveBeenCalledWith("Melbourne, VIC");
    expect(mockClear).toHaveBeenCalledOnce();
    expect(onCoordinatesFound).toHaveBeenCalledWith(
      "-37.813628",
      "144.963058",
      "Melbourne, VIC",
    );
  });

  it.each<
    [string, Array<{ lat: string; lon: string; display_name: string }>, boolean]
  >([
    [
      "with suggestions",
      [{ lat: "-37.81", lon: "144.96", display_name: "Melbourne" }],
      true,
    ],
    ["without suggestions", [], false],
  ])("focus on input %s opens dropdown=%s", (_label, suggestions, expected) => {
    st.suggestions = suggestions;
    renderWithProviders(<AddressSearch {...defaultProps} />);
    fireEvent.focus(screen.getByLabelText("Address search"));
    expect(mockSetOpen.mock.calls.some(([arg]) => arg === true)).toBe(expected);
  });

  it("closes dropdown when clicking outside", () => {
    st.open = true;
    st.suggestions = [
      { lat: "-37.81", lon: "144.96", display_name: "Melbourne" },
    ];
    renderWithProviders(<AddressSearch {...defaultProps} />);
    fireEvent.mouseDown(document.body);
    expect(mockSetOpen).toHaveBeenCalledWith(false);
  });

  it("onMutate clears error and sets loading", () => {
    st.query = "Melbourne";
    const onGeoStatusChange = vi.fn();
    const onGeoError = vi.fn();
    const onGeoLoadingMsg = vi.fn();
    renderWithProviders(
      <AddressSearch
        {...defaultProps}
        onGeoStatusChange={onGeoStatusChange}
        onGeoError={onGeoError}
        onGeoLoadingMsg={onGeoLoadingMsg}
      />,
    );
    st.capturedMutationOpts.onMutate();
    expect(onGeoStatusChange).toHaveBeenCalledWith("loading");
    expect(onGeoError).toHaveBeenCalledWith("");
    expect(onGeoLoadingMsg).toHaveBeenCalledWith("");
    expect(mockClear).toHaveBeenCalled();
  });

  it("onSuccess sets coordinates and display name", () => {
    st.query = "Melbourne";
    const onCoordinatesFound = vi.fn();
    const onGeoStatusChange = vi.fn();
    renderWithProviders(
      <AddressSearch
        {...defaultProps}
        onCoordinatesFound={onCoordinatesFound}
        onGeoStatusChange={onGeoStatusChange}
      />,
    );
    st.capturedMutationOpts.onSuccess({
      latitude: -37.8136,
      longitude: 144.9631,
      displayName: "Melbourne, VIC, Australia",
    });
    expect(mockSetQuery).toHaveBeenCalledWith("Melbourne, VIC, Australia");
    expect(onGeoStatusChange).toHaveBeenCalledWith("idle");
    expect(onCoordinatesFound).toHaveBeenCalledWith(
      "-37.813600",
      "144.963100",
      "Melbourne, VIC, Australia",
    );
  });

  it("onError sets error message", () => {
    st.query = "Melbourne";
    const onGeoError = vi.fn();
    const onGeoStatusChange = vi.fn();
    renderWithProviders(
      <AddressSearch
        {...defaultProps}
        onGeoError={onGeoError}
        onGeoStatusChange={onGeoStatusChange}
      />,
    );
    st.capturedMutationOpts.onError(new Error("Network error"));
    expect(onGeoError).toHaveBeenCalledWith("Network error");
    expect(onGeoStatusChange).toHaveBeenCalledWith("error");
  });

  it("onError handles non-Error objects", () => {
    st.query = "Melbourne";
    const onGeoError = vi.fn();
    renderWithProviders(
      <AddressSearch {...defaultProps} onGeoError={onGeoError} />,
    );
    st.capturedMutationOpts.onError("string error");
    expect(onGeoError).toHaveBeenCalledWith("Geocoding failed");
  });
});
