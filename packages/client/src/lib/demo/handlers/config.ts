import type { QueryHandler } from "./types.ts";
import {
  batteryConfigDef,
  chargingConfigDef,
  deserializeSection,
  equipmentConfigDef,
  homeConfigDef,
  notificationConfigDef,
  solarConfigDef,
  systemConfigDef,
} from "@chargeha/shared/configSections";
import { geocodeAddress, geocodeAutocomplete } from "@chargeha/shared/geocode";

export const configHandlers: Record<string, QueryHandler> = {
  // Section reads reuse the real deserializer over the demo's raw config map.
  "config.charging.get": (_i, s) =>
    deserializeSection(chargingConfigDef, s.config),
  "config.solar.get": (_i, s) => deserializeSection(solarConfigDef, s.config),
  "config.battery.get": (_i, s) =>
    deserializeSection(batteryConfigDef, s.config),
  "config.home.get": (_i, s) => deserializeSection(homeConfigDef, s.config),
  "config.equipment.get": (_i, s) =>
    deserializeSection(equipmentConfigDef, s.config),
  "config.system.get": (_i, s) => deserializeSection(systemConfigDef, s.config),
  "config.notification.get": (_i, s) =>
    deserializeSection(notificationConfigDef, s.config),

  "config.systemAlert": (_i, s) => s.config.systemAlert ?? "",

  // Real geocoding — Photon allows CORS, so it runs in the browser.
  "config.geocode": (input) => geocodeAddress((input as { q: string }).q),
  "config.geocodeAutocomplete": (input) =>
    geocodeAutocomplete((input as { q: string }).q),
};
