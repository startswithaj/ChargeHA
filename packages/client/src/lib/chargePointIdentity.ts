import { chargerPluginOptions } from "@chargeha/plugins/componentRegistry";

/** `chargerConfig` is a JSON string of the row's non-secret plugin config. It
 *  is user-influenced, so a malformed value must degrade to "no id shown"
 *  rather than break the page. Empty is absent — never an empty-string
 *  sentinel. */
export function readChargerConfigValue(
  json: string,
  key: string,
): string | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) return null;
    const value = (parsed as Record<string, unknown>)[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** The charge point's own id, read through the plugin's advertised config key
 *  so core code never names a plugin's config key itself. */
export function chargePointIdentifier(
  charger: { chargerAdapterType: string; chargerConfig: string },
): string | null {
  const key = chargerPluginOptions.find((o) =>
    o.id === charger.chargerAdapterType
  )?.identityConfigKey;
  if (key === undefined) return null;
  return readChargerConfigValue(charger.chargerConfig, key);
}
