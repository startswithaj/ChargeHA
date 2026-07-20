// Envoy /info helpers — unauthenticated XML carrying the gateway serial and part number.

export const INFO_PATH = "/info";

/** Extract the first XML tag value, e.g. tagValue(xml, "sn"). */
export function tagValue(xml: string, tag: string): string {
  return xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1] ?? "";
}

/** Fingerprint check: only an Envoy answers `/info` with an `<envoy_info>`
 *  document carrying a serial. */
export function isEnvoyInfo(xml: string): boolean {
  return xml.includes("<envoy_info") && tagValue(xml, "sn") !== "";
}
