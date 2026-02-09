import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { discoverFronius } from "./discovery.ts";
import { Logger } from "@chargeha/server/lib/Logger";
import {
  type FroniusFetchStub,
  installFroniusFetchStub,
} from "./test-helpers/froniusFetchHarness.ts";
import {
  type DiscoveryStubs,
  installDiscoveryStubs,
} from "./test-helpers/discoveryHarness.ts";

describe("discoverFronius", () => {
  const testLogger = new Logger("FroniusDiscovery", "error");

  let fetchStub: FroniusFetchStub;
  let discoveryStubs: DiscoveryStubs;

  const froniusResponse = (host: string, name: string, dt: number) => {
    fetchStub.setResponse(host, {
      ok: true,
      status: 200,
      json: { Body: { Data: { "1": { CustomName: name, DT: dt } } } },
    });
  };

  beforeEach(() => {
    fetchStub = installFroniusFetchStub({ matchBy: "hostPrefix" });
    discoveryStubs = installDiscoveryStubs();
  });

  afterEach(() => {
    fetchStub.restore();
    discoveryStubs.restore();
  });

  describe("with explicit subnet", () => {
    it("scans all 254 IPs in the given subnet", async () => {
      froniusResponse("10.0.0.50", "TestInverter", 99);
      const results = await discoverFronius(testLogger, "10.0.0");
      expect(results).toHaveLength(1);
      expect(results[0].host).toBe("10.0.0.50");
      expect(results[0].name).toBe("TestInverter");
      expect(results[0].model).toBe("99");
    });

    it("strips trailing dot from subnet", async () => {
      froniusResponse("10.0.0.1", "Inverter", 1);
      const results = await discoverFronius(testLogger, "10.0.0.");
      expect(results).toHaveLength(1);
      expect(results[0].host).toBe("10.0.0.1");
    });
  });

  describe("ARP-based discovery", () => {
    it("expands ARP subnets to full /24 scan", async () => {
      // ARP returns only .10 and .20, but inverter is at .189
      discoveryStubs.setArpOutput(
        "? (192.168.1.10) at aa:bb:cc:dd:ee:ff\n? (192.168.1.20) at 11:22:33:44:55:66\n",
      );
      froniusResponse("192.168.1.189", "MyFronius", 123);

      const results = await discoverFronius(testLogger);
      expect(results).toHaveLength(1);
      expect(results[0].host).toBe("192.168.1.189");
      expect(results[0].name).toBe("MyFronius");
    });

    it("filters out broadcast and multicast addresses from ARP", async () => {
      discoveryStubs.setArpOutput(
        "? (192.168.1.255) at ff:ff:ff:ff:ff:ff\n? (224.0.0.1) at 01:00:5e:00:00:01\n? (192.168.1.50) at aa:bb:cc:dd:ee:ff\n",
      );
      froniusResponse("192.168.1.50", "Inverter", 1);

      const results = await discoverFronius(testLogger);
      expect(results).toHaveLength(1);
      expect(results[0].host).toBe("192.168.1.50");
    });

    it("handles multiple subnets from ARP", async () => {
      discoveryStubs.setArpOutput(
        "? (192.168.1.10) at aa:bb:cc:dd:ee:ff\n? (10.0.0.5) at 11:22:33:44:55:66\n",
      );
      froniusResponse("10.0.0.100", "NetBInverter", 42);

      const results = await discoverFronius(testLogger);
      expect(results).toHaveLength(1);
      expect(results[0].host).toBe("10.0.0.100");
    });
  });

  describe("fallback when ARP unavailable", () => {
    it("falls back to network interface detection", async () => {
      discoveryStubs.setArpThrows(true);
      discoveryStubs.setInterfaces([
        {
          name: "en0",
          address: "192.168.5.100",
          netmask: "255.255.255.0",
          family: "IPv4",
          mac: "aa:bb:cc:dd:ee:ff",
          scopeid: null,
          cidr: "192.168.5.100/24",
        },
      ]);
      froniusResponse("192.168.5.42", "FallbackInverter", 7);

      const results = await discoverFronius(testLogger);
      expect(results).toHaveLength(1);
      expect(results[0].host).toBe("192.168.5.42");
    });

    it("skips loopback interfaces", async () => {
      discoveryStubs.setArpThrows(true);
      discoveryStubs.setInterfaces([
        {
          name: "lo0",
          address: "127.0.0.1",
          netmask: "255.0.0.0",
          family: "IPv4",
          mac: "00:00:00:00:00:00",
          scopeid: null,
          cidr: "127.0.0.1/8",
        },
        {
          name: "en0",
          address: "192.168.2.50",
          netmask: "255.255.255.0",
          family: "IPv4",
          mac: "aa:bb:cc:dd:ee:ff",
          scopeid: null,
          cidr: "192.168.2.50/24",
        },
      ]);
      froniusResponse("192.168.2.1", "Inverter", 1);

      const results = await discoverFronius(testLogger);
      expect(results).toHaveLength(1);
      expect(results[0].host).toBe("192.168.2.1");
    });

    it("falls back to 192.168.1.* when interface detection also fails", async () => {
      discoveryStubs.setArpThrows(true);
      discoveryStubs.setInterfacesThrow(true);
      froniusResponse("192.168.1.100", "LastResort", 55);

      const results = await discoverFronius(testLogger);
      expect(results).toHaveLength(1);
      expect(results[0].host).toBe("192.168.1.100");
    });
  });

  describe("probe handling", () => {
    it("returns empty array when no inverters respond", async () => {
      discoveryStubs.setArpOutput("? (192.168.1.10) at aa:bb:cc:dd:ee:ff\n");
      const results = await discoverFronius(testLogger);
      expect(results).toHaveLength(0);
    });

    it("handles non-ok HTTP responses gracefully", async () => {
      discoveryStubs.setArpOutput("? (192.168.1.10) at aa:bb:cc:dd:ee:ff\n");
      fetchStub.setResponse("192.168.1.10", {
        ok: false,
        status: 500,
        json: {},
      });

      const results = await discoverFronius(testLogger);
      expect(results).toHaveLength(0);
    });

    it("handles response with no inverter data", async () => {
      discoveryStubs.setArpOutput("? (192.168.1.10) at aa:bb:cc:dd:ee:ff\n");
      fetchStub.setResponse("192.168.1.10", {
        ok: true,
        status: 200,
        json: { Body: { Data: null } },
      });

      const results = await discoverFronius(testLogger);
      expect(results).toHaveLength(0);
    });

    it("uses defaults for missing CustomName and DT", async () => {
      discoveryStubs.setArpOutput("? (192.168.1.10) at aa:bb:cc:dd:ee:ff\n");
      fetchStub.setResponse("192.168.1.10", {
        ok: true,
        status: 200,
        json: { Body: { Data: { "1": {} } } },
      });

      const results = await discoverFronius(testLogger);
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("Fronius Inverter");
      expect(results[0].model).toBe("Unknown");
    });

    it("finds multiple inverters on same subnet", async () => {
      discoveryStubs.setArpOutput("? (192.168.1.10) at aa:bb:cc:dd:ee:ff\n");
      froniusResponse("192.168.1.10", "Inverter1", 1);
      froniusResponse("192.168.1.50", "Inverter2", 2);

      const results = await discoverFronius(testLogger);
      expect(results).toHaveLength(2);
      const hosts = results.map((r) => r.host).sort();
      expect(hosts).toEqual(["192.168.1.10", "192.168.1.50"]);
    });
  });
});
