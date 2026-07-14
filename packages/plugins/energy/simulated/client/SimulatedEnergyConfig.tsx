import { trpc } from "./trpc.ts";
import {
  type PluginConfigField,
  PluginConfigForm,
} from "../../../../client/src/components/pages/Settings/PluginConfigForm.tsx";

/** Editable solar knobs, mirroring the Simulator page. */
const FIELDS: PluginConfigField[] = [
  {
    key: "peakKw",
    label: "Peak solar (kW)",
    help: "Maximum solar output at solar noon.",
  },
  {
    key: "cloudiness",
    label: "Cloudiness (%)",
    help: "0 = clear skies, 100 = heavily overcast.",
  },
  {
    key: "storms",
    label: "Storms",
    help: "Number of sustained dark periods during the day.",
  },
  {
    key: "homeBaseW",
    label: "Home base load (W)",
    help: "Baseline household consumption.",
  },
  {
    key: "sunrise",
    label: "Sunrise (hour)",
    help: "Hour of day solar generation starts, e.g. 6.5.",
  },
  {
    key: "sunset",
    label: "Sunset (hour)",
    help: "Hour of day solar generation ends, e.g. 18.",
  },
  {
    key: "seed",
    label: "Seed",
    help: "Random seed — same seed reproduces the same weather.",
  },
];

export function SimulatedEnergyConfig(): JSX.Element {
  const { data } = trpc.plugin.energy.simulated_energy.getConfig.useQuery();
  const utils = trpc.useUtils();
  const { mutate } = trpc.plugin.energy.simulated_energy.setConfig.useMutation({
    onSuccess: () =>
      utils.plugin.energy.simulated_energy.getConfig.invalidate(),
  });
  return <PluginConfigForm data={data} fields={FIELDS} onSave={mutate} />;
}
