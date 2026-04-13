import { useState } from "react";
import { trpc } from "../trpc.ts";

type GeoStatus = "idle" | "loading" | "error";

interface LocationFetcherResult {
  geoStatus: GeoStatus;
  geoError: string;
  geoLoadingMsg: string;
  setGeoStatus: (status: GeoStatus) => void;
  setGeoError: (msg: string) => void;
  setGeoLoadingMsg: (msg: string) => void;
  handleBrowserLocation: (onCoords: (lat: string, lng: string) => void) => void;
  handleVehicleLocation: (
    vin: string,
    onCoords: (lat: string, lng: string) => void,
  ) => void;
}

export function useLocationFetcher(): LocationFetcherResult {
  const [geoStatus, setGeoStatus] = useState<GeoStatus>("idle");
  const [geoError, setGeoError] = useState("");
  const [geoLoadingMsg, setGeoLoadingMsg] = useState("");

  // refreshState wakes the vehicle if needed and returns its latest state
  // including latitude/longitude. Used here to pull the vehicle's current GPS
  // so the user can set home location from their parked car.
  const refreshStateMutation = trpc.vehicle.refreshState.useMutation();

  const handleVehicleLocation = (
    vin: string,
    onCoords: (lat: string, lng: string) => void,
  ) => {
    setGeoStatus("loading");
    setGeoError("");
    setGeoLoadingMsg("Fetching vehicle location...");

    const wakeTimer = setTimeout(() => {
      setGeoLoadingMsg(
        "Vehicle is asleep — waking it up, this can take up to 30 seconds...",
      );
    }, 3000);

    void (async () => {
      try {
        const result = await refreshStateMutation.mutateAsync({
          vehicleId: vin,
        });
        const state = result.state;
        if (!state || state.latitude == null || state.longitude == null) {
          setGeoError("Vehicle location unavailable");
          setGeoStatus("error");
          return;
        }
        onCoords(state.latitude.toFixed(6), state.longitude.toFixed(6));
        setGeoStatus("idle");
      } catch (err) {
        setGeoError(
          err instanceof Error ? err.message : "Failed to get vehicle location",
        );
        setGeoStatus("error");
      } finally {
        clearTimeout(wakeTimer);
        setGeoLoadingMsg("");
      }
    })();
  };

  const handleBrowserLocation = (
    onCoords: (lat: string, lng: string) => void,
  ) => {
    if (!navigator.geolocation) {
      setGeoError("Your browser does not support geolocation");
      setGeoStatus("error");
      return;
    }
    setGeoStatus("loading");
    setGeoError("");
    setGeoLoadingMsg("Getting your location...");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onCoords(
          pos.coords.latitude.toFixed(6),
          pos.coords.longitude.toFixed(6),
        );
        setGeoStatus("idle");
        setGeoLoadingMsg("");
      },
      (err) => {
        const messages: Record<number, string> = {
          1: "Location permission denied. Allow location access in your browser settings and try again.",
          2: "Could not determine your location. Make sure location services are enabled on your device.",
          3: "Location request timed out. Try again.",
        };
        setGeoError(messages[err.code] ?? "Failed to get location");
        setGeoStatus("error");
        setGeoLoadingMsg("");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return {
    geoStatus,
    geoError,
    geoLoadingMsg,
    setGeoStatus,
    setGeoError,
    setGeoLoadingMsg,
    handleBrowserLocation,
    handleVehicleLocation,
  };
}
