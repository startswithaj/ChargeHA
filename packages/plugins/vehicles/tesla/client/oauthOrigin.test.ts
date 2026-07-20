import { describe, expect, it } from "vitest";
import {
  callbackUrl,
  canTeslaFetchKeyFrom,
  isStableOrigin,
  resolveOAuthOrigin,
} from "./oauthOrigin.ts";

describe("isStableOrigin", () => {
  it("accepts localhost on any port and protocol", () => {
    expect(isStableOrigin("http://localhost:8007")).toBe(true);
    expect(isStableOrigin("http://127.0.0.1:8000")).toBe(true);
    expect(isStableOrigin("https://localhost")).toBe(true);
  });

  it("accepts any https origin", () => {
    expect(isStableOrigin("https://chargeha.example.com")).toBe(true);
    expect(isStableOrigin("https://192.168.1.50:8000")).toBe(true);
  });

  it("rejects plain http on non-localhost hosts", () => {
    expect(isStableOrigin("http://192.168.1.50:8000")).toBe(false);
    expect(isStableOrigin("http://chargeha.example.com")).toBe(false);
  });

  it("rejects garbage", () => {
    expect(isStableOrigin("")).toBe(false);
    expect(isStableOrigin("not-a-url")).toBe(false);
  });
});

describe("resolveOAuthOrigin", () => {
  const TUNNEL = "https://abc.trycloudflare.com";

  it("prefers a stable browser origin even when a tunnel is running", () => {
    expect(resolveOAuthOrigin("http://localhost:8007", TUNNEL)).toEqual({
      origin: "http://localhost:8007",
      viaTunnel: false,
    });
    expect(resolveOAuthOrigin("https://chargeha.example.com", TUNNEL)).toEqual({
      origin: "https://chargeha.example.com",
      viaTunnel: false,
    });
  });

  it("falls back to the tunnel for unstable origins", () => {
    expect(resolveOAuthOrigin("http://192.168.1.50:8000", TUNNEL)).toEqual({
      origin: TUNNEL,
      viaTunnel: true,
    });
  });

  it("returns null origin when unstable and no tunnel is running", () => {
    expect(resolveOAuthOrigin("http://192.168.1.50:8000", null)).toEqual({
      origin: null,
      viaTunnel: true,
    });
  });
});

describe("canTeslaFetchKeyFrom", () => {
  it("accepts public https origins", () => {
    expect(canTeslaFetchKeyFrom("https://chargeha.example.com")).toBe(true);
    expect(canTeslaFetchKeyFrom("https://example.github.io")).toBe(true);
  });

  it("rejects http origins — the key URL is always https", () => {
    expect(canTeslaFetchKeyFrom("http://chargeha.example.com")).toBe(false);
  });

  it("rejects loopback and private-LAN hosts", () => {
    expect(canTeslaFetchKeyFrom("https://localhost:8007")).toBe(false);
    expect(canTeslaFetchKeyFrom("https://127.0.0.1")).toBe(false);
    expect(canTeslaFetchKeyFrom("https://192.168.1.50:8000")).toBe(false);
    expect(canTeslaFetchKeyFrom("https://10.1.2.3")).toBe(false);
    expect(canTeslaFetchKeyFrom("https://172.20.0.5")).toBe(false);
  });

  it("rejects garbage", () => {
    expect(canTeslaFetchKeyFrom("")).toBe(false);
  });
});

describe("callbackUrl", () => {
  it("appends the callback path", () => {
    expect(callbackUrl("http://localhost:8007")).toBe(
      "http://localhost:8007/api/vehicle/tesla/callback",
    );
  });
});
