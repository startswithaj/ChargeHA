import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../../client/src/test-utils.tsx";
import { GoodweSemsConfig } from "./GoodweSemsConfig.tsx";

const mocks = vi.hoisted(() => ({
  config: {
    goodweSemsAccount: "owner@example.com",
    goodweSemsPassword: "secret",
    goodweSemsStationId: "station-a",
  },
  setConfigMutate: vi.fn(),
  listStationsMutate: vi.fn(),
  listStationsState: {
    data: undefined as unknown,
    isPending: false,
    isError: false,
    error: null as { message: string } | null,
  },
  testMutate: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("./trpc.ts", () => ({
  trpc: {
    useUtils: () => ({
      plugin: {
        energy: {
          goodwe_sems: { getConfig: { invalidate: mocks.invalidate } },
        },
      },
    }),
    plugin: {
      energy: {
        goodwe_sems: {
          getConfig: { useQuery: () => ({ data: mocks.config }) },
          setConfig: {
            useMutation: () => ({ mutate: mocks.setConfigMutate }),
          },
          listStations: {
            useMutation: () => ({
              mutate: mocks.listStationsMutate,
              ...mocks.listStationsState,
            }),
          },
          testConnection: {
            useMutation: () => ({
              mutate: mocks.testMutate,
              data: undefined,
              isPending: false,
              isSuccess: false,
              isError: false,
              error: null,
            }),
          },
        },
      },
    },
  },
}));

// ---- Tests ----

describe("GoodweSemsConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listStationsState.data = undefined;
    mocks.listStationsState.isPending = false;
    mocks.listStationsState.isError = false;
    mocks.listStationsState.error = null;
    mocks.config.goodweSemsStationId = "station-a";
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the configured station before any list is loaded", () => {
    renderWithProviders(<GoodweSemsConfig />);

    expect(screen.getByText("Current station: station-a"))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use" }))
      .not.toBeInTheDocument();
  });

  it("Load Stations re-lists with the saved credentials", () => {
    renderWithProviders(<GoodweSemsConfig />);

    fireEvent.click(screen.getByRole("button", { name: "Load Stations" }));

    expect(mocks.listStationsMutate).toHaveBeenCalledWith({
      account: "owner@example.com",
      password: "secret",
      useSemsPlus: false,
    });
  });

  it("marks the configured station and offers Use on the others", () => {
    mocks.listStationsState.data = {
      success: true,
      stations: [
        { id: "station-a", name: "Home Array" },
        { id: "station-b", name: "Shed Array" },
      ],
    };

    renderWithProviders(<GoodweSemsConfig />);

    expect(screen.getByText("Selected")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Use" })).toHaveLength(1);
  });

  it("Use stages the chosen station without saving", () => {
    mocks.listStationsState.data = {
      success: true,
      stations: [
        { id: "station-a", name: "Home Array" },
        { id: "station-b", name: "Shed Array" },
      ],
    };

    renderWithProviders(<GoodweSemsConfig />);

    fireEvent.click(screen.getByRole("button", { name: "Use" }));

    // Buffered draft: the pick only moves the selection; the host Save
    // button is what persists it. The Selected badge moves to the picked
    // station and Use re-derives onto the other one.
    expect(mocks.setConfigMutate).not.toHaveBeenCalled();
    expect(screen.getByText("Selected")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Use" })).toHaveLength(1);
  });

  it("surfaces a listStations failure", () => {
    mocks.listStationsState.data = { success: false, error: "Login failed" };

    renderWithProviders(<GoodweSemsConfig />);

    expect(screen.getByText("Login failed")).toBeInTheDocument();
  });

  it("routes Load Stations and Test Connection to SEMS+ when toggled on", () => {
    renderWithProviders(<GoodweSemsConfig />);

    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Load Stations" }));
    fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));

    expect(mocks.listStationsMutate).toHaveBeenCalledWith({
      account: "owner@example.com",
      password: "secret",
      useSemsPlus: true,
    });
    expect(mocks.testMutate).toHaveBeenCalledWith({
      account: "owner@example.com",
      password: "secret",
      stationId: "station-a",
      useSemsPlus: true,
    });
  });
});
