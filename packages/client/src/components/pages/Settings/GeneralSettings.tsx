import { Server } from "lucide-react";
import { Select } from "@radix-ui/themes";
import {
  useHomeConfig,
  useSystemConfig,
  useSystemConfigMutation,
} from "../../../hooks/useSectionConfig.ts";
import { useDraftConfig } from "../../../hooks/useDraftConfig.ts";
import {
  NumberInput,
  SettingsRow,
  SettingsSection,
} from "./SettingsLayout.tsx";
import { HomeLocationSection } from "./HomeLocationSection.tsx";

export function GeneralSettings() {
  const { data: config } = useSystemConfig();
  const { data: homeConfig } = useHomeConfig();
  const mutation = useSystemConfigMutation();
  const { fields, setField, isDirty, save, saveStatus } = useDraftConfig(
    config,
    mutation,
  );

  if (!fields) return null;

  return (
    <>
      {/* ═══ System ═══ */}
      <SettingsSection
        icon={<Server size={18} />}
        title="System"
        description="Polling intervals, data retention, and system configuration."
        saveStatus={saveStatus}
        isDirty={isDirty}
        onSave={save}
      >
        <SettingsRow
          label="Controller loop interval"
          help="How often the charge controller evaluates energy data and adjusts charging."
        >
          <NumberInput
            value={String(fields.controllerLoopSeconds)}
            onChange={(v) =>
              setField("controllerLoopSeconds", parseInt(v) || 10)}
            suffix="sec"
            step={5}
            min={5}
            max={120}
          />
        </SettingsRow>

        <SettingsRow
          label="Recording interval"
          help="How often energy readings are saved to the database."
        >
          <NumberInput
            value={String(fields.recordingIntervalSeconds)}
            onChange={(v) =>
              setField("recordingIntervalSeconds", parseInt(v) || 60)}
            suffix="sec"
            step={10}
            min={10}
            max={300}
          />
        </SettingsRow>

        <SettingsRow
          label="Data retention"
          help="How long energy and charge readings are kept before purging."
        >
          <NumberInput
            value={String(fields.dataRetentionDays)}
            onChange={(v) => setField("dataRetentionDays", parseInt(v) || 730)}
            suffix="days"
            step={30}
            min={30}
            max={3650}
          />
        </SettingsRow>

        <SettingsRow
          label="Log retention"
          help="How long controller decision logs are kept."
        >
          <NumberInput
            value={String(fields.logRetentionDays)}
            onChange={(v) => setField("logRetentionDays", parseInt(v) || 30)}
            suffix="days"
            step={1}
            min={7}
            max={365}
          />
        </SettingsRow>

        <SettingsRow
          label="Timezone"
          help="Used for schedule evaluation and stats display."
        >
          <Select.Root
            value={fields.timezone ||
              Intl.DateTimeFormat().resolvedOptions().timeZone}
            onValueChange={(v) => setField("timezone", v)}
          >
            <Select.Trigger style={{ minWidth: 240 }} />
            <Select.Content>
              {Intl.supportedValuesOf("timeZone").map((tz) => (
                <Select.Item key={tz} value={tz}>
                  {tz.replace(/_/g, " ")}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </SettingsRow>
      </SettingsSection>

      {/* ═══ Home Location ═══ */}
      <HomeLocationSection
        homeConfig={homeConfig ?? null}
      />
    </>
  );
}
