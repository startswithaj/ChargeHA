import { useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, TextField } from "@radix-ui/themes";
import {
  type PhotonResult,
  useAddressAutocomplete,
} from "../../../hooks/useAddressAutocomplete.ts";
import { trpc } from "../../../trpc.ts";

interface AddressSearchProps {
  onCoordinatesFound: (lat: string, lng: string, displayName: string) => void;
  onGeoStatusChange: (status: "idle" | "loading" | "error") => void;
  onGeoError: (msg: string) => void;
  onGeoLoadingMsg: (msg: string) => void;
  geoStatus: "idle" | "loading" | "error";
}

function SuggestionDropdown(
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

export function AddressSearch({
  onCoordinatesFound,
  onGeoStatusChange,
  onGeoError,
  onGeoLoadingMsg,
  geoStatus,
}: AddressSearchProps) {
  const ac = useAddressAutocomplete();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();

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
    const newLat = parseFloat(s.lat).toFixed(6);
    const newLng = parseFloat(s.lon).toFixed(6);
    ac.setQuery(s.display_name);
    ac.clear();
    onCoordinatesFound(newLat, newLng, s.display_name);
  };

  const geocodeMutation = useMutation({
    mutationFn: (query: string) =>
      utils.client.config.geocode.query({ q: query }),
    onMutate: () => {
      onGeoStatusChange("loading");
      onGeoError("");
      onGeoLoadingMsg("");
      ac.clear();
    },
    onSuccess: (result) => {
      ac.setQuery(result.displayName);
      onGeoStatusChange("idle");
      onCoordinatesFound(
        result.latitude.toFixed(6),
        result.longitude.toFixed(6),
        result.displayName,
      );
    },
    onError: (err) => {
      onGeoError(err instanceof Error ? err.message : "Geocoding failed");
      onGeoStatusChange("error");
    },
  });

  const handleGeocode = () => {
    if (!ac.query.trim()) return;
    geocodeMutation.mutate(ac.query.trim());
  };

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
      <div
        ref={wrapperRef}
        style={{ position: "relative", flex: 1, maxWidth: 350 }}
      >
        <TextField.Root
          size="2"
          placeholder="Or search for an address..."
          aria-label="Address search"
          value={ac.query}
          onChange={(e) => ac.updateQuery(e.target.value)}
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
          <SuggestionDropdown
            suggestions={ac.suggestions}
            onSelect={selectSuggestion}
          />
        )}
      </div>
      <Button
        size="2"
        variant="soft"
        disabled={geoStatus === "loading" || !ac.query.trim()}
        onClick={handleGeocode}
      >
        Lookup
      </Button>
    </div>
  );
}
