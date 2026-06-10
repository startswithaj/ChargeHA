import { Wand2, Zap } from "lucide-react";
import { Button, Switch, Text } from "@radix-ui/themes";
import { trpc } from "../../../trpc.ts";
import { useRouter } from "../../../hooks/useRouter.ts";
import {
  useChargingConfig,
  useChargingConfigMutation,
} from "../../../hooks/useSectionConfig.ts";
import { useDraftConfig } from "../../../hooks/useDraftConfig.ts";
import { SettingsRow, SettingsSection } from "./SettingsLayout.tsx";
import { AuthSettings } from "./AuthSettings.tsx";
import { InverterSettings } from "./InverterSettings.tsx";
import { VehicleSettings } from "./VehicleSettings.tsx";
import { SolarTrackingSettings } from "./SolarTrackingSettings.tsx";
import { BatterySettings } from "./BatterySettings.tsx";
import { TariffSettings } from "./TariffSettings.tsx";
import { GeneralSettings } from "./GeneralSettings.tsx";
import { NotificationSettings } from "./NotificationSettings.tsx";

// ── Main Settings Component ──

export function Settings() {
  const { navigate } = useRouter();
  const { data: charging, isLoading: chargingLoading } = useChargingConfig();
  const chargingMutation = useChargingConfigMutation();
  const {
    fields: chargingFields,
    setField: setChargingField,
    isDirty: chargingDirty,
    save: saveCharging,
    saveStatus: chargingSaveStatus,
  } = useDraftConfig(charging, chargingMutation);

  const { data: wizardStatus = null } = trpc.wizard.status.useQuery();

  if (chargingLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <Text size="5" weight="bold">Settings</Text>
        <Text size="2" color="gray">Loading...</Text>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text size="5" weight="bold">Settings</Text>
      </div>

      {/* ═══ Setup Wizard ═══ */}
      {wizardStatus !== null && (
        <Button
          size="2"
          variant="soft"
          onClick={() => {
            navigate({ type: "wizard" });
          }}
        >
          <Wand2 size={14} />
          {wizardStatus.completed ? "Re-run Setup Wizard" : "Run Setup Wizard"}
        </Button>
      )}

      {/* ═══ Charging Control ═══ */}
      <SettingsSection
        icon={<Zap size={18} />}
        title="Charging Control"
        description="Global enable/disable for all charge automation."
        saveStatus={chargingSaveStatus}
        isDirty={chargingDirty}
        onSave={saveCharging}
      >
        <SettingsRow label="Charging enabled">
          <Switch
            size="2"
            checked={chargingFields?.chargingEnabled ?? true}
            onCheckedChange={(v) => setChargingField("chargingEnabled", v)}
          />
        </SettingsRow>
      </SettingsSection>

      {/* ═══ My Equipment ═══ */}
      <InverterSettings />

      {/* ═══ Vehicles ═══ */}
      <VehicleSettings />

      {/* ═══ Solar Tracking ═══ */}
      <SolarTrackingSettings />

      {/* ═══ Electricity Tariffs ═══ */}
      <TariffSettings />

      {/* ═══ Battery ═══ */}
      <BatterySettings />

      {/* ═══ System + Home Location ═══ */}
      <GeneralSettings />

      <NotificationSettings />

      {/* ═══ Authentication ═══ */}
      <AuthSettings />
    </div>
  );
}
