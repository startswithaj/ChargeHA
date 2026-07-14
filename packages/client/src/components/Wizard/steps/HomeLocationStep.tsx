import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Callout, Text } from "@radix-ui/themes";
import { Car, CheckCircle, MapPin } from "lucide-react";
import type { VehicleWithState } from "@chargeha/shared";
import { StaticMap } from "../../StaticMap/StaticMap.tsx";
import {
  useHomeConfig,
  useHomeConfigMutation,
} from "../../../hooks/useSectionConfig.ts";
import { useLocationFetcher } from "../../../hooks/useLocationFetcher.ts";
import { trpc } from "../../../trpc.ts";
import { AddressSearch } from "./HomeLocationParts.tsx";
import type { StepProps } from "../WizardShell.tsx";
import { useWizardNextControl } from "../wizardNextControl.ts";
import styles from "./steps.module.css";

function QuickActions(
  { vehicles, geo, setCoords }: {
    vehicles: VehicleWithState[];
    geo: ReturnType<typeof useLocationFetcher>;
    setCoords: (lat: string, lng: string) => void;
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
        onClick={() => geo.handleBrowserLocation(setCoords)}
      >
        <MapPin size={14} /> Use my current location
      </Button>
      {vehicles.map((v) => (
        <Button
          key={v.id}
          size="2"
          variant="outline"
          disabled={geo.geoStatus === "loading"}
          onClick={() => geo.handleVehicleLocation(v.id, setCoords)}
        >
          <Car size={14} /> Use {v.name} GPS
        </Button>
      ))}
    </div>
  );
}

function StatusMessages(
  { geo, hasCoords, latNum, lngNum }: {
    geo: ReturnType<typeof useLocationFetcher>;
    hasCoords: boolean;
    latNum: number;
    lngNum: number;
  },
) {
  return (
    <>
      {geo.geoStatus === "loading" && geo.geoLoadingMsg && (
        <Text size="2" color="gray">{geo.geoLoadingMsg}</Text>
      )}
      {geo.geoStatus === "error" && (
        <Text size="2" color="red">{geo.geoError}</Text>
      )}
      {hasCoords && (
        <Callout.Root color="green" size="1">
          <Callout.Icon>
            <CheckCircle size={16} />
          </Callout.Icon>
          <Callout.Text>
            Location set: {latNum.toFixed(6)}, {lngNum.toFixed(6)}
          </Callout.Text>
        </Callout.Root>
      )}
      {!hasCoords && (
        <Text size="1" color="orange">
          No location set. Use your current location, vehicle GPS, or search for
          an address.
        </Text>
      )}
    </>
  );
}

export function HomeLocationStep(_props: StepProps) {
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const initializedRef = useRef(false);

  const geo = useLocationFetcher();

  const setCoords = useCallback((newLat: string, newLng: string) => {
    setLat(newLat);
    setLng(newLng);
  }, []);

  const hasCoords = !!(lat && lng);
  const latNum = parseFloat(lat || "0");
  const lngNum = parseFloat(lng || "0");

  // Load existing config via typed hook
  const { data: homeConfig } = useHomeConfig();

  // Load vehicles via tRPC
  const { data: vehiclesData } = trpc.vehicle.list.useQuery();
  const vehicles = useMemo(
    () => (vehiclesData?.vehicles ?? []) as VehicleWithState[],
    [vehiclesData],
  );

  // Initialize coordinates from config once
  useEffect(() => {
    if (initializedRef.current) return;
    if (homeConfig?.homeLatitude) {
      setLat(String(homeConfig.homeLatitude));
      initializedRef.current = true;
    }
    if (homeConfig?.homeLongitude) {
      setLng(String(homeConfig.homeLongitude));
      initializedRef.current = true;
    }
  }, [homeConfig]);

  const saveMutation = useHomeConfigMutation();
  const utils = trpc.useUtils();

  const handleBeforeNext = useCallback(async (): Promise<boolean> => {
    if (!lat || !lng) return false;
    try {
      await saveMutation.mutateAsync({
        homeLatitude: parseFloat(lat),
        homeLongitude: parseFloat(lng),
      });
      // Wait for cache to update before navigating so DoneStep sees fresh data
      await utils.config.home.get.invalidate();
      return true;
    } catch {
      geo.setGeoError("Failed to save location");
      geo.setGeoStatus("error");
      return false;
    }
  }, [lat, lng, saveMutation, utils, geo]);

  useWizardNextControl({
    canProceed: hasCoords,
    hint: hasCoords
      ? "Next saves your home location"
      : "Set your home location to continue",
    pendingLabel: "Saving...",
    onBeforeNext: handleBeforeNext,
  });

  return (
    <div className={styles.stepContainer}>
      <Text size="2" color="gray">
        Set your home location so ChargeHA knows when your vehicle is home and
        can manage charging automatically.
      </Text>

      {/* Map preview */}
      {hasCoords && (
        <div style={{ borderRadius: 8, overflow: "hidden", height: 160 }}>
          <StaticMap
            latitude={latNum}
            longitude={lngNum}
            width={600}
            height={160}
          />
        </div>
      )}

      <QuickActions vehicles={vehicles} geo={geo} setCoords={setCoords} />

      <AddressSearch
        geoStatus={geo.geoStatus}
        onCoordinatesFound={(newLat, newLng) => {
          setLat(newLat);
          setLng(newLng);
        }}
        onGeoStatusChange={geo.setGeoStatus}
        onGeoError={geo.setGeoError}
        onGeoLoadingMsg={geo.setGeoLoadingMsg}
      />

      <StatusMessages
        geo={geo}
        hasCoords={hasCoords}
        latNum={latNum}
        lngNum={lngNum}
      />
    </div>
  );
}
