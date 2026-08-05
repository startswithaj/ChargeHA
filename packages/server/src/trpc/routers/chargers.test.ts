import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type { CallContext } from "@chargeha/shared";
import type { ChargerRow } from "../../db/types.ts";
import type { ChargingPointManager } from "../../services/ChargingPointManager.ts";
import { appRouter } from "../root.ts";
import { createCallerFactory } from "../trpc.ts";
import type { TrpcContext } from "../trpc.ts";
import { throwingMock } from "../../test-helpers/throwingMock.ts";

describe("Chargers tRPC Router", () => {
  const createCaller = createCallerFactory(appRouter);

  const CHARGER_ROW: ChargerRow = {
    id: "charger-1",
    name: "Garage Charger",
    chargerAdapterType: "simulated",
    chargerConfig: "{}",
    mode: "auto",
    priority: 1,
    vehicleId: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };

  const CHARGERS_WITH_STATE = [{
    ...CHARGER_ROW,
    state: null,
    resolvedVehicleId: null,
    vehicleResolution: "none" as const,
  }];

  const callerWithStub = (overrides: Partial<ChargingPointManager>) =>
    createCaller(throwingMock<TrpcContext>("TrpcContext", {
      chargingPointManager: throwingMock<ChargingPointManager>(
        "ChargingPointManager",
        overrides,
      ),
    }));

  describe("charger.list", () => {
    it("returns manager.getChargersWithState", async () => {
      const caller = callerWithStub({
        getChargersWithState: () => Promise.resolve(CHARGERS_WITH_STATE),
      });
      const data = await caller.charger.list();
      expect(data).toBe(CHARGERS_WITH_STATE);
    });
  });

  describe("charger.create", () => {
    it("forwards input and returns the created row", async () => {
      const calls: unknown[] = [];
      const caller = callerWithStub({
        createCharger: (input) => {
          calls.push(input);
          return Promise.resolve(CHARGER_ROW);
        },
      });
      const data = await caller.charger.create({
        name: "Garage Charger",
        chargerAdapterType: "simulated",
      });
      expect(calls).toEqual([
        { name: "Garage Charger", chargerAdapterType: "simulated" },
      ]);
      expect(data).toBe(CHARGER_ROW);
    });
  });

  describe("charger.ensure", () => {
    it("forwards the type to manager.ensureCharger, once", async () => {
      const calls: string[] = [];
      const caller = callerWithStub({
        ensureCharger: (chargerAdapterType) => {
          calls.push(chargerAdapterType);
          return Promise.resolve();
        },
      });
      await caller.charger.ensure({ chargerAdapterType: "simulated" });
      expect(calls).toEqual(["simulated"]);
    });
  });

  describe("charger.setMode", () => {
    it("forwards id and mode with a user origin ctx", async () => {
      const calls: Array<[string, string, CallContext]> = [];
      const caller = callerWithStub({
        setMode: (id, mode, ctx) => {
          calls.push([id, mode, ctx]);
          return Promise.resolve();
        },
      });
      await caller.charger.setMode({ id: "charger-1", mode: "charge_now" });
      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toBe("charger-1");
      expect(calls[0][1]).toBe("charge_now");
      expect(calls[0][2].origin).toBe("user:set-mode");
      expect(typeof calls[0][2].traceId).toBe("string");
    });
  });

  describe("charger.reorder", () => {
    it("forwards the id order", async () => {
      const calls: string[][] = [];
      const caller = callerWithStub({
        reorder: (order) => {
          calls.push(order);
          return Promise.resolve();
        },
      });
      await caller.charger.reorder({ order: ["charger-2", "charger-1"] });
      expect(calls).toEqual([["charger-2", "charger-1"]]);
    });
  });

  describe("charger.remove", () => {
    it("forwards to manager.deleteCharger", async () => {
      const calls: string[] = [];
      const caller = callerWithStub({
        deleteCharger: (id) => {
          calls.push(id);
          return Promise.resolve();
        },
      });
      await caller.charger.remove({ id: "charger-1" });
      expect(calls).toEqual(["charger-1"]);
    });
  });

  describe("input validation", () => {
    it("rejects bad mode values on setMode", async () => {
      const caller = callerWithStub({});
      await expect(
        caller.charger.setMode({
          id: "charger-1",
          mode: "invalid" as never,
        }),
      ).rejects.toThrow();
    });
  });
});
