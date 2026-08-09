import { Text } from "@radix-ui/themes";
import { DiscoveryResultList } from "../../../hostUi.ts";

export interface StationOption {
  id: string;
  name: string;
}

const pickerStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
} as const;

/** The SEMS account's power stations, rendered with the same rows every other
 *  plugin uses for discovered devices: station name over station id, with a Use
 *  button. Shared by the wizard step and the settings panel. */
export function StationPicker(
  { stations, selectedStationId, onSelect, searched }: {
    stations: StationOption[];
    selectedStationId: string;
    onSelect: (stationId: string) => void;
    /** True once a listStations call has come back, so the empty state stays
     *  hidden until the user has actually loaded. */
    searched: boolean;
  },
) {
  // Nothing loaded and nothing configured: the picker has nothing to say yet.
  if (stations.length === 0 && !searched && !selectedStationId) return null;

  return (
    <div style={pickerStyle}>
      <Text as="label" size="2" weight="medium">Power Station</Text>

      {/* Re-entry with a saved station but no list loaded — show what is set. */}
      {stations.length === 0 && selectedStationId && (
        <Text size="1" color="gray">Current station: {selectedStationId}</Text>
      )}

      <DiscoveryResultList
        results={stations}
        onUse={(station: StationOption) => onSelect(station.id)}
        searched={searched}
        selectedId={selectedStationId}
        emptyMessage="No power stations found on this SEMS account."
      />
    </div>
  );
}
