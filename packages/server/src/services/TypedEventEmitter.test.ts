import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { TypedEventEmitter } from "./TypedEventEmitter.ts";

describe("TypedEventEmitter", () => {
  type StatusOverrides = {
    vehicleId?: string;
    action?: "start" | "stop" | "none";
    reason?: string;
    targetAmps?: number | null;
  };
  const makeStatus = (detail: string, overrides: StatusOverrides = {}) => ({
    vehicleId: overrides.vehicleId ?? "V1",
    action: overrides.action ?? "start",
    reason: overrides.reason ?? "solar_tracking",
    detail,
    targetAmps: overrides.targetAmps ?? 10,
    checksJson: "[]",
  });

  describe("emit and subscribe", () => {
    it("delivers events to subscribers", () => {
      const emitter = new TypedEventEmitter();
      const received: string[] = [];
      emitter.subscribe("controller_status", (data) => {
        received.push(data.vehicleId);
      });
      emitter.emit("controller_status", makeStatus("test"));
      expect(received).toEqual(["V1"]);
    });

    it("does not deliver after unsubscribe", () => {
      const emitter = new TypedEventEmitter();
      const received: string[] = [];
      const unsub = emitter.subscribe("controller_status", (data) => {
        received.push(data.vehicleId);
      });
      unsub();
      emitter.emit("controller_status", makeStatus("test"));
      expect(received).toEqual([]);
    });
  });

  describe("retain and replay", () => {
    it("retains the last value per key when retainKey is provided", () => {
      const emitter = new TypedEventEmitter();
      emitter.emit(
        "controller_status",
        makeStatus("first", { reason: "schedule" }),
        "V1",
      );
      emitter.emit(
        "controller_status",
        makeStatus("second", { reason: "schedule", action: "none" }),
        "V1",
      );

      const received: string[] = [];
      emitter.subscribe("controller_status", (data) => {
        received.push(data.detail);
      }, { replay: true });

      // Should only get the last value, not both
      expect(received).toEqual(["second"]);
    });

    it("replays retained values for multiple keys", () => {
      const emitter = new TypedEventEmitter();
      emitter.emit(
        "controller_status",
        makeStatus("v1 status", { reason: "schedule" }),
        "V1",
      );
      emitter.emit(
        "controller_status",
        makeStatus("v2 status", {
          vehicleId: "V2",
          action: "none",
          reason: "idle",
          targetAmps: null,
        }),
        "V2",
      );

      const received: string[] = [];
      emitter.subscribe("controller_status", (data) => {
        received.push(data.detail);
      }, { replay: true });

      expect(received).toHaveLength(2);
      expect(received).toContain("v1 status");
      expect(received).toContain("v2 status");
    });

    it("does not replay when replay flag is not set", () => {
      const emitter = new TypedEventEmitter();
      emitter.emit(
        "controller_status",
        makeStatus("retained", { reason: "schedule" }),
        "V1",
      );

      const received: string[] = [];
      emitter.subscribe("controller_status", (data) => {
        received.push(data.detail);
      });

      expect(received).toEqual([]);
    });

    it("does not retain when no retainKey is provided", () => {
      const emitter = new TypedEventEmitter();
      emitter.emit(
        "controller_status",
        makeStatus("not retained", { reason: "schedule" }),
      );

      const received: string[] = [];
      emitter.subscribe("controller_status", (data) => {
        received.push(data.detail);
      }, { replay: true });

      expect(received).toEqual([]);
    });
  });
});
