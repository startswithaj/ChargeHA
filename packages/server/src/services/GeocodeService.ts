import type { Logger } from "../lib/Logger.ts";
import {
  type AutocompleteResult,
  geocodeAddress,
  geocodeAutocomplete,
  GeocodeError,
  type GeocodeResult,
} from "@chargeha/shared/geocode";

export { GeocodeError };

export class GeocodeService {
  constructor(private logger: Logger) {}

  /** Geocode an address using Photon (OSM). */
  geocodeAddress(query: string): Promise<GeocodeResult> {
    this.logger.debug(`Geocoding address: ${query}`);
    return geocodeAddress(query);
  }

  /** Address autocomplete using Photon (OSM). */
  geocodeAutocomplete(query: string): Promise<AutocompleteResult[]> {
    return geocodeAutocomplete(query);
  }
}
