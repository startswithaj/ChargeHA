import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  haversineMetres,
  HOME_RADIUS_METRES,
  isHome,
  parseHomeCoords,
} from "./geo.ts";

describe("haversineMetres", () => {
  it("returns 0 for identical points", () => {
    const d = haversineMetres(-33.8688, 151.2093, -33.8688, 151.2093);
    expect(d).toBe(0);
  });

  it("calculates correct distance between Sydney Opera House and Harbour Bridge", () => {
    // ~1.1 km apart
    const d = haversineMetres(-33.8568, 151.2153, -33.8523, 151.2108);
    expect(d).toBeGreaterThan(500);
    expect(d).toBeLessThan(2000);
  });

  it("calculates correct distance between New York and Los Angeles", () => {
    // ~3,940 km apart
    const d = haversineMetres(40.7128, -74.006, 34.0522, -118.2437);
    expect(d).toBeGreaterThan(3_900_000);
    expect(d).toBeLessThan(4_000_000);
  });

  it("calculates correct distance between equator points", () => {
    // 1 degree of longitude at equator ≈ 111.32 km
    const d = haversineMetres(0, 0, 0, 1);
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(112_000);
  });

  it("is symmetric", () => {
    const d1 = haversineMetres(-33.8688, 151.2093, 40.7128, -74.006);
    const d2 = haversineMetres(40.7128, -74.006, -33.8688, 151.2093);
    expect(Math.abs(d1 - d2)).toBeLessThan(0.01);
  });
});

describe("HOME_RADIUS_METRES", () => {
  it("is 200 metres", () => {
    expect(HOME_RADIUS_METRES).toBe(200);
  });
});

describe("parseHomeCoords", () => {
  it("parses valid lat/lng strings", () => {
    expect(parseHomeCoords("-33.8688", "151.2093")).toEqual({
      lat: -33.8688,
      lng: 151.2093,
    });
  });

  it("parses 0 as a valid coordinate", () => {
    expect(parseHomeCoords("0", "0")).toEqual({ lat: 0, lng: 0 });
  });

  it("returns null if lat is null", () => {
    expect(parseHomeCoords(null, "151.2093")).toBeNull();
  });

  it("returns null if lng is null", () => {
    expect(parseHomeCoords("-33.8688", null)).toBeNull();
  });

  it("returns null if either value is empty string", () => {
    expect(parseHomeCoords("", "151.2")).toBeNull();
    expect(parseHomeCoords("-33.8", "")).toBeNull();
  });

  it("returns null if either value fails to parse", () => {
    expect(parseHomeCoords("not-a-number", "151.2")).toBeNull();
    expect(parseHomeCoords("-33.8", "nope")).toBeNull();
  });
});

describe("isHome", () => {
  const home = { lat: -33.8688, lng: 151.2093 };

  it("returns true when location is within home radius", () => {
    expect(isHome(home, { latitude: -33.8688, longitude: 151.2093 })).toBe(
      true,
    );
  });

  it("returns false when location is far from home", () => {
    expect(isHome(home, { latitude: 40.7128, longitude: -74.006 })).toBe(false);
  });

  it("treats lat/lng of 0 as a valid fix, not missing", () => {
    const equatorHome = { lat: 0, lng: 0 };
    expect(isHome(equatorHome, { latitude: 0, longitude: 0 })).toBe(true);
  });

  it("returns null when home is null", () => {
    expect(isHome(null, { latitude: -33.8688, longitude: 151.2093 }))
      .toBeNull();
  });

  it("returns null when location is null", () => {
    expect(isHome(home, null)).toBeNull();
  });

  it("returns null when latitude is missing", () => {
    expect(isHome(home, { latitude: null, longitude: 151.2093 })).toBeNull();
  });

  it("returns null when longitude is missing", () => {
    expect(isHome(home, { latitude: -33.8688, longitude: null })).toBeNull();
  });

  it("returns true just inside the 200m radius", () => {
    // ~0.001 deg lat ≈ 111m
    expect(isHome(home, { latitude: -33.8688 + 0.001, longitude: 151.2093 }))
      .toBe(true);
  });

  it("returns false just outside the 200m radius", () => {
    // ~0.003 deg lat ≈ 333m
    expect(isHome(home, { latitude: -33.8688 + 0.003, longitude: 151.2093 }))
      .toBe(false);
  });
});
