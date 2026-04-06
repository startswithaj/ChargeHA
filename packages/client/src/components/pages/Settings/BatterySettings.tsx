import { Battery, CheckCircle } from "lucide-react";
import { Badge, Slider, Switch, Text } from "@radix-ui/themes";
import {
  useBatteryConfig,
  useBatteryConfigMutation,
} from "../../../hooks/useSectionConfig.ts";
import { useDraftConfig } from "../../../hooks/useDraftConfig.ts";
import { useEnergyData } from "../../../hooks/useEnergyData.ts";
import { SettingsRow, SettingsSection } from "./SettingsLayout.tsx";

export function BatterySettings() {
  const { data: config } = useBatteryConfig();
  const mutation = useBatteryConfigMutation();
  const { fields, setField, isDirty, save, saveStatus } = useDraftConfig(
    config,
    mutation,
  );
  const { data: energyData } = useEnergyData();
  const currentEnergy = energyData?.realtime ?? null;

  if (!fields) return null;

  const batteryActionBadge = (() => {
    if (currentEnergy?.batterySoc != null) {
      return (
        <Badge color="green" variant="soft" size="1">
          <CheckCircle size={12} /> Detected —{" "}
          {Math.round(currentEnergy.batterySoc)}%
        </Badge>
      );
    }
    return <Badge color="gray" variant="soft" size="1">Not detected</Badge>;
  })();

  return (
    <SettingsSection
      icon={<Battery size={18} />}
      title="Battery"
      badge="Beta"
      description="This does not control your home battery — it controls EV charging based on battery state. When enabled, EV charging is held until your home battery reaches a minimum charge level, letting the battery fill first before excess solar is sent to your vehicle. Requires a home battery reporting SOC through your inverter — if no battery is detected, this setting has no effect."
      saveStatus={saveStatus}
      isDirty={isDirty}
      onSave={save}
      action={batteryActionBadge}
    >
      <SettingsRow
        label="Battery priority enabled"
        help="When enabled, EV charging is paused until your home battery reaches the priority limit below. Once the battery is charged to that level, excess solar will be allocated to vehicle charging."
      >
        <Switch
          size="2"
          checked={fields.batteryPriorityEnabled}
          onCheckedChange={(v) => setField("batteryPriorityEnabled", v)}
        />
      </SettingsRow>

      <SettingsRow
        label="Battery priority limit"
        help="Your home battery must reach this charge level before EV charging begins. Higher values give the battery more time to fill first."
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            minWidth: 200,
            opacity: fields.batteryPriorityEnabled ? 1 : 0.4,
            pointerEvents: fields.batteryPriorityEnabled ? "auto" : "none",
          }}
        >
          <Slider
            min={20}
            max={100}
            step={5}
            disabled={!fields.batteryPriorityEnabled}
            value={[fields.batteryPriorityLimit]}
            onValueChange={([v]) => setField("batteryPriorityLimit", v)}
            style={{ flex: 1 }}
          />
          <Text
            size="2"
            weight="medium"
            style={{ minWidth: 40, textAlign: "right" }}
          >
            {fields.batteryPriorityLimit}%
          </Text>
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}
