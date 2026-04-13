import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import type { AutocompleteState } from "./AddressSearchInput.tsx";
import { AddressSearchInput } from "./AddressSearchInput.tsx";
import type { PhotonResult } from "../../../hooks/useAddressAutocomplete.ts";

// ── Tests ──

describe("AddressSearchInput", () => {
  const makeSuggestion = (name: string): PhotonResult => ({
    lat: "48.123",
    lon: "11.456",
    display_name: name,
  });

  const makeAcState = (
    overrides?: Partial<AutocompleteState>,
  ): AutocompleteState => ({
    query: "",
    setQuery: vi.fn(),
    updateQuery: vi.fn(),
    suggestions: [],
    open: false,
    setOpen: vi.fn(),
    clear: vi.fn(),
    ...overrides,
  });

  afterEach(() => {
    cleanup();
  });

  it("renders input and Lookup button", () => {
    const ac = makeAcState();
    renderWithProviders(
      <AddressSearchInput
        ac={ac}
        disabled={false}
        onSelect={vi.fn()}
        onLookup={vi.fn()}
      />,
    );

    expect(
      screen.getByPlaceholderText("Or search for an address..."),
    ).toBeInTheDocument();
    expect(screen.getByText("Lookup")).toBeInTheDocument();
  });

  it("calls updateQuery on input change", () => {
    const ac = makeAcState();
    renderWithProviders(
      <AddressSearchInput
        ac={ac}
        disabled={false}
        onSelect={vi.fn()}
        onLookup={vi.fn()}
      />,
    );

    fireEvent.change(
      screen.getByPlaceholderText("Or search for an address..."),
      { target: { value: "Berlin" } },
    );
    expect(ac.updateQuery).toHaveBeenCalledWith("Berlin");
  });

  it("calls onLookup when Enter is pressed", () => {
    const ac = makeAcState({ query: "Berlin" });
    const onLookup = vi.fn();
    renderWithProviders(
      <AddressSearchInput
        ac={ac}
        disabled={false}
        onSelect={vi.fn()}
        onLookup={onLookup}
      />,
    );

    fireEvent.keyDown(
      screen.getByPlaceholderText("Or search for an address..."),
      { key: "Enter" },
    );
    expect(onLookup).toHaveBeenCalled();
  });

  it("does not call onLookup for non-Enter keys", () => {
    const ac = makeAcState({ query: "Berlin" });
    const onLookup = vi.fn();
    renderWithProviders(
      <AddressSearchInput
        ac={ac}
        disabled={false}
        onSelect={vi.fn()}
        onLookup={onLookup}
      />,
    );

    fireEvent.keyDown(
      screen.getByPlaceholderText("Or search for an address..."),
      { key: "Escape" },
    );
    expect(onLookup).not.toHaveBeenCalled();
  });

  it("calls onLookup when Lookup button is clicked", () => {
    const ac = makeAcState({ query: "Munich" });
    const onLookup = vi.fn();
    renderWithProviders(
      <AddressSearchInput
        ac={ac}
        disabled={false}
        onSelect={vi.fn()}
        onLookup={onLookup}
      />,
    );

    fireEvent.click(screen.getByText("Lookup"));
    expect(onLookup).toHaveBeenCalled();
  });

  it.each<[string, boolean, string]>([
    ["disabled prop is true", true, "x"],
    ["query is empty", false, ""],
    ["query is only whitespace", false, "   "],
  ])("disables Lookup button when %s", (_label, disabled, query) => {
    const ac = makeAcState({ query });
    renderWithProviders(
      <AddressSearchInput
        ac={ac}
        disabled={disabled}
        onSelect={vi.fn()}
        onLookup={vi.fn()}
      />,
    );

    expect(screen.getByText("Lookup").closest("button")).toBeDisabled();
  });

  it("shows suggestion dropdown when open is true with suggestions", () => {
    const suggestions = [
      makeSuggestion("Berlin, Germany"),
      makeSuggestion("Bern, Switzerland"),
    ];
    const ac = makeAcState({ open: true, suggestions });
    renderWithProviders(
      <AddressSearchInput
        ac={ac}
        disabled={false}
        onSelect={vi.fn()}
        onLookup={vi.fn()}
      />,
    );

    expect(screen.getByText("Berlin, Germany")).toBeInTheDocument();
    expect(screen.getByText("Bern, Switzerland")).toBeInTheDocument();
  });

  it("does not show suggestion dropdown when open is false", () => {
    const suggestions = [makeSuggestion("Berlin, Germany")];
    const ac = makeAcState({ open: false, suggestions });
    renderWithProviders(
      <AddressSearchInput
        ac={ac}
        disabled={false}
        onSelect={vi.fn()}
        onLookup={vi.fn()}
      />,
    );

    expect(screen.queryByText("Berlin, Germany")).not.toBeInTheDocument();
  });

  it("calls onSelect when a suggestion is clicked", () => {
    const suggestion = makeSuggestion("Munich, Germany");
    const ac = makeAcState({ open: true, suggestions: [suggestion] });
    const onSelect = vi.fn();
    renderWithProviders(
      <AddressSearchInput
        ac={ac}
        disabled={false}
        onSelect={onSelect}
        onLookup={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("Munich, Germany"));
    expect(onSelect).toHaveBeenCalledWith(suggestion);
  });

  it("opens dropdown on focus when suggestions exist", () => {
    const ac = makeAcState({
      suggestions: [makeSuggestion("Berlin")],
      open: false,
    });
    renderWithProviders(
      <AddressSearchInput
        ac={ac}
        disabled={false}
        onSelect={vi.fn()}
        onLookup={vi.fn()}
      />,
    );

    fireEvent.focus(
      screen.getByPlaceholderText("Or search for an address..."),
    );
    expect(ac.setOpen).toHaveBeenCalledWith(true);
  });

  it("does not open dropdown on focus when no suggestions", () => {
    const ac = makeAcState({ suggestions: [], open: false });
    renderWithProviders(
      <AddressSearchInput
        ac={ac}
        disabled={false}
        onSelect={vi.fn()}
        onLookup={vi.fn()}
      />,
    );

    fireEvent.focus(
      screen.getByPlaceholderText("Or search for an address..."),
    );
    expect(ac.setOpen).not.toHaveBeenCalled();
  });

  it("closes dropdown when clicking outside", () => {
    const ac = makeAcState({
      open: true,
      suggestions: [makeSuggestion("Berlin")],
    });
    renderWithProviders(
      <AddressSearchInput
        ac={ac}
        disabled={false}
        onSelect={vi.fn()}
        onLookup={vi.fn()}
      />,
    );

    // Click outside the wrapper
    fireEvent.mouseDown(document.body);
    expect(ac.setOpen).toHaveBeenCalledWith(false);
  });

  it("does not close dropdown when clicking inside the wrapper", () => {
    const ac = makeAcState({
      open: true,
      suggestions: [makeSuggestion("Berlin")],
    });
    renderWithProviders(
      <AddressSearchInput
        ac={ac}
        disabled={false}
        onSelect={vi.fn()}
        onLookup={vi.fn()}
      />,
    );

    fireEvent.mouseDown(
      screen.getByPlaceholderText("Or search for an address..."),
    );
    // setOpen should not be called with false when clicking inside
    const calls = vi.mocked(ac.setOpen).mock.calls;
    const closeCalls = calls.filter((c) => c[0] === false);
    expect(closeCalls).toHaveLength(0);
  });
});
