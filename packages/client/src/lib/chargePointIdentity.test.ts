import { describe, expect, it, vi } from "vitest";
import {
  chargePointIdentifier,
  readChargerConfigValue,
} from "./chargePointIdentity.ts";

// Mocked so these cases describe the contract — an adapter that advertises an
// identity key and one that does not — rather than whichever plugins happen to
// be registered.
vi.mock("@chargeha/plugins/componentRegistry", () => ({
  chargerPluginOptions: [
    { id: "ocpp", label: "OCPP Charger", identityConfigKey: "charger_id" },
    { id: "tapo", label: "Tapo Smart Plug" },
  ],
}));

describe("chargePointIdentity", () => {
  describe("readChargerConfigValue", () => {
    it("reads a configured value", () => {
      expect(
        readChargerConfigValue('{"charger_id":"vcp-dev-2"}', "charger_id"),
      ).toBe("vcp-dev-2");
    });

    it("returns null for a missing key, empty value, or bad JSON", () => {
      expect(readChargerConfigValue("{}", "charger_id")).toBeNull();
      expect(readChargerConfigValue('{"charger_id":""}', "charger_id"))
        .toBeNull();
      expect(readChargerConfigValue("not json", "charger_id")).toBeNull();
      expect(readChargerConfigValue("null", "charger_id")).toBeNull();
    });
  });

  describe("chargePointIdentifier", () => {
    it("reads the id through the adapter's advertised config key", () => {
      expect(chargePointIdentifier({
        chargerAdapterType: "ocpp",
        chargerConfig: '{"charger_id":"vcp-dev-2"}',
      })).toBe("vcp-dev-2");
    });

    it("returns null for an adapter with no identity of its own", () => {
      expect(chargePointIdentifier({
        chargerAdapterType: "tapo",
        chargerConfig: '{"charger_id":"vcp-dev-2"}',
      })).toBeNull();
    });

    it("returns null when the key is absent from the row's config", () => {
      expect(chargePointIdentifier({
        chargerAdapterType: "ocpp",
        chargerConfig: "{}",
      })).toBeNull();
    });

    it("returns null for an unknown adapter type", () => {
      expect(chargePointIdentifier({
        chargerAdapterType: "nope",
        chargerConfig: '{"charger_id":"vcp-dev-2"}',
      })).toBeNull();
    });
  });
});
