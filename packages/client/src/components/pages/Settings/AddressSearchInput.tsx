import { useCallback, useEffect, useRef } from "react";
import { Button, TextField } from "@radix-ui/themes";
import type { PhotonResult } from "../../../hooks/useAddressAutocomplete.ts";

// ── Types ──

/** The return type of useAddressAutocomplete(), passed in by the parent */
export interface AutocompleteState {
  query: string;
  setQuery: (q: string) => void;
  updateQuery: (q: string) => void;
  suggestions: PhotonResult[];
  open: boolean;
  setOpen: (open: boolean) => void;
  clear: () => void;
}

interface AddressSearchInputProps {
  ac: AutocompleteState;
  disabled: boolean;
  onSelect: (suggestion: PhotonResult) => void;
  onLookup: () => void;
}

// ── Component ──

export function AddressSearchInput({
  ac,
  disabled,
  onSelect,
  onLookup,
}: AddressSearchInputProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);

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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        onLookup();
        e.preventDefault();
      }
    },
    [onLookup],
  );

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
      <div
        ref={wrapperRef}
        style={{ position: "relative", flex: 1, maxWidth: 350 }}
      >
        <TextField.Root
          size="2"
          placeholder="Or search for an address..."
          value={ac.query}
          onChange={(e) => ac.updateQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (ac.suggestions.length > 0) ac.setOpen(true);
          }}
        />
        {ac.open && (
          <SuggestionDropdown
            suggestions={ac.suggestions}
            onSelect={onSelect}
          />
        )}
      </div>
      <Button
        size="2"
        variant="soft"
        disabled={disabled || !ac.query.trim()}
        onClick={onLookup}
      >
        Lookup
      </Button>
    </div>
  );
}

// ── Suggestion Dropdown ──

function SuggestionDropdown({
  suggestions,
  onSelect,
}: {
  suggestions: PhotonResult[];
  onSelect: (s: PhotonResult) => void;
}) {
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
