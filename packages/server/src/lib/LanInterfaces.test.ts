/// <reference lib="deno.ns" />
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { detectLanAddresses, detectLanSubnets } from "./LanInterfaces.ts";

describe("detectLanAddresses", () => {
  function iface(
    overrides: Partial<Deno.NetworkInterfaceInfo>,
  ): Deno.NetworkInterfaceInfo {
    return {
      name: "en0",
      address: "192.168.1.50",
      netmask: "255.255.255.0",
      family: "IPv4",
      mac: "aa:bb:cc:dd:ee:ff",
      scopeid: null,
      cidr: "192.168.1.50/24",
      ...overrides,
    };
  }

  it("returns real LAN addresses", () => {
    const result = detectLanAddresses(() => [iface({})]);
    expect(result).toEqual(["192.168.1.50"]);
  });

  it("ranks a real LAN address above a docker-range one", () => {
    const result = detectLanAddresses(() => [
      iface({ name: "eth0", address: "172.28.0.3" }),
      iface({ name: "eth1", address: "192.168.1.50" }),
    ]);
    expect(result).toEqual(["192.168.1.50", "172.28.0.3"]);
  });

  it("excludes loopback", () => {
    const result = detectLanAddresses(() => [
      iface({ name: "lo0", address: "127.0.0.1" }),
    ]);
    expect(result).toEqual([]);
  });

  it("excludes link-local", () => {
    const result = detectLanAddresses(() => [
      iface({ address: "169.254.1.2" }),
    ]);
    expect(result).toEqual([]);
  });

  it("excludes virtual interfaces", () => {
    const result = detectLanAddresses(() => [
      iface({ name: "docker0", address: "172.17.0.1" }),
      iface({ name: "utun3", address: "10.8.0.2" }),
      iface({ name: "veth123", address: "172.18.0.5" }),
    ]);
    expect(result).toEqual([]);
  });

  it("excludes .0 network addresses", () => {
    const result = detectLanAddresses(() => [
      iface({ address: "192.168.1.0" }),
    ]);
    expect(result).toEqual([]);
  });

  it("excludes non-IPv4 families", () => {
    const result = detectLanAddresses(() => [
      iface({ family: "IPv6", address: "fe80::1" }),
    ]);
    expect(result).toEqual([]);
  });

  it("returns multiple real candidates", () => {
    const result = detectLanAddresses(() => [
      iface({ name: "en0", address: "192.168.1.50" }),
      iface({ name: "en1", address: "10.0.0.20" }),
    ]);
    expect(result).toEqual(["192.168.1.50", "10.0.0.20"]);
  });

  it("returns empty when permission is missing", () => {
    const result = detectLanAddresses(() => {
      throw new Deno.errors.NotCapable("--allow-sys not granted");
    });
    expect(result).toEqual([]);
  });

  it("rethrows unexpected errors", () => {
    expect(() =>
      detectLanAddresses(() => {
        throw new Error("boom");
      })
    ).toThrow("boom");
  });
});

describe("detectLanSubnets", () => {
  function iface(
    overrides: Partial<Deno.NetworkInterfaceInfo>,
  ): Deno.NetworkInterfaceInfo {
    return {
      name: "en0",
      address: "192.168.1.50",
      netmask: "255.255.255.0",
      family: "IPv4",
      mac: "aa:bb:cc:dd:ee:ff",
      scopeid: null,
      cidr: "192.168.1.50/24",
      ...overrides,
    };
  }

  it("reduces addresses to unique /24 prefixes", () => {
    const result = detectLanSubnets(() => [
      iface({ name: "en0", address: "192.168.1.50" }),
      iface({ name: "en0", address: "192.168.1.51" }),
      iface({ name: "en1", address: "10.0.0.20" }),
    ]);
    expect(result).toEqual(["192.168.1", "10.0.0"]);
  });

  it("returns empty when permission is missing", () => {
    const result = detectLanSubnets(() => {
      throw new Deno.errors.NotCapable("--allow-sys not granted");
    });
    expect(result).toEqual([]);
  });
});
