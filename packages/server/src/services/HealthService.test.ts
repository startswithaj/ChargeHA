import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { HealthService } from "./HealthService.ts";
import type { VehiclePluginRegistry } from "@chargeha/server/bootstrap/VehiclePluginRegistry";
import { EnergyPluginRegistry } from "@chargeha/server/bootstrap/EnergyPluginRegistry";
import { ChargerPluginRegistry } from "@chargeha/server/bootstrap/ChargerPluginRegistry";
import type { PluginHealthCheck } from "@chargeha/shared/plugins";
import { throwingMock } from "../test-helpers/throwingMock.ts";

describe("HealthService", () => {
  const emptyEnergyRegistry = new EnergyPluginRegistry();
  const emptyChargerRegistry = new ChargerPluginRegistry();

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
        emptyChargerRegistry,
        null,
      );
      expect(service.checkEncryption()).toEqual({ configured: false });
    });

    it("returns configured: true when encryptionKey is set", () => {
      const service = new HealthService(
        createMockRegistry(),
        emptyEnergyRegistry,
        emptyChargerRegistry,
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
        emptyChargerRegistry,
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
        emptyChargerRegistry,
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
        emptyChargerRegistry,
        null,
      );
      const result = await service.getPluginWarnings();
      expect(result).toEqual([
        { title: "Proxy Down", message: "not reachable", severity: "error" },
      ]);
    });

    it("falls back to warningMessage when the check reports no detail", async () => {
      const checks: PluginHealthCheck[] = [{
        name: "check-1",
        warningTitle: "Proxy Down",
        warningMessage: "Cannot reach proxy",
        run: () => Promise.resolve({ status: "error" }),
      }];
      const service = new HealthService(
        createMockRegistry(checks),
        emptyEnergyRegistry,
        emptyChargerRegistry,
        null,
      );
      const result = await service.getPluginWarnings();
      expect(result).toEqual([
        {
          title: "Proxy Down",
          message: "Cannot reach proxy",
          severity: "error",
        },
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
        emptyChargerRegistry,
        null,
      );
      const result = await service.getPluginWarnings();
      expect(result).toEqual([
        {
          title: "Slow Service",
          message: "Service timed out",
          severity: "error",
        },
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
        emptyChargerRegistry,
        null,
      );
      const result = await service.getPluginWarnings();
      expect(result).toEqual([
        {
          title: "Connection Error",
          message: "Cannot connect",
          severity: "error",
        },
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
        emptyChargerRegistry,
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
          run: () => Promise.resolve({ status: "error" }),
        },
      ];
      const service = new HealthService(
        createMockRegistry(checks),
        emptyEnergyRegistry,
        emptyChargerRegistry,
        null,
      );
      const result = await service.getPluginWarnings();
      expect(result).toEqual([
        {
          title: "Fail Warning",
          message: "This should appear",
          severity: "error",
        },
      ]);
    });

    it("marks a warning-status check as a warning, not an error", async () => {
      const checks: PluginHealthCheck[] = [{
        name: "degraded-check",
        warningTitle: "Reduced telemetry",
        warningMessage: "Some readings are unavailable.",
        run: () =>
          Promise.resolve({
            status: "warning",
            message: "Charging current is not being reported.",
          }),
      }];
      const service = new HealthService(
        createMockRegistry(checks),
        emptyEnergyRegistry,
        emptyChargerRegistry,
        null,
      );
      const result = await service.getPluginWarnings();
      expect(result).toEqual([{
        title: "Reduced telemetry",
        message: "Charging current is not being reported.",
        severity: "warning",
      }]);
    });

    it("orders errors ahead of warnings", async () => {
      const checks: PluginHealthCheck[] = [
        {
          name: "check-warn",
          warningTitle: "Degraded",
          warningMessage: "Still charging.",
          run: () => Promise.resolve({ status: "warning" }),
        },
        {
          name: "check-error",
          warningTitle: "Offline",
          warningMessage: "Not charging.",
          run: () => Promise.resolve({ status: "error" }),
        },
      ];
      const service = new HealthService(
        createMockRegistry(checks),
        emptyEnergyRegistry,
        emptyChargerRegistry,
        null,
      );
      const result = await service.getPluginWarnings();
      expect(result.map((w) => w.severity)).toEqual(["error", "warning"]);
      expect(result[0].title).toBe("Offline");
    });

    it("dedupes a check shared by a plugin registered in two registries", async () => {
      const runs: string[] = [];
      const check: PluginHealthCheck = {
        name: "tesla-proxy",
        warningTitle: "Tesla Proxy Unreachable",
        warningMessage: "Vehicle commands will fail.",
        run: () => {
          runs.push("tesla-proxy");
          return Promise.resolve({ status: "error", message: "down" });
        },
      };
      const service = new HealthService(
        createMockRegistry([check]),
        emptyEnergyRegistry,
        throwingMock<ChargerPluginRegistry>("ChargerPluginRegistry", {
          getHealthChecks: () => [check],
        }),
        null,
      );
      const result = await service.getPluginWarnings();
      expect(result).toEqual([{
        title: "Tesla Proxy Unreachable",
        message: "down",
        severity: "error",
      }]);
      expect(runs).toEqual(["tesla-proxy"]);
    });
  });
});
