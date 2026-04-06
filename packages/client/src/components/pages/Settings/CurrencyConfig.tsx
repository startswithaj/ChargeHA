import { Button, Text, TextField } from "@radix-ui/themes";
import { SettingsRow } from "./SettingsLayout.tsx";

export function CurrencyConfig({
  localSymbol,
  localCode,
  localDefaultRate,
  defaultsDirty,
  savingDefault,
  onSymbolChange,
  onCodeChange,
  onDefaultRateChange,
  onSave,
}: {
  localSymbol: string;
  localCode: string;
  localDefaultRate: string;
  defaultsDirty: boolean;
  savingDefault: boolean;
  onSymbolChange: (value: string) => void;
  onCodeChange: (value: string) => void;
  onDefaultRateChange: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <>
      {/* Currency configuration */}
      <SettingsRow label="Currency symbol" help="Symbol shown before costs.">
        <TextField.Root
          size="2"
          value={localSymbol}
          onChange={(e) => onSymbolChange(e.target.value)}
          style={{ width: 60 }}
        />
      </SettingsRow>

      <SettingsRow label="Currency code" help="ISO currency code (e.g. AUD).">
        <TextField.Root
          size="2"
          value={localCode}
          onChange={(e) => onCodeChange(e.target.value)}
          style={{ width: 80 }}
        />
      </SettingsRow>

      {/* Default rate */}
      <SettingsRow
        label="Default rate"
        help="Fallback rate when no tariff period matches the current time."
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <TextField.Root
            size="2"
            type="number"
            min={0}
            step={0.01}
            value={localDefaultRate}
            onChange={(e) => onDefaultRateChange(e.target.value)}
            style={{ width: 80 }}
          />
          <Text size="2" color="gray">{localSymbol}/kWh</Text>
        </div>
      </SettingsRow>

      {defaultsDirty && (
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            size="2"
            variant="soft"
            disabled={savingDefault}
            onClick={onSave}
          >
            {savingDefault ? "Saving..." : "Save Currency & Default Rate"}
          </Button>
        </div>
      )}
    </>
  );
}
