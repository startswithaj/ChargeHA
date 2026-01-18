import type { Logger } from "../lib/Logger.ts";

export class GeocodeError extends Error {
  constructor(
    message: string,
    public code: "NOT_FOUND" | "BAD_GATEWAY",
  ) {
    super(message);
    this.name = "GeocodeError";
  }
}

interface PhotonProperties {
  name?: string;
  locality?: string;
  district?: string;
  city?: string;
  state?: string;
  country?: string;
}

interface PhotonFeature {
  properties: PhotonProperties;
  geometry: { coordinates: [number, number] };
}

interface PhotonResponse {
  features?: PhotonFeature[];
}

interface AutocompleteResult {
  lat: string;
  lon: string;
  display_name: string;
}

export class GeocodeService {
  constructor(private logger: Logger) {}

  /** Geocode an address using Photon (OSM). */
  async geocodeAddress(
    query: string,
  ): Promise<{ latitude: number; longitude: number; displayName: string }> {
    const res = await fetch(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) {
      throw new GeocodeError("Geocoding service unavailable", "BAD_GATEWAY");
    }
    const data = (await res.json()) as PhotonResponse;
    const features = data.features;
    if (!features?.length) {
      throw new GeocodeError(
        "No results found for that address",
        "NOT_FOUND",
      );
    }
    const f = features[0];
    const p = f.properties;
    const displayName = [
      p.name,
      p.locality,
      p.district,
      p.city,
      p.state,
      p.country,
    ]
      .filter(Boolean)
      .join(", ");
    return {
      latitude: f.geometry.coordinates[1],
      longitude: f.geometry.coordinates[0],
      displayName,
    };
  }

  /** Address autocomplete using Photon (OSM). */
  async geocodeAutocomplete(query: string): Promise<AutocompleteResult[]> {
    if (!query || query.length < 3) {
      return [];
    }

    try {
      const res = await fetch(
        `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5`,
        { signal: AbortSignal.timeout(3000) },
      );
      if (!res.ok) return [];
      const data = (await res.json()) as PhotonResponse;
      return (data.features ?? []).map((f) => {
        const p = f.properties;
        const displayName = [
          p.name,
          p.locality,
          p.district,
          p.city,
          p.state,
          p.country,
        ]
          .filter(Boolean)
          .join(", ");
        return {
          lat: String(f.geometry.coordinates[1]),
          lon: String(f.geometry.coordinates[0]),
          display_name: displayName,
        };
      });
    } catch {
      return [];
    }
  }
}
