import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useChargersSettings } from "./useChargersSettings.ts";

const mocks = vi.hoisted(() => ({ mutateMock: vi.fn() }));

vi.mock("@chargeha/plugins/componentRegistry", () => ({
  // "sim" is the shape that matters: a panel AND directAdd. Its settings are
  // dev knobs for an existing row, not fields to fill in before creating one.
  pluginSettingsComponents: {
    "tapo-settings": () => null,
    "sim-settings": () => null,
  },
  chargerPluginOptions: [
    { id: "tapo", label: "Tapo", description: "", iconKey: "plug" },
    {
      id: "sim",
      label: "Sim",
      description: "",
      iconKey: "monitor",
      directAdd: true,
    },
  ],
}));

vi.mock("../../../trpc.ts", () => ({
  trpc: {
    useUtils: () => ({ charger: { list: { invalidate: vi.fn() } } }),
    charger: {
      remove: { useMutation: () => ({ mutate: vi.fn(), error: null }) },
      create: {
        useMutation: () => ({
          mutate: mocks.mutateMock,
          error: null,
          isPending: false,
        }),
      },
      reorder: { useMutation: () => ({ mutate: vi.fn(), error: null }) },
      setVehicleId: { useMutation: () => ({ mutate: vi.fn(), error: null }) },
    },
    vehicle: {
      list: { useQuery: () => ({ data: [], isLoading: false }) },
    },
  },
}));

vi.mock("../../../hooks/useChargers.ts", () => ({
  useChargers: () => ({
    // One existing vehicle-API charging point and no smart chargers yet —
    // the shape that makes adding a smart charger trigger the control-path
    // confirm dialog.
    chargers: [{
      id: "v1",
      kind: "vehicle_api",
      chargerAdapterType: "vehicle",
    }],
  }),
  isSmartCharger: (c: { kind: string }) => c.kind === "smart",
}));

describe("useChargersSettings", () => {
  afterEach(() => {
    cleanup();
    mocks.mutateMock.mockReset();
  });

  it("declining the control-path dialog never runs the panel's commit", () => {
    const { result } = renderHook(() => useChargersSettings());
    const commit = vi.fn();

    act(() => result.current.choose("tapo")); // has a panel → opens the add form
    act(() => result.current.submitEdit(commit)); // needsAddConfirm → opens the dialog

    expect(result.current.confirm).toEqual(
      expect.objectContaining({ kind: "add", typeId: "tapo" }),
    );
    expect(commit).not.toHaveBeenCalled();

    act(() => result.current.cancelConfirm());

    expect(result.current.confirm).toBeNull();
    expect(commit).not.toHaveBeenCalled();
  });

  it("adds a directAdd type straight away, panel or no panel", () => {
    const { result } = renderHook(() => useChargersSettings());

    // Has a settings panel, but nothing to configure before the row exists.
    // Routing it into the add form leaves an empty form whose Add does
    // nothing, because the panel has no row to read or save.
    act(() => result.current.choose("sim"));

    expect(result.current.editing).toBeNull();
    // needsAddConfirm here, so creation waits on the dialog rather than
    // running immediately — but it is `addCharger`, not a panel commit.
    expect(result.current.confirm).toEqual(
      expect.objectContaining({ kind: "add", typeId: "sim" }),
    );

    act(() => result.current.acceptConfirm());

    expect(mocks.mutateMock).toHaveBeenCalledWith(
      { chargerAdapterType: "sim" },
      expect.anything(),
    );
  });

  it("accepting the control-path dialog runs the panel's commit", () => {
    const { result } = renderHook(() => useChargersSettings());
    const commit = vi.fn();

    act(() => result.current.choose("tapo"));
    act(() => result.current.submitEdit(commit));
    act(() => result.current.acceptConfirm());

    expect(commit).toHaveBeenCalledTimes(1);
  });
});
