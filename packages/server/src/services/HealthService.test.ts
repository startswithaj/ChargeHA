import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { HealthService } from "./HealthService.ts";
import type { VehiclePluginRegistry } from "@chargeha/server/bootstrap/VehiclePluginRegistry";
import type { PluginHealthCheck } from "@chargeha/plugins/types";
import { throwingMock } from "../test-helpers/throwingMock.ts";

describe("HealthService", () => {
  const emptyEnergyRegistry = {
    getHealthChecks: () => [],
  } as unknown as import("../bootstrap/EnergyPluginRegistry.ts").EnergyPluginRegistry;

  const createMockRegistry = (
    checks: PluginHealthCheck[] = [],
  ): VehiclePluginRegistry =>
    throwingMock<VehiclePluginRegistry>("VehiclePluginRegistry", {
      getHealthChecks: () => checks,
    });

  describe("checkEncryption", () => {
    it("returns configured: false when encryptionKey is null", () => {
      const service = new HealthService(
        createMockRegistry(),
        emptyEnergyRegistry,
        null,
      );
      expect(service.checkEncryption()).toEqual({ configured: false });
    });

    it("returns configured: true when encryptionKey is set", () => {
      const service = new HealthService(
        createMockRegistry(),
        emptyEnergyRegistry,
        "test-key",
      );
      expect(service.checkEncryption()).toEqual({ configured: true });
    });
  });

  describe("getPluginWarnings", () => {
    it("returns empty array when no health checks", async () => {
      const service = new HealthService(
        createMockRegistry([]),
        emptyEnergyRegistry,
        null,
      );
      const result = await service.getPluginWarnings();
      expect(result).toEqual([]);
    });

    it("returns empty array when all checks pass", async () => {
      const checks: PluginHealthCheck[] = [{
        name: "check-1",
        warningTitle: "Test Warning",
        warningMessage: "Something broke",
        run: () => Promise.resolve({ status: "ok" }),
      }];
      const service = new HealthService(
        createMockRegistry(checks),
        emptyEnergyRegistry,
        null,
      );
      const result = await service.getPluginWarnings();
      expect(result).toEqual([]);
    });

    it("returns warning when a check fails", async () => {
      const checks: PluginHealthCheck[] = [{
        name: "check-1",
        warningTitle: "Proxy Down",
        warningMessage: "Cannot reach proxy",
        run: () =>
          Promise.resolve({ status: "error", message: "not reachable" }),
      }];
      const service = new HealthService(
        createMockRegistry(checks),
        emptyEnergyRegistry,
        null,
      );
      const result = await service.getPluginWarnings();
      expect(result).toEqual([
        { title: "Proxy Down", message: "Cannot reach proxy" },
      ]);
    });

    it("returns warning when a check times out", async () => {
      const checks: PluginHealthCheck[] = [{
        name: "slow-check",
        timeoutMs: 50,
        warningTitle: "Slow Service",
        warningMessage: "Service timed out",
        run: () => new Promise(() => {}), // Never resolves
      }];
      const service = new HealthService(
        createMockRegistry(checks),
        emptyEnergyRegistry,
        null,
      );
      const result = await service.getPluginWarnings();
      expect(result).toEqual([
        { title: "Slow Service", message: "Service timed out" },
      ]);
    });

    it("returns warning when a check throws", async () => {
      const checks: PluginHealthCheck[] = [{
        name: "throwing-check",
        warningTitle: "Connection Error",
        warningMessage: "Cannot connect",
        run: () => Promise.reject(new Error("connection refused")),
      }];
      const service = new HealthService(
        createMockRegistry(checks),
        emptyEnergyRegistry,
        null,
      );
      const result = await service.getPluginWarnings();
      expect(result).toEqual([
        { title: "Connection Error", message: "Cannot connect" },
      ]);
    });

    it("skips checks without warningTitle/warningMessage", async () => {
      const checks: PluginHealthCheck[] = [{
        name: "silent-check",
        run: () =>
          Promise.resolve({ status: "error", message: "not reachable" }),
      }];
      const service = new HealthService(
        createMockRegistry(checks),
        emptyEnergyRegistry,
        null,
      );
      const result = await service.getPluginWarnings();
      expect(result).toEqual([]);
    });

    it("only returns warnings for failed checks", async () => {
      const checks: PluginHealthCheck[] = [
        {
          name: "check-ok",
          warningTitle: "OK Warning",
          warningMessage: "This should not appear",
          run: () => Promise.resolve({ status: "ok" }),
        },
        {
          name: "check-fail",
          warningTitle: "Fail Warning",
          warningMessage: "This should appear",
          run: () => Promise.resolve({ status: "error", message: "down" }),
        },
      ];
      const service = new HealthService(
        createMockRegistry(checks),
        emptyEnergyRegistry,
        null,
      );
      const result = await service.getPluginWarnings();
      expect(result).toEqual([
        { title: "Fail Warning", message: "This should appear" },
      ]);
    });
  });
});
