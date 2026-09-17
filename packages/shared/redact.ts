const VIN_RE = /\b[A-HJ-NPR-Z0-9]{17}\b/g;
const LOCATION_KEYS = new Set([
  "latitude",
  "longitude",
  "native_latitude",
  "native_longitude",
  "heading",
]);

// Last 6 chars of a VIN is the serial — enough to tell cars apart, useless to a stranger.
export function shortId(id: string): string {
  return id.replace(VIN_RE, (vin) => `…${vin.slice(-6)}`);
}

export function redactForStdout(value: unknown): unknown {
  if (typeof value === "string") return shortId(value);
  if (Array.isArray(value)) return value.map(redactForStdout);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) =>
        LOCATION_KEYS.has(k) ? [k, "[redacted]"] : [k, redactForStdout(v)]
      ),
    );
  }
  return value;
}
