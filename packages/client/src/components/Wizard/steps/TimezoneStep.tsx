import { useMemo, useState } from "react";
import { Callout, Select, Text } from "@radix-ui/themes";
import { CheckCircle } from "lucide-react";
import {
  useSystemConfig,
  useSystemConfigMutation,
} from "../../../hooks/useSectionConfig.ts";
import type { StepDef } from "../flow.ts";
import styles from "./steps.module.css";
import { buildTimezoneOptions } from "../../../lib/timezones.ts";

function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

export const timezoneStep: StepDef = {
  id: "timezone",
  label: "Timezone",
  useStep: () => {
    const { data: systemConfig } = useSystemConfig();
    const detectedTimezone = useMemo(detectTimezone, []);
    const [selectedTimezone, setSelectedTimezone] = useState(
      systemConfig?.timezone || detectedTimezone,
    );
    const saveMutation = useSystemConfigMutation();

    return {
      next: {
        kind: "ready",
        hint: "Next saves your timezone",
        // mutateAsync throws on failure; the host shows the message and the
        // wizard stays put.
        onNext: async () => {
          await saveMutation.mutateAsync({ timezone: selectedTimezone });
        },
      },
      view: (
        <TimezoneFields
          configuredTimezone={systemConfig?.timezone ?? null}
          detectedTimezone={detectedTimezone}
          selectedTimezone={selectedTimezone}
          onSelect={setSelectedTimezone}
        />
      ),
    };
  },
};

function TimezoneFields(
  { configuredTimezone, detectedTimezone, selectedTimezone, onSelect }: {
    configuredTimezone: string | null;
    detectedTimezone: string;
    selectedTimezone: string;
    onSelect: (timezone: string) => void;
  },
) {
  const timezoneOptions = useMemo(buildTimezoneOptions, []);

  return (
    <div className={styles.stepContainer}>
      <Text as="p" size="3" color="gray">
        Select your timezone. This is used for schedule evaluation and display
        formatting.
      </Text>

      {configuredTimezone && (
        <Callout.Root color="green">
          <Callout.Icon>
            <CheckCircle size={16} />
          </Callout.Icon>
          <Callout.Text>
            Timezone is already set to{" "}
            {configuredTimezone}. You can continue or change it below.
          </Callout.Text>
        </Callout.Root>
      )}

      <div className={styles.fieldGroup}>
        <Text as="label" size="2" weight="medium">
          Timezone
        </Text>
        <Select.Root value={selectedTimezone} onValueChange={onSelect}>
          <Select.Trigger aria-label="Timezone" />
          <Select.Content>
            {timezoneOptions.map((opt) => (
              <Select.Item key={opt.value} value={opt.value}>
                {opt.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
        {selectedTimezone === detectedTimezone && (
          <Text as="p" size="1" color="gray">
            Auto-detected from your browser
          </Text>
        )}
      </div>
    </div>
  );
}
