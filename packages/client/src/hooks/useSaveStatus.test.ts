import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSaveStatus } from "./useSectionConfig.ts";

describe("useSaveStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts idle", () => {
    const { result } = renderHook(() => useSaveStatus());
    expect(result.current.saveStatus.state).toBe("idle");
  });

  it("shows saving after 300ms if mutation is still pending", () => {
    const { result } = renderHook(() => useSaveStatus());

    act(() => result.current.onMutate());
    expect(result.current.saveStatus.state).toBe("idle");

    act(() => vi.advanceTimersByTime(300));
    expect(result.current.saveStatus.state).toBe("saving");
  });

  it("skips saving if mutation succeeds within 300ms", () => {
    const { result } = renderHook(() => useSaveStatus());

    act(() => result.current.onMutate());
    act(() => vi.advanceTimersByTime(100));
    act(() => result.current.onSuccess());

    expect(result.current.saveStatus.state).toBe("saved");
  });

  it("returns to idle 2s after save", () => {
    const { result } = renderHook(() => useSaveStatus());

    act(() => result.current.onMutate());
    act(() => result.current.onSuccess());

    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.saveStatus.state).toBe("idle");
  });

  it("shows error with message", () => {
    const { result } = renderHook(() => useSaveStatus());

    act(() => result.current.onMutate());
    act(() => result.current.onError(new Error("Network failure")));

    expect(result.current.saveStatus.state).toBe("error");
    expect(result.current.saveStatus.message).toBe("Network failure");
  });

  it("returns to idle 5s after error", () => {
    const { result } = renderHook(() => useSaveStatus());

    act(() => result.current.onMutate());
    act(() => result.current.onError(new Error("fail")));

    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.saveStatus.state).toBe("idle");
  });

  it("onError uses fallback message for non-Error value", () => {
    const { result } = renderHook(() => useSaveStatus());

    act(() => {
      result.current.onError("string error");
    });

    expect(result.current.saveStatus.message).toBe("Failed to save");
  });

  it("onMutate clears both timerRef and savingTimerRef from previous cycle", () => {
    const { result } = renderHook(() => useSaveStatus());

    // onSuccess sets timerRef (2s idle revert)
    act(() => result.current.onSuccess());
    expect(result.current.saveStatus.state).toBe("saved");

    // onMutate should clear that timer and start fresh
    act(() => result.current.onMutate());

    // After 300ms, should show saving (not idle from the old timer)
    act(() => vi.advanceTimersByTime(300));
    expect(result.current.saveStatus.state).toBe("saving");
  });

  it("onError clears savingTimerRef from onMutate", () => {
    const { result } = renderHook(() => useSaveStatus());

    act(() => result.current.onMutate());
    act(() => result.current.onError(new Error("fail")));

    // After 300ms, should NOT show saving since onError cleared the timer
    act(() => vi.advanceTimersByTime(300));
    expect(result.current.saveStatus.state).toBe("error");
  });

  it("retriggers on successive saves", () => {
    const { result } = renderHook(() => useSaveStatus());

    // First save
    act(() => result.current.onMutate());
    act(() => result.current.onSuccess());
    const tick1 = result.current.saveStatus.tick;

    // Second save while still "saved"
    act(() => result.current.onMutate());
    act(() => result.current.onSuccess());
    const tick2 = result.current.saveStatus.tick;

    // Third save while still "saved"
    act(() => result.current.onMutate());
    act(() => result.current.onSuccess());
    const tick3 = result.current.saveStatus.tick;

    expect(result.current.saveStatus.state).toBe("saved");
    expect(tick1).not.toBe(tick2);
    expect(tick2).not.toBe(tick3);
  });
});
