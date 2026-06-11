import { useMemo, useState } from "react";
import { Button, Callout, Select, Text } from "@radix-ui/themes";
import { CheckCircle } from "lucide-react";
import {
  useSystemConfig,
  useSystemConfigMutation,
} from "../../../hooks/useSectionConfig.ts";
import type { StepProps } from "../WizardShell.tsx";
import styles from "./steps.module.css";
import { buildTimezoneOptions } from "../../../lib/timezones.ts";

function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

export function TimezoneStep({ onNext }: StepProps) {
  const { data: systemConfig } = useSystemConfig();
  const detectedTimezone = useMemo(detectTimezone, []);
  const timezoneOptions = useMemo(buildTimezoneOptions, []);
  const [selectedTimezone, setSelectedTimezone] = useState(
    systemConfig?.timezone || detectedTimezone,
  );

  const saveMutation = useSystemConfigMutation();

  return (
    <div className={styles.stepContainer}>
      <Text as="p" size="3" color="gray">
        Select your timezone. This is used for schedule evaluation and display
        formatting.
      </Text>

      {systemConfig?.timezone && (
        <Callout.Root color="green">
          <Callout.Icon>
            <CheckCircle size={16} />
          </Callout.Icon>
          <Callout.Text>
            Timezone is already set to{" "}
            {systemConfig.timezone}. You can continue or change it below.
          </Callout.Text>
        </Callout.Root>
      )}

      <div className={styles.fieldGroup}>
        <Text as="label" size="2" weight="medium">
          Timezone
        </Text>
        <Select.Root
          value={selectedTimezone}
          onValueChange={setSelectedTimezone}
        >
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

      <div className={styles.stepActions}>
        <Button
          onClick={() => {
            saveMutation.mutate(
              { timezone: selectedTimezone },
              { onSuccess: () => onNext() },
            );
          }}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? "Saving..." : "Save & Continue"}
        </Button>
      </div>

      {saveMutation.error && (
        <Text as="p" size="2" color="red">
          {saveMutation.error.message}
        </Text>
      )}
    </div>
  );
}
