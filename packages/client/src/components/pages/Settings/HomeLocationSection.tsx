import { useCallback, useMemo } from "react";
import { Car, ExternalLink, MapPin, Trash2 } from "lucide-react";
import { Button, Text } from "@radix-ui/themes";
import { useMutation } from "@tanstack/react-query";
import type { VehicleWithState } from "@chargeha/shared";
import type { HomeConfig } from "@chargeha/shared/configSections";
import {
  type PhotonResult,
  useAddressAutocomplete,
} from "../../../hooks/useAddressAutocomplete.ts";
import { useLocationFetcher } from "../../../hooks/useLocationFetcher.ts";
import { StaticMap } from "../../StaticMap/StaticMap.tsx";
import { trpc } from "../../../trpc.ts";
import { useHomeConfigMutation } from "../../../hooks/useSectionConfig.ts";
import { SettingsSection } from "./SettingsLayout.tsx";
import { AddressSearchInput } from "./AddressSearchInput.tsx";

// ── Home Location Section ──

function useGeocodeMutation(
  { utils, ac, geo, mutation }: {
    utils: ReturnType<typeof trpc.useUtils>;
    ac: ReturnType<typeof useAddressAutocomplete>;
    geo: ReturnType<typeof useLocationFetcher>;
    mutation: ReturnType<typeof useHomeConfigMutation>;
  },
) {
  return useMutation({
    mutationFn: (query: string) =>
      utils.client.config.geocode.query({ q: query }),
    onMutate: () => {
      geo.setGeoStatus("loading");
      geo.setGeoError("");
      geo.setGeoLoadingMsg("");
      ac.clear();
    },
    onSuccess: (result) => {
      mutation.mutate({
        homeLatitude: parseFloat(result.latitude.toFixed(6)),
        homeLongitude: parseFloat(result.longitude.toFixed(6)),
      });
      ac.setQuery(result.displayName);
      geo.setGeoStatus("idle");
    },
    onError: (err) => {
      geo.setGeoError(err instanceof Error ? err.message : "Geocoding failed");
      geo.setGeoStatus("error");
    },
  });
}

function PrimaryActions(
  { vehicles, geo, applyCoords }: {
    vehicles: VehicleWithState[];
    geo: ReturnType<typeof useLocationFetcher>;
    applyCoords: (lat: string, lng: string) => void;
  },
) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      <Button
        size="2"
        variant="soft"
        disabled={geo.geoStatus === "loading"}
        onClick={() => geo.handleBrowserLocation(applyCoords)}
      >
        <MapPin size={14} /> Use my current location
      </Button>
      {vehicles.map((v) => (
        <Button
          key={v.id}
          size="2"
          variant="outline"
          disabled={geo.geoStatus === "loading"}
          onClick={() => geo.handleVehicleLocation(v.id, applyCoords)}
        >
          <Car size={14} /> Use {v.name} GPS
        </Button>
      ))}
    </div>
  );
}

function CoordsDisplay(
  { lat, lng, mutation, ac }: {
    lat: number;
    lng: number;
    mutation: ReturnType<typeof useHomeConfigMutation>;
    ac: ReturnType<typeof useAddressAutocomplete>;
  },
) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <a
        href={`https://www.google.com/maps?q=${lat},${lng}`}
        target="_blank"
        rel="noreferrer"
        style={{
          color: "var(--accent-11)",
          textDecoration: "none",
          fontSize: 13,
        }}
      >
        {lat.toFixed(6)}, {lng.toFixed(6)}
        <ExternalLink
          size={11}
          style={{ marginLeft: 4, verticalAlign: "middle" }}
        />
      </a>
      <Button
        size="1"
        variant="ghost"
        color="red"
        onClick={() => {
          mutation.mutate({ homeLatitude: null, homeLongitude: null });
          ac.setQuery("");
        }}
      >
        <Trash2 size={12} /> Clear
      </Button>
    </div>
  );
}

export function HomeLocationSection({
  homeConfig,
}: {
  homeConfig: HomeConfig | null;
}) {
  const mutation = useHomeConfigMutation();

  // Fetch vehicles independently for GPS buttons
  const { data: vehiclesData } = trpc.vehicle.list.useQuery();
  const vehicles = useMemo(
    () => (vehiclesData?.vehicles ?? []) as VehicleWithState[],
    [vehiclesData],
  );

  const hasCoords = !!(homeConfig?.homeLatitude && homeConfig?.homeLongitude);
  const lat = homeConfig?.homeLatitude ?? 0;
  const lng = homeConfig?.homeLongitude ?? 0;
  const ac = useAddressAutocomplete();
  const geo = useLocationFetcher();

  const applyCoords = useCallback(
    (latStr: string, lngStr: string) => {
      mutation.mutate({
        homeLatitude: parseFloat(latStr),
        homeLongitude: parseFloat(lngStr),
      });
      ac.setQuery("");
    },
    [mutation, ac],
  );

  const selectSuggestion = useCallback(
    (s: PhotonResult) => {
      mutation.mutate({
        homeLatitude: parseFloat(parseFloat(s.lat).toFixed(6)),
        homeLongitude: parseFloat(parseFloat(s.lon).toFixed(6)),
      });
      ac.setQuery(s.display_name);
      ac.clear();
    },
    [mutation, ac],
  );

  const utils = trpc.useUtils();
  const geocodeMutation = useGeocodeMutation({ utils, ac, geo, mutation });

  const handleGeocode = () => {
    if (!ac.query.trim()) return;
    geocodeMutation.mutate(ac.query.trim());
  };

  return (
    <SettingsSection
      icon={<MapPin size={18} />}
      title="Home Location"
      description="Set your home location so ChargeHA knows when your vehicle is home and can manage charging automatically."
      saveStatus={mutation.saveStatus}
    >
      {hasCoords && (
        <div style={{ borderRadius: 8, overflow: "hidden", marginBottom: 4 }}>
          <StaticMap latitude={lat} longitude={lng} />
        </div>
      )}

      <PrimaryActions
        vehicles={vehicles}
        geo={geo}
        applyCoords={applyCoords}
      />

      {/* Address search with autocomplete */}
      <AddressSearchInput
        ac={ac}
        disabled={geo.geoStatus === "loading"}
        onSelect={selectSuggestion}
        onLookup={handleGeocode}
      />

      {geo.geoStatus === "loading" && geo.geoLoadingMsg && (
        <Text size="2" color="gray">{geo.geoLoadingMsg}</Text>
      )}

      {geo.geoStatus === "error" && (
        <Text size="2" color="red">{geo.geoError}</Text>
      )}

      {hasCoords && (
        <CoordsDisplay lat={lat} lng={lng} mutation={mutation} ac={ac} />
      )}

      {!hasCoords && (
        <Text size="1" color="orange">
          No location set. Use your current location, vehicle GPS, or search for
          an address.
        </Text>
      )}
    </SettingsSection>
  );
}
