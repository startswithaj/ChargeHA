import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDraftConfig } from "./useDraftConfig.ts";
import type { SaveStatus } from "./useSectionConfig.ts";

interface TestConfig {
  name: string;
  value: number;
  enabled: boolean;
}

describe("useDraftConfig", () => {
  const createMockMutation = () => {
    const mutate = vi.fn();
    let saveStatus: SaveStatus = { state: "idle", tick: 0 };

    return {
      mutate,
      get saveStatus() {
        return saveStatus;
      },
      setSaveStatus(s: SaveStatus) {
        saveStatus = s;
      },
    };
  };

  const serverData: TestConfig = { name: "test", value: 42, enabled: true };

  it("returns undefined fields when serverData is undefined", () => {
    const mutation = createMockMutation();
    const { result } = renderHook(() => useDraftConfig(undefined, mutation));

    expect(result.current.fields).toBeUndefined();
    expect(result.current.isDirty).toBe(false);
  });

  it("returns server data as fields when no draft changes exist", () => {
    const mutation = createMockMutation();
    const { result } = renderHook(() => useDraftConfig(serverData, mutation));

    expect(result.current.fields).toEqual(serverData);
    expect(result.current.isDirty).toBe(false);
  });

  it("setField marks the hook as dirty and merges into fields", () => {
    const mutation = createMockMutation();
    const { result } = renderHook(() => useDraftConfig(serverData, mutation));

    act(() => {
      result.current.setField("name", "changed");
    });

    expect(result.current.isDirty).toBe(true);
    expect(result.current.fields).toEqual({
      name: "changed",
      value: 42,
      enabled: true,
    });
  });

  it("multiple setField calls accumulate correctly", () => {
    const mutation = createMockMutation();
    const { result } = renderHook(() => useDraftConfig(serverData, mutation));

    act(() => {
      result.current.setField("name", "new");
      result.current.setField("value", 99);
    });

    expect(result.current.fields).toEqual({
      name: "new",
      value: 99,
      enabled: true,
    });
  });

  it("save calls mutation.mutate with accumulated draft fields", () => {
    const mutation = createMockMutation();
    const { result } = renderHook(() => useDraftConfig(serverData, mutation));

    act(() => {
      result.current.setField("name", "saved");
      result.current.setField("enabled", false);
    });

    act(() => {
      result.current.save();
    });

    expect(mutation.mutate).toHaveBeenCalledWith({
      name: "saved",
      enabled: false,
    });
  });

  it("save is a no-op when not dirty", () => {
    const mutation = createMockMutation();
    const { result } = renderHook(() => useDraftConfig(serverData, mutation));

    act(() => {
      result.current.save();
    });

    expect(mutation.mutate).not.toHaveBeenCalled();
  });

  it("draft clears when saveStatus transitions to saved", () => {
    const mutation = createMockMutation();
    const { result, rerender } = renderHook(() =>
      useDraftConfig(serverData, mutation)
    );

    act(() => {
      result.current.setField("name", "pending");
    });
    expect(result.current.isDirty).toBe(true);

    // Simulate save completing
    mutation.setSaveStatus({ state: "saved", tick: 1 });
    rerender();

    expect(result.current.isDirty).toBe(false);
    expect(result.current.fields?.name).toBe("test");
  });

  it("discard clears draft and resets isDirty", () => {
    const mutation = createMockMutation();
    const { result } = renderHook(() => useDraftConfig(serverData, mutation));

    act(() => {
      result.current.setField("name", "discarded");
    });
    expect(result.current.isDirty).toBe(true);

    act(() => {
      result.current.discard();
    });

    expect(result.current.isDirty).toBe(false);
    expect(result.current.fields?.name).toBe("test");
  });

  it("draft fields override server data in merged fields", () => {
    const mutation = createMockMutation();
    const { result } = renderHook(() => useDraftConfig(serverData, mutation));

    act(() => {
      result.current.setField("value", 0);
    });

    expect(result.current.fields?.value).toBe(0);
    // Server data unchanged
    expect(serverData.value).toBe(42);
  });

  it("forwards saveStatus from mutation", () => {
    const mutation = createMockMutation();
    mutation.setSaveStatus({ state: "saving", tick: 0 });
    const { result } = renderHook(() => useDraftConfig(serverData, mutation));

    expect(result.current.saveStatus.state).toBe("saving");
  });

  it("draft persists across server data refetches", () => {
    const mutation = createMockMutation();
    let data = { ...serverData };
    const { result, rerender } = renderHook(() =>
      useDraftConfig(data, mutation)
    );

    act(() => {
      result.current.setField("name", "draft-value");
    });

    // Simulate server refetch with different data
    data = { ...serverData, value: 999 };
    rerender();

    // Draft field preserved, server change visible for non-draft fields
    expect(result.current.fields?.name).toBe("draft-value");
    expect(result.current.fields?.value).toBe(999);
    expect(result.current.isDirty).toBe(true);
  });
});
