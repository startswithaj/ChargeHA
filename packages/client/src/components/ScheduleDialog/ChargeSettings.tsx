import { Button, Text } from "@radix-ui/themes";
import type { ScheduleFormData } from "@chargeha/shared";
import styles from "./ScheduleDialog.module.css";

interface ChargeSettingsProps {
  chargeAmps: number;
  chargeLimitPct: number;
  maxAmps: number;
  updateField: <K extends keyof ScheduleFormData>(
    key: K,
    value: ScheduleFormData[K],
  ) => void;
}

/** Charge amps + charge limit steppers (charge schedules only) */
export function ChargeSettings({
  chargeAmps,
  chargeLimitPct,
  maxAmps,
  updateField,
}: ChargeSettingsProps) {
  return (
    <>
      <div className={styles.field}>
        <Text size="2" weight="medium">Charge Amps</Text>
        <div className={styles.stepperRow}>
          <Button
            type="button"
            variant="ghost"
            size="1"
            disabled={chargeAmps <= 1}
            onClick={() =>
              updateField(
                "chargeAmps",
                Math.max(1, chargeAmps - 1),
              )}
          >
            −
          </Button>
          <Text size="3" weight="bold" className={styles.stepperValue}>
            {chargeAmps}A
          </Text>
          <Button
            type="button"
            variant="ghost"
            size="1"
            disabled={chargeAmps >= maxAmps}
            onClick={() =>
              updateField(
                "chargeAmps",
                Math.min(maxAmps, chargeAmps + 1),
              )}
          >
            +
          </Button>
          <Button
            type="button"
            variant="soft"
            size="1"
            disabled={chargeAmps >= maxAmps}
            onClick={() => updateField("chargeAmps", maxAmps)}
          >
            Max
          </Button>
        </div>
      </div>

      <div className={styles.field}>
        <Text size="2" weight="medium">Charge Limit</Text>
        <div className={styles.stepperRow}>
          <Button
            type="button"
            variant="ghost"
            size="1"
            disabled={chargeLimitPct <= 50}
            onClick={() =>
              updateField(
                "chargeLimitPct",
                Math.max(50, chargeLimitPct - 5),
              )}
          >
            −
          </Button>
          <Text size="3" weight="bold" className={styles.stepperValue}>
            {chargeLimitPct}%
          </Text>
          <Button
            type="button"
            variant="ghost"
            size="1"
            disabled={chargeLimitPct >= 100}
            onClick={() =>
              updateField(
                "chargeLimitPct",
                Math.min(100, chargeLimitPct + 5),
              )}
          >
            +
          </Button>
        </div>
      </div>
    </>
  );
}
