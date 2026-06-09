import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getDemoState,
  initDemoState,
  resetDemoState,
  updateDemoState,
} from "./demoState.ts";
import { clearPersisted } from "./demoPersistence.ts";

describe("demoState", () => {
  beforeEach(() => {
    resetDemoState();
    clearPersisted();
  });

  afterEach(() => {
    resetDemoState();
    clearPersisted();
  });

  it("seeds first-run defaults and a 90-day series", async () => {
    const state = await initDemoState();
    expect(state.config.energy_adapter_type).toBe("");
    expect(state.config.wizard_completed).toBe("");
    expect(state.vehicles).toHaveLength(0);
    expect(state.tariffs).toHaveLength(2);
    expect(state.authenticated).toBe(false);
    expect(state.series.days).toHaveLength(90);
  });

  it("applies and reflects mutations", async () => {
    await initDemoState();
    updateDemoState((m) => ({ ...m, authenticated: true }));
    expect(getDemoState().authenticated).toBe(true);
  });

  it("rehydrates persisted edits after a reset", async () => {
    await initDemoState();
    updateDemoState((m) => ({
      ...m,
      authenticated: true,
      config: { ...m.config, wizard_step: "vehicle-type" },
    }));

    resetDemoState();
    const rehydrated = await initDemoState();
    expect(rehydrated.authenticated).toBe(true);
    expect(rehydrated.config.wizard_step).toBe("vehicle-type");
  });
});
