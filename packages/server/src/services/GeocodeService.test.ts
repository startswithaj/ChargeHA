import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { GeocodeError, GeocodeService } from "./GeocodeService.ts";
import type { Logger } from "../lib/Logger.ts";
import { throwingMock } from "../test-helpers/throwingMock.ts";

describe("GeocodeService", () => {
  const mockLogger = throwingMock<Logger>("Logger", {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  });

  const mockFetchJson = (body: unknown, status = 200) => {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(typeof body === "string" ? body : JSON.stringify(body), {
          status,
        }),
      );
  };

  let service: GeocodeService;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    service = new GeocodeService(mockLogger);
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("geocodeAddress", () => {
    it("returns geocoded result for a valid address", async () => {
      mockFetchJson({
        features: [
          {
            geometry: { coordinates: [151.2093, -33.8688] },
            properties: {
              name: "Sydney Opera House",
              city: "Sydney",
              state: "New South Wales",
              country: "Australia",
            },
          },
        ],
      });

      const result = await service.geocodeAddress("Sydney Opera House");
      expect(result.latitude).toBe(-33.8688);
      expect(result.longitude).toBe(151.2093);
      expect(result.displayName).toBe(
        "Sydney Opera House, Sydney, New South Wales, Australia",
      );
    });

    it("throws GeocodeError with NOT_FOUND when no results found", async () => {
      mockFetchJson({ features: [] });

      const err = await service.geocodeAddress("nonexistent").then(
        () => null,
        (e) => e,
      );
      expect(err).toBeInstanceOf(GeocodeError);
      expect((err as GeocodeError).code).toBe("NOT_FOUND");
      expect((err as GeocodeError).message).toBe(
        "No results found for that address",
      );
    });

    it("throws GeocodeError with BAD_GATEWAY when service is unavailable", async () => {
      mockFetchJson("error", 502);

      const err = await service.geocodeAddress("test").then(
        () => null,
        (e) => e,
      );
      expect(err).toBeInstanceOf(GeocodeError);
      expect((err as GeocodeError).code).toBe("BAD_GATEWAY");
      expect((err as GeocodeError).message).toBe(
        "Geocoding service unavailable",
      );
    });

    it("filters out null/undefined properties from displayName", async () => {
      mockFetchJson({
        features: [
          {
            geometry: { coordinates: [0, 0] },
            properties: {
              name: "Place",
              locality: null,
              district: undefined,
              city: "City",
              state: null,
              country: "Country",
            },
          },
        ],
      });

      const result = await service.geocodeAddress("test");
      expect(result.displayName).toBe("Place, City, Country");
    });
  });

  describe("geocodeAutocomplete", () => {
    it("returns empty array for short queries", async () => {
      const result = await service.geocodeAutocomplete("ab");
      expect(result).toEqual([]);
    });

    it("returns empty array for empty query", async () => {
      const result = await service.geocodeAutocomplete("");
      expect(result).toEqual([]);
    });

    it("returns autocomplete suggestions", async () => {
      mockFetchJson({
        features: [
          {
            geometry: { coordinates: [151.2093, -33.8688] },
            properties: {
              name: "Sydney",
              city: "Sydney",
              country: "Australia",
            },
          },
          {
            geometry: { coordinates: [153.0281, -27.4679] },
            properties: {
              name: "Brisbane",
              city: "Brisbane",
              country: "Australia",
            },
          },
        ],
      });

      const result = await service.geocodeAutocomplete("Syd");
      expect(result).toHaveLength(2);
      expect(result[0].lat).toBe("-33.8688");
      expect(result[0].lon).toBe("151.2093");
      expect(result[0].display_name).toBe("Sydney, Sydney, Australia");
    });

    it("returns empty array when fetch fails", async () => {
      globalThis.fetch = () => Promise.reject(new Error("Network error"));

      const result = await service.geocodeAutocomplete("test query");
      expect(result).toEqual([]);
    });

    it("returns empty array when response is not ok", async () => {
      mockFetchJson("error", 500);

      const result = await service.geocodeAutocomplete("test query");
      expect(result).toEqual([]);
    });

    it("returns empty array when response has no features property", async () => {
      mockFetchJson({});

      const result = await service.geocodeAutocomplete("test query");
      expect(result).toEqual([]);
    });
  });
});
