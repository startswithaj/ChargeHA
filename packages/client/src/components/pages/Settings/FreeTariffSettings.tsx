import { CheckCircle, Gift } from "lucide-react";
import { Badge, Switch } from "@radix-ui/themes";
import { trpc } from "../../../trpc.ts";
import {
  useChargingConfig,
  useChargingConfigMutation,
} from "../../../hooks/useSectionConfig.ts";
import { useDraftConfig } from "../../../hooks/useDraftConfig.ts";
import {
  NumberInput,
  SettingsRow,
  SettingsSection,
} from "./SettingsLayout.tsx";

/** Live badge showing whether the grid currently counts as free. */
function CurrentRateBadge(
  { enabled, maxRate }: { enabled: boolean; maxRate: number },
) {
  const { data: currentRate } = trpc.tariff.currentRate.useQuery();

  if (!currentRate) {
    return (
      <Badge color="gray" variant="soft" size="1">No tariff configured</Badge>
    );
  }

  const symbol = currentRate.currencySymbol;
  const rateLabel = `${symbol}${currentRate.ratePerKwh}/kWh`;

  if (enabled && currentRate.ratePerKwh <= maxRate) {
    return (
      <Badge color="green" variant="soft" size="1">
        <CheckCircle size={12} /> Free now — {rateLabel}
      </Badge>
    );
  }
  return (
    <Badge color="gray" variant="soft" size="1">
      {currentRate.label} — {rateLabel}
    </Badge>
  );
}

export function FreeTariffSettings() {
  const { data: config } = useChargingConfig();
  const mutation = useChargingConfigMutation();
  const { fields, setField, isDirty, save, saveStatus } = useDraftConfig(
    config,
    mutation,
  );

  if (!fields) return null;

  return (
    <SettingsSection
      icon={<Gift size={18} />}
      title="Free Grid Charging"
      description="Charge from the grid whenever your electricity is free, regardless of solar. Charging runs until the rate stops being free or the vehicle reaches its charge limit. Home battery priority still applies — if it's enabled and your home battery is below its limit (or its charge level can't be read), the vehicle waits. Requires tariff periods to be configured under Electricity Tariffs."
      saveStatus={saveStatus}
      isDirty={isDirty}
      onSave={save}
      action={
        <CurrentRateBadge
          enabled={fields.freeTariffChargingEnabled}
          maxRate={fields.freeTariffMaxRatePerKwh}
        />
      }
    >
      <SettingsRow
        label="Charge when grid is free"
        help="When the active tariff rate is free, start charging at the vehicle's maximum amps. Charging stops as soon as the rate is no longer free."
      >
        <Switch
          size="2"
          checked={fields.freeTariffChargingEnabled}
          onCheckedChange={(v) => setField("freeTariffChargingEnabled", v)}
        />
      </SettingsRow>

      <SettingsRow
        label="Treat as free at or below"
        help="Rates at or below this count as free. Leave at 0 to charge only when the grid genuinely costs nothing (including negative rates). Raise it to also charge through a cheap off-peak window."
      >
        <div
          style={{
            opacity: fields.freeTariffChargingEnabled ? 1 : 0.4,
            pointerEvents: fields.freeTariffChargingEnabled ? "auto" : "none",
          }}
        >
          <NumberInput
            value={String(fields.freeTariffMaxRatePerKwh)}
            onChange={(v) =>
              setField("freeTariffMaxRatePerKwh", parseFloat(v) || 0)}
            step={0.01}
            suffix="/kWh"
          />
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}
