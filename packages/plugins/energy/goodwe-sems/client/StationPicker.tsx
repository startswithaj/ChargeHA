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

export function StationPicker(
  { stations, selectedStationId, onSelect, searched }: {
    stations: StationOption[];
    selectedStationId: string;
    onSelect: (stationId: string) => void;
    searched: boolean;
  },
) {
  if (stations.length === 0 && !searched && !selectedStationId) return null;

  return (
    <div style={pickerStyle}>
      <Text as="label" size="2" weight="medium">Power Station</Text>

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
