/** Haversine distance in metres between two lat/lng points. */
export function haversineMetres(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const HOME_RADIUS_METRES = 200;

/** Parse home coordinate config strings into a { lat, lng } object.
 *  Returns null if either value is missing or fails to parse as a number. */
export function parseHomeCoords(
  lat: string | null,
  lng: string | null,
): { lat: number; lng: number } | null {
  if (!lat || !lng) return null;
  const parsedLat = parseFloat(lat);
  const parsedLng = parseFloat(lng);
  if (isNaN(parsedLat) || isNaN(parsedLng)) return null;
  return { lat: parsedLat, lng: parsedLng };
}

/** Whether a location is within the home radius. Returns null if either
 *  home or vehicle location is unavailable. A latitude or longitude of 0
 *  (equator or prime meridian) is a valid fix, not "missing". */
export function isHome(
  home: { lat: number; lng: number } | null,
  location: { latitude: number | null; longitude: number | null } | null,
): boolean | null {
  if (
    !home || location == null ||
    location.latitude == null || location.longitude == null
  ) {
    return null;
  }
  return haversineMetres(
    home.lat,
    home.lng,
    location.latitude,
    location.longitude,
  ) <=
    HOME_RADIUS_METRES;
}
