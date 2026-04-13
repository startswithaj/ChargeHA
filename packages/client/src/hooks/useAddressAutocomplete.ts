import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "../trpc.ts";

export interface PhotonResult {
  lat: string;
  lon: string;
  display_name: string;
}

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 5;

export function useAddressAutocomplete() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateQuery = useCallback((value: string) => {
    setQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (value.trim().length < MIN_QUERY_LENGTH) {
      setDebouncedQuery("");
      setOpen(false);
      return;
    }
    timerRef.current = setTimeout(() => {
      setDebouncedQuery(value.trim());
    }, DEBOUNCE_MS);
  }, []);

  const trimmed = debouncedQuery;
  const enabled = trimmed.length >= MIN_QUERY_LENGTH;

  const { data: suggestions = [] } = trpc.config.geocodeAutocomplete.useQuery(
    { q: trimmed },
    {
      enabled,
      staleTime: 5 * 60 * 1000,
    },
  ) as { data: PhotonResult[] };

  // Open dropdown when suggestions arrive
  useEffect(() => {
    if (suggestions.length > 0 && enabled) {
      setOpen(true);
    }
  }, [suggestions, enabled]);

  const clear = useCallback(() => {
    setDebouncedQuery("");
    setOpen(false);
  }, []);

  return { query, setQuery, updateQuery, suggestions, open, setOpen, clear };
}
