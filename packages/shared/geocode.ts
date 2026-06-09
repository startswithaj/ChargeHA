// Browser-safe address geocoding via Photon (OSM). Photon sends
// `Access-Control-Allow-Origin: *`, so this runs in the server and directly in
// the browser (demo mode) — one implementation, no duplication.

export class GeocodeError extends Error {
  constructor(
    message: string,
    public code: "NOT_FOUND" | "BAD_GATEWAY",
  ) {
    super(message);
    this.name = "GeocodeError";
  }
}

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  displayName: string;
}

export interface AutocompleteResult {
  lat: string;
  lon: string;
  display_name: string;
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

const PHOTON_URL = "https://photon.komoot.io/api/";

const displayNameOf = (p: PhotonProperties): string =>
  [p.name, p.locality, p.district, p.city, p.state, p.country]
    .filter(Boolean)
    .join(", ");

/** Geocode a free-text address to coordinates. */
export async function geocodeAddress(query: string): Promise<GeocodeResult> {
  const res = await fetch(
    `${PHOTON_URL}?q=${encodeURIComponent(query)}&limit=1`,
    { signal: AbortSignal.timeout(5000) },
  );
  if (!res.ok) {
    throw new GeocodeError("Geocoding service unavailable", "BAD_GATEWAY");
  }
  const data = (await res.json()) as PhotonResponse;
  const feature = data.features?.[0];
  if (!feature) {
    throw new GeocodeError("No results found for that address", "NOT_FOUND");
  }
  return {
    latitude: feature.geometry.coordinates[1],
    longitude: feature.geometry.coordinates[0],
    displayName: displayNameOf(feature.properties),
  };
}

/** Address autocomplete suggestions. Returns [] for short queries or errors. */
export async function geocodeAutocomplete(
  query: string,
): Promise<AutocompleteResult[]> {
  if (!query || query.length < 3) return [];
  try {
    const res = await fetch(
      `${PHOTON_URL}?q=${encodeURIComponent(query)}&limit=5`,
      { signal: AbortSignal.timeout(3000) },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as PhotonResponse;
    return (data.features ?? []).map((f) => ({
      lat: String(f.geometry.coordinates[1]),
      lon: String(f.geometry.coordinates[0]),
      display_name: displayNameOf(f.properties),
    }));
  } catch {
    return [];
  }
}
