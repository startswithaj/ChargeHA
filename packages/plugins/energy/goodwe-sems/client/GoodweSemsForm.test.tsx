import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../../../client/src/test-utils.tsx";
import { GoodweSemsForm } from "./GoodweSemsForm.tsx";

const mocks = vi.hoisted(() => ({
  listStationsMutate: vi.fn(),
  listStationsState: {
    data: undefined as unknown,
    isPending: false,
    isError: false,
    error: null as { message: string } | null,
  },
  testMutate: vi.fn(),
}));

vi.mock("./trpc.ts", () => ({
  trpc: {
    plugin: {
      energy: {
        goodwe_sems: {
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

describe("GoodweSemsForm", () => {
  const renderForm = () =>
    renderWithProviders(
      <GoodweSemsForm
        initialAccount="owner@example.com"
        initialStationId=""
        initialUseSemsPlus={false}
        onTestSuccess={vi.fn()}
        onUseSemsPlusChange={vi.fn()}
      />,
    );

  const fillPassword = () => {
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "secret" },
    });
  };

  const setStations = (stations: Array<{ id: string; name: string }>) => {
    mocks.listStationsState.data = { success: true, stations };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listStationsState.data = undefined;
    mocks.listStationsState.isPending = false;
    mocks.listStationsState.isError = false;
    mocks.listStationsState.error = null;
  });

  afterEach(() => {
    cleanup();
  });

  it("Load Stations is disabled until account and password are filled", () => {
    renderForm();

    expect(screen.getByRole("button", { name: "Load Stations" }))
      .toBeDisabled();

    fillPassword();

    expect(screen.getByRole("button", { name: "Load Stations" }))
      .toBeEnabled();
  });

  it("Load Stations calls listStations with the credentials", () => {
    renderForm();
    fillPassword();

    fireEvent.click(screen.getByRole("button", { name: "Load Stations" }));

    expect(mocks.listStationsMutate).toHaveBeenCalledWith({
      account: "owner@example.com",
      password: "secret",
      useSemsPlus: false,
    });
  });

  it("lists the returned stations as rows with name, id and a Use button", () => {
    setStations([
      { id: "station-a", name: "Home Array" },
      { id: "station-b", name: "Shed Array" },
    ]);

    renderForm();

    expect(screen.getByText("Home Array")).toBeInTheDocument();
    expect(screen.getByText("station-a")).toBeInTheDocument();
    expect(screen.getByText("Shed Array")).toBeInTheDocument();
    expect(screen.getByText("station-b")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Use" })).toHaveLength(2);
  });

  it("no station rows before Load Stations returns", () => {
    renderForm();

    expect(screen.queryByText("Power Station")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use" }))
      .not.toBeInTheDocument();
  });

  it("shows the empty state when the account has no stations", () => {
    setStations([]);

    renderForm();

    expect(screen.getByText("No power stations found on this SEMS account."))
      .toBeInTheDocument();
  });

  it("Use marks the station selected and enables Test Connection", async () => {
    setStations([
      { id: "station-a", name: "Home Array" },
      { id: "station-b", name: "Shed Array" },
    ]);

    renderForm();
    fillPassword();

    expect(screen.getByRole("button", { name: "Test Connection" }))
      .toBeDisabled();

    fireEvent.click(screen.getAllByRole("button", { name: "Use" })[0]);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Test Connection" }))
        .toBeEnabled();
    });
    // The chosen row swaps its Use button for a Selected badge.
    expect(screen.getByText("Selected")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Use" })).toHaveLength(1);
  });

  it("Test Connection sends the station chosen with Use", async () => {
    setStations([{ id: "station-a", name: "Home Array" }]);

    renderForm();
    fillPassword();
    fireEvent.click(screen.getByRole("button", { name: "Use" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Test Connection" }))
        .toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));

    expect(mocks.testMutate).toHaveBeenCalledWith({
      account: "owner@example.com",
      password: "secret",
      stationId: "station-a",
      useSemsPlus: false,
    });
  });

  it("surfaces a listStations failure", () => {
    mocks.listStationsState.data = { success: false, error: "Login failed" };

    renderForm();

    expect(screen.getByText("Login failed")).toBeInTheDocument();
  });
});
