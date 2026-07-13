import { beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Logger } from "@chargeha/server/lib/Logger";
import { isSigenergyModel } from "./SigenergyDiscovery.ts";
import {
  installSigenergyDiscoveryStubs,
  type SigenergyDiscoveryStubs,
} from "./test-helpers/sigenergyDiscoveryHarness.ts";

describe("discoverSigenergy", () => {
  const SIGENSTOR_MODEL = "SigenStor EC 10.0 SP AU";
  const testLogger = new Logger("SigenergyDiscovery", "error");
  let stubs: SigenergyDiscoveryStubs;

  beforeEach(() => {
    stubs = installSigenergyDiscoveryStubs();
  });

  describe("with explicit subnet", () => {
    it("scans all 254 IPs in the given subnet", async () => {
      stubs.setDevice("10.0.0.50", { model: SIGENSTOR_MODEL, serial: "CMU1" });
      const results = await stubs.discover(testLogger, "10.0.0");
      expect(results).toHaveLength(1);
      expect(results[0].host).toBe("10.0.0.50");
      expect(results[0].name).toBe(SIGENSTOR_MODEL);
      expect(results[0].model).toBe(SIGENSTOR_MODEL);
      expect(results[0].serial).toBe("CMU1");
    });

    it("strips trailing dot from subnet", async () => {
      stubs.setDevice("10.0.0.1", { model: SIGENSTOR_MODEL });
      const results = await stubs.discover(testLogger, "10.0.0.");
      expect(results).toHaveLength(1);
      expect(results[0].host).toBe("10.0.0.1");
    });
  });

  describe("ARP-based discovery", () => {
    it("expands ARP subnets to a full /24 scan", async () => {
      stubs.setArpOutput(
        "? (192.168.1.10) at aa:bb:cc:dd:ee:ff\n? (192.168.1.20) at 11:22:33:44:55:66\n",
      );
      stubs.setDevice("192.168.1.189", { model: SIGENSTOR_MODEL });

      const results = await stubs.discover(testLogger);
      expect(results).toHaveLength(1);
      expect(results[0].host).toBe("192.168.1.189");
    });

    it("filters out broadcast and multicast addresses from ARP", async () => {
      stubs.setArpOutput(
        "? (192.168.1.255) at ff:ff:ff:ff:ff:ff\n? (224.0.0.1) at 01:00:5e:00:00:01\n? (192.168.1.50) at aa:bb:cc:dd:ee:ff\n",
      );
      stubs.setDevice("192.168.1.50", { model: SIGENSTOR_MODEL });

      const results = await stubs.discover(testLogger);
      expect(results).toHaveLength(1);
      expect(results[0].host).toBe("192.168.1.50");
    });

    it("handles multiple subnets from ARP", async () => {
      stubs.setArpOutput(
        "? (192.168.1.10) at aa:bb:cc:dd:ee:ff\n? (10.0.0.5) at 11:22:33:44:55:66\n",
      );
      stubs.setDevice("10.0.0.100", { model: SIGENSTOR_MODEL });

      const results = await stubs.discover(testLogger);
      expect(results).toHaveLength(1);
      expect(results[0].host).toBe("10.0.0.100");
    });
  });

  describe("fallback when ARP unavailable", () => {
    const iface = (address: string): Deno.NetworkInterfaceInfo => ({
      name: "en0",
      address,
      netmask: "255.255.255.0",
      family: "IPv4",
      mac: "aa:bb:cc:dd:ee:ff",
      scopeid: null,
      cidr: `${address}/24`,
    });

    it("falls back to network interface detection", async () => {
      stubs.setArpThrows(true);
      stubs.setInterfaces([iface("192.168.5.100")]);
      stubs.setDevice("192.168.5.42", { model: SIGENSTOR_MODEL });

      const results = await stubs.discover(testLogger);
      expect(results).toHaveLength(1);
      expect(results[0].host).toBe("192.168.5.42");
    });

    it("skips loopback interfaces", async () => {
      stubs.setArpThrows(true);
      stubs.setInterfaces([
        {
          name: "lo0",
          address: "127.0.0.1",
          netmask: "255.0.0.0",
          family: "IPv4",
          mac: "00:00:00:00:00:00",
          scopeid: null,
          cidr: "127.0.0.1/8",
        },
        iface("192.168.2.50"),
      ]);
      stubs.setDevice("192.168.2.1", { model: SIGENSTOR_MODEL });

      const results = await stubs.discover(testLogger);
      expect(results).toHaveLength(1);
      expect(results[0].host).toBe("192.168.2.1");
    });

    it("falls back to 192.168.1.* when interface detection also fails", async () => {
      stubs.setArpThrows(true);
      stubs.setInterfacesThrow(true);
      stubs.setDevice("192.168.1.100", { model: SIGENSTOR_MODEL });

      const results = await stubs.discover(testLogger);
      expect(results).toHaveLength(1);
      expect(results[0].host).toBe("192.168.1.100");
    });
  });

  describe("fingerprint / healthcheck", () => {
    it("returns empty when nothing is listening on port 502", async () => {
      stubs.setArpOutput("? (192.168.1.10) at aa:bb:cc:dd:ee:ff\n");
      const results = await stubs.discover(testLogger);
      expect(results).toHaveLength(0);
    });

    it("rejects a generic Modbus device whose model isn't Sigenergy", async () => {
      stubs.setArpOutput("? (192.168.1.10) at aa:bb:cc:dd:ee:ff\n");
      // Answers on port 502 and even on the plant unit, but wrong model.
      stubs.setDevice("192.168.1.10", {
        model: "SunSpec Inverter",
        plant: true,
      });

      const results = await stubs.discover(testLogger);
      expect(results).toHaveLength(0);
    });

    it("rejects a Sigen-badged device that doesn't answer the plant unit", async () => {
      stubs.setArpOutput("? (192.168.1.10) at aa:bb:cc:dd:ee:ff\n");
      stubs.setDevice("192.168.1.10", { model: SIGENSTOR_MODEL, plant: false });

      const results = await stubs.discover(testLogger);
      expect(results).toHaveLength(0);
    });

    it("accepts a Sigenergy Neo (different product, same Sigen prefix)", async () => {
      stubs.setArpOutput("? (192.168.1.10) at aa:bb:cc:dd:ee:ff\n");
      stubs.setDevice("192.168.1.10", { model: "Sigenergy Neo" });

      const results = await stubs.discover(testLogger);
      expect(results).toHaveLength(1);
      expect(results[0].model).toBe("Sigenergy Neo");
    });

    it("tolerates a failed serial read, leaving serial blank", async () => {
      stubs.setArpOutput("? (192.168.1.10) at aa:bb:cc:dd:ee:ff\n");
      stubs.setDevice("192.168.1.10", { model: SIGENSTOR_MODEL }); // no serial seeded

      const results = await stubs.discover(testLogger);
      expect(results).toHaveLength(1);
      expect(results[0].serial).toBe("");
    });

    it("short-circuits at the first device found and ignores the rest", async () => {
      // ChargeHA supports one inverter, so discovery stops once it finds one.
      // .10 sits in the first probe batch (ARP IP leads the candidate list);
      // .50 lands in a later batch that should never be scanned.
      stubs.setArpOutput("? (192.168.1.10) at aa:bb:cc:dd:ee:ff\n");
      stubs.setDevice("192.168.1.10", { model: SIGENSTOR_MODEL });
      stubs.setDevice("192.168.1.50", { model: "Sigenergy Neo" });

      const results = await stubs.discover(testLogger);
      expect(results).toHaveLength(1);
      expect(results[0].host).toBe("192.168.1.10");
    });
  });
});

describe("isSigenergyModel", () => {
  it("matches Sigenergy product model strings case-insensitively", () => {
    expect(isSigenergyModel("SigenStor EC 10.0 SP AU")).toBe(true);
    expect(isSigenergyModel("Sigenergy Neo")).toBe(true);
    expect(isSigenergyModel("SIGENSTOR")).toBe(true);
  });

  it("rejects non-Sigenergy / empty model strings", () => {
    expect(isSigenergyModel("SunSpec Inverter")).toBe(false);
    expect(isSigenergyModel("Fronius Symo")).toBe(false);
    expect(isSigenergyModel("")).toBe(false);
  });
});
