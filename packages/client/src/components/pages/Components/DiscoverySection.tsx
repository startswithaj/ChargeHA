import { useState } from "react";
import { Radar } from "lucide-react";
import { DiscoveryResultList } from "../../../../../plugins/NetworkDeviceSearch.tsx";
import { GallerySection, Rule, StackedSpecimen } from "./Specimen.tsx";

const noop = () => {};

const NETWORK_RESULTS = [
  { id: "192.168.1.24", name: "Solar Inverter 8.2kW" },
  { id: "192.168.1.31", name: "Gateway Meter" },
  { id: "192.168.1.44" },
  {
    id: "192.168.1.52",
    name: "Smart plug",
    unavailable: "Needs credentials",
  },
];

const CHARGER_RESULTS = [
  { id: "CP-1", name: "Garage Wallbox" },
  { id: "CP-2" },
];

export function DiscoverySection() {
  const [selected, setSelected] = useState("192.168.1.31");
  return (
    <GallerySection
      id="discovery"
      icon={<Radar size={18} />}
      title="Discovery results"
      description="One row per find, name over identifier, with a Use button on the right. Every plugin that scans a network or lists a cloud account renders this rather than keeping its own copy."
    >
      <Rule>
        The Use button is the row's only action. Once a row is chosen it becomes
        a green Selected badge instead, so the current pick stays visible in the
        list rather than the list collapsing to one line.
      </Rule>

      <StackedSpecimen label="Found inverters — a LAN scan, one selected, one unusable">
        <DiscoveryResultList
          results={NETWORK_RESULTS}
          onUse={(item) => setSelected(item.id)}
          selectedId={selected}
          searched
          emptyMessage="No inverters found on this network."
        />
      </StackedSpecimen>

      <Rule>
        A row with no name falls back to its identifier as the primary line —
        discovery cannot always name what answered. An `unavailable` row keeps
        its place with an orange badge in the Use slot, rather than being
        dropped and leaving the user staring at a short list.
      </Rule>

      <StackedSpecimen label="Found chargers — a pairing window, nothing chosen yet">
        <DiscoveryResultList
          results={CHARGER_RESULTS}
          onUse={noop}
          searched
          emptyMessage="No chargers answered."
        />
      </StackedSpecimen>

      <StackedSpecimen label="Empty — orange, and only after a search has run">
        <DiscoveryResultList
          results={[]}
          onUse={noop}
          searched
          emptyMessage="No inverters found. Check the device is on the same network."
        />
      </StackedSpecimen>
    </GallerySection>
  );
}
