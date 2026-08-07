import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useChargersSettings } from "./useChargersSettings.ts";

const mocks = vi.hoisted(() => ({ mutateMock: vi.fn() }));

vi.mock("@chargeha/plugins/componentRegistry", () => ({
  pluginSettingsComponents: { "tapo-settings": () => null },
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

  it("accepting the control-path dialog runs the panel's commit", () => {
    const { result } = renderHook(() => useChargersSettings());
    const commit = vi.fn();

    act(() => result.current.choose("tapo"));
    act(() => result.current.submitEdit(commit));
    act(() => result.current.acceptConfirm());

    expect(commit).toHaveBeenCalledTimes(1);
  });
});
