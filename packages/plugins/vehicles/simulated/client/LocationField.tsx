import { useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Text, TextField } from "@radix-ui/themes";
import { type PhotonResult, useAddressAutocomplete } from "../../../hostUi.ts";
import { trpc } from "./trpc.ts";
import { dialogStyles as styles } from "../../../hostUi.ts";

interface LocationFieldProps {
  lat: string;
  setLat: (v: string) => void;
  lng: string;
  setLng: (v: string) => void;
  setError: (err: string | null) => void;
}

function LatLngInputs(
  { lat, setLat, lng, setLng }: {
    lat: string;
    setLat: (v: string) => void;
    lng: string;
    setLng: (v: string) => void;
  },
) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <TextField.Root
        size="2"
        type="number"
        step="any"
        placeholder="Latitude"
        value={lat}
        onChange={(e: { target: { value: string } }) => setLat(e.target.value)}
        style={{ width: 130 }}
      />
      <TextField.Root
        size="2"
        type="number"
        step="any"
        placeholder="Longitude"
        value={lng}
        onChange={(e: { target: { value: string } }) => setLng(e.target.value)}
        style={{ width: 130 }}
      />
    </div>
  );
}

function SuggestionList(
  { suggestions, onSelect }: {
    suggestions: PhotonResult[];
    onSelect: (s: PhotonResult) => void;
  },
) {
  return (
    <div
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        right: 0,
        marginTop: 4,
        background: "var(--color-background)",
        border: "1px solid var(--gray-a6)",
        borderRadius: 6,
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        zIndex: 50,
        maxHeight: 200,
        overflowY: "auto",
      }}
    >
      {suggestions.map((s, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onSelect(s)}
          style={{
            display: "block",
            width: "100%",
            padding: "8px 12px",
            border: "none",
            background: "transparent",
            textAlign: "left",
            cursor: "pointer",
            fontSize: 13,
            color: "var(--gray-12)",
            borderBottom: i < suggestions.length - 1
              ? "1px solid var(--gray-a3)"
              : "none",
          }}
          onMouseEnter={(e) => {
            // deno-lint-ignore custom-no-param-mutation/no-param-mutation -- DOM event API
            e.currentTarget.style.background = "var(--gray-a3)";
          }}
          onMouseLeave={(e) => {
            // deno-lint-ignore custom-no-param-mutation/no-param-mutation -- DOM event API
            e.currentTarget.style.background = "transparent";
          }}
        >
          {s.display_name}
        </button>
      ))}
    </div>
  );
}

export function LocationField({
  lat,
  setLat,
  lng,
  setLng,
  setError,
}: LocationFieldProps): JSX.Element {
  const ac = useAddressAutocomplete();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();

  const geocodeMutation = useMutation({
    mutationFn: (query: string) =>
      utils.client.plugin.vehicle.simulated.geocode.query({ q: query }),
    onSuccess: (
      result: { latitude: number; longitude: number; displayName: string },
    ) => {
      setLat(result.latitude.toFixed(6));
      setLng(result.longitude.toFixed(6));
      ac.setQuery(result.displayName);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Geocoding failed");
    },
  });

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        wrapperRef.current && !wrapperRef.current.contains(e.target as Node)
      ) {
        ac.setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ac]);

  const selectSuggestion = (s: PhotonResult) => {
    setLat(parseFloat(s.lat).toFixed(6));
    setLng(parseFloat(s.lon).toFixed(6));
    ac.setQuery(s.display_name);
    ac.clear();
  };

  const handleGeocode = () => {
    if (!ac.query.trim()) return;
    ac.clear();
    geocodeMutation.mutate(ac.query.trim());
  };

  return (
    <div className={styles.field}>
      <Text size="2" weight="medium">Location</Text>

      {/* Address search with autocomplete */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div
          ref={wrapperRef}
          style={{ position: "relative", flex: 1 }}
        >
          <TextField.Root
            size="2"
            placeholder="Search for an address..."
            value={ac.query}
            onChange={(e: { target: { value: string } }) =>
              ac.updateQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleGeocode();
                e.preventDefault();
              }
            }}
            onFocus={() => {
              if (ac.suggestions.length > 0) ac.setOpen(true);
            }}
          />
          {ac.open && (
            <SuggestionList
              suggestions={ac.suggestions}
              onSelect={selectSuggestion}
            />
          )}
        </div>
        <Button
          type="button"
          size="2"
          variant="soft"
          disabled={geocodeMutation.isPending || !ac.query.trim()}
          onClick={handleGeocode}
        >
          {geocodeMutation.isPending ? "Looking up..." : "Lookup"}
        </Button>
      </div>

      <LatLngInputs lat={lat} setLat={setLat} lng={lng} setLng={setLng} />
      <Text size="1" color="gray">
        Sets the simulated GPS position for home/away detection.
      </Text>
    </div>
  );
}
