import { beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Logger } from "@chargeha/server/lib/Logger";
import { isEnvoyInfo } from "./envoyInfo.ts";
import {
  type EnphaseDiscoveryStubs,
  installEnphaseDiscoveryStubs,
} from "./test-helpers/enphaseDiscoveryHarness.ts";

describe("discoverEnphase", () => {
  const testLogger = new Logger("EnphaseDiscovery", "error");
  let stubs: EnphaseDiscoveryStubs;

  beforeEach(() => {
    stubs = installEnphaseDiscoveryStubs();
  });

  it("finds an Envoy in an explicit subnet", async () => {
    stubs.setDevice("10.0.0.40", { serial: "122233334444" });
    const results = await stubs.discover(testLogger, "10.0.0");
    expect(results).toHaveLength(1);
    expect(results[0].host).toBe("10.0.0.40");
    expect(results[0].serial).toBe("122233334444");
    expect(results[0].name).toContain("122233334444");
  });

  it("rejects HTTP devices that are not Envoys", async () => {
    stubs.setDevice("10.0.0.40", {
      serial: "n/a",
      rawBody: "<html><body>router admin</body></html>",
    });
    const results = await stubs.discover(testLogger, "10.0.0");
    expect(results).toHaveLength(0);
  });

  it("scans subnets expanded from the ARP table", async () => {
    stubs.setArpOutput("? (192.168.20.1) at 0:1:2:3:4:5 on en0");
    stubs.setDevice("192.168.20.77", { serial: "SN77" });
    const results = await stubs.discover(testLogger);
    expect(results).toHaveLength(1);
    expect(results[0].host).toBe("192.168.20.77");
  });

  it("stops at the first Envoy found", async () => {
    stubs.setDevice("10.0.0.5", { serial: "FIRST" });
    stubs.setDevice("10.0.0.200", { serial: "SECOND" });
    const results = await stubs.discover(testLogger, "10.0.0");
    expect(results).toHaveLength(1);
    expect(results[0].serial).toBe("FIRST");
  });
});

describe("isEnvoyInfo", () => {
  it("accepts an envoy_info document with a serial", () => {
    expect(isEnvoyInfo("<envoy_info><device><sn>1</sn></device></envoy_info>"))
      .toBe(true);
  });

  it("rejects documents without envoy_info or serial", () => {
    expect(isEnvoyInfo("<html>hi</html>")).toBe(false);
    expect(isEnvoyInfo("<envoy_info><device></device></envoy_info>")).toBe(
      false,
    );
  });
});
