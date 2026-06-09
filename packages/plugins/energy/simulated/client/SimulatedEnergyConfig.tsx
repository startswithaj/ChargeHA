import { useState } from "react";
import { Button, TextField } from "@radix-ui/themes";
import { trpc } from "./trpc.ts";
import { SettingsRow } from "../../../../client/src/components/pages/Settings/SettingsLayout.tsx";
import type { SimulatedEnergyConfig as SimulatedEnergyConfigShape } from "../server/config.ts";

/** Editable solar knobs, mirroring the Simulator page. */
const FIELDS: {
  key: keyof SimulatedEnergyConfigShape;
  label: string;
  help: string;
}[] = [
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

export function SimulatedEnergyConfig(): JSX.Element | null {
  const { data: config } = trpc.energy.simulated_energy.getConfig.useQuery();
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState<Partial<Record<string, string>>>({});
  const configMutation = trpc.energy.simulated_energy.setConfig.useMutation({
    onSuccess: () => {
      utils.energy.simulated_energy.getConfig.invalidate();
      setDraft({});
    },
  });

  if (!config) return null;

  const isDirty = Object.keys(draft).length > 0;
  const valueOf = (key: keyof SimulatedEnergyConfigShape): string =>
    draft[key] ?? String(config[key]);

  return (
    <>
      {FIELDS.map((field) => (
        <SettingsRow key={field.key} label={field.label} help={field.help}>
          <TextField.Root
            size="2"
            value={valueOf(field.key)}
            onChange={(e: { target: { value: string } }) =>
              setDraft((d) => ({ ...d, [field.key]: e.target.value }))}
            style={{ width: 100 }}
          />
        </SettingsRow>
      ))}
      <div
        style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}
      >
        <Button
          size="1"
          disabled={!isDirty || configMutation.isPending}
          onClick={() => configMutation.mutate(draft)}
        >
          {configMutation.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </>
  );
}
