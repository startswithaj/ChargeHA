import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  isLikelyDockerNetwork,
  isPrivateLanIpv4,
  sortLanAddresses,
} from "./lanAddresses.ts";

describe("isLikelyDockerNetwork", () => {
  it("matches the docker range as an address or a /24 prefix", () => {
    assertEquals(isLikelyDockerNetwork("172.17.0.2"), true);
    assertEquals(isLikelyDockerNetwork("172.28.0"), true);
    assertEquals(isLikelyDockerNetwork("172.31.255.1"), true);
  });

  it("leaves real LAN ranges and the public 172.x alone", () => {
    assertEquals(isLikelyDockerNetwork("192.168.1.50"), false);
    assertEquals(isLikelyDockerNetwork("10.0.0.5"), false);
    assertEquals(isLikelyDockerNetwork("172.15.0.1"), false);
    assertEquals(isLikelyDockerNetwork("172.32.0.1"), false);
    assertEquals(isLikelyDockerNetwork(""), false);
  });
});

describe("sortLanAddresses", () => {
  it("prefers 192.168, then 10, then other, then the docker range", () => {
    assertEquals(
      sortLanAddresses(["172.28.0.3", "100.64.0.1", "10.0.0.5", "192.168.1.4"]),
      ["192.168.1.4", "10.0.0.5", "100.64.0.1", "172.28.0.3"],
    );
  });

  it("does not mutate its input", () => {
    const input = ["172.28.0.3", "192.168.1.4"];
    sortLanAddresses(input);
    assertEquals(input, ["172.28.0.3", "192.168.1.4"]);
  });
});

describe("isPrivateLanIpv4", () => {
  it("accepts private IPv4 a charger could dial", () => {
    assertEquals(isPrivateLanIpv4("192.168.1.50"), true);
    assertEquals(isPrivateLanIpv4("10.1.2.3"), true);
    assertEquals(isPrivateLanIpv4("172.20.0.4"), true);
  });

  it("rejects loopback, hostnames and public addresses", () => {
    assertEquals(isPrivateLanIpv4("localhost"), false);
    assertEquals(isPrivateLanIpv4("127.0.0.1"), false);
    assertEquals(isPrivateLanIpv4("chargeha.local"), false);
    assertEquals(isPrivateLanIpv4("8.8.8.8"), false);
    assertEquals(isPrivateLanIpv4("192.168.1.999"), false);
  });
});
