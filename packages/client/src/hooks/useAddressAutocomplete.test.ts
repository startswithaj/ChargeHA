import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { createTestQueryClient } from "../test-utils.tsx";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
}));

vi.mock("../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    config: {
      geocodeAutocomplete: {
        useQuery: (...args: unknown[]) => mocks.useQuery(...args),
      },
    },
  },
}));

import { useAddressAutocomplete } from "./useAddressAutocomplete.ts";

describe("useAddressAutocomplete", () => {
  const fakeSuggestions = [
    { lat: "48.85", lon: "2.35", display_name: "Paris, France" },
  ];

  const createWrapper = () => {
    const queryClient = createTestQueryClient();
    return ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        children,
      );
  };

  const setup = () =>
    renderHook(() => useAddressAutocomplete(), { wrapper: createWrapper() });

  beforeEach(() => {
    mocks.useQuery.mockReset();
    mocks.useQuery.mockReturnValue({ data: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts with empty query and no suggestions", () => {
    const { result } = setup();

    expect(result.current.query).toBe("");
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.open).toBe(false);
  });

  it("updateQuery with short text clears suggestions", () => {
    const { result } = setup();

    act(() => {
      result.current.updateQuery("abcd");
    });

    expect(result.current.query).toBe("abcd");
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.open).toBe(false);
  });

  it("does not fetch immediately (debounce)", () => {
    const { result } = setup();

    act(() => {
      result.current.updateQuery("Paris France");
    });

    // Query should be called with enabled:false for debounced empty string
    // The actual fetch won't happen until debounce fires
    expect(mocks.useQuery).toHaveBeenCalled();
    // The enabled flag should be false since debouncedQuery hasn't updated yet
    const lastCall =
      mocks.useQuery.mock.calls[mocks.useQuery.mock.calls.length - 1];
    expect(lastCall[1]?.enabled).toBe(false);
  });

  it("fetches suggestions after debounce and shows results", async () => {
    // Respect enabled flag — only return data when enabled
    mocks.useQuery.mockImplementation(
      (_input: unknown, opts?: { enabled?: boolean }) => {
        if (opts?.enabled) {
          return { data: fakeSuggestions };
        }
        return { data: [] };
      },
    );

    const { result } = setup();

    act(() => {
      result.current.updateQuery("Paris France");
    });

    await waitFor(() => {
      expect(result.current.suggestions).toEqual(fakeSuggestions);
    }, { timeout: 2000 });

    expect(result.current.open).toBe(true);
  });

  it("clear resets open state", async () => {
    mocks.useQuery.mockReturnValue({ data: fakeSuggestions });

    const { result } = setup();

    act(() => {
      result.current.updateQuery("Paris France");
    });

    await waitFor(() => {
      expect(result.current.suggestions).toHaveLength(1);
    }, { timeout: 2000 });

    act(() => {
      result.current.clear();
    });

    expect(result.current.open).toBe(false);
  });

  it("caches previously fetched results", async () => {
    mocks.useQuery.mockReturnValue({ data: fakeSuggestions });

    const { result } = setup();

    // First query
    act(() => {
      result.current.updateQuery("Paris France");
    });

    await waitFor(() => {
      expect(result.current.suggestions).toEqual(fakeSuggestions);
    }, { timeout: 2000 });

    // Clear and re-enter same query
    act(() => {
      result.current.clear();
      result.current.updateQuery("Paris France");
    });

    await waitFor(() => {
      expect(result.current.suggestions).toEqual(fakeSuggestions);
    }, { timeout: 2000 });
  });
});
