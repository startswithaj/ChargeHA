import { Callout, Select, Text } from "@radix-ui/themes";
import { Info } from "lucide-react";
import { trpc } from "../../../trpc.ts";
import {
  useSolarConfig,
  useSolarConfigMutation,
} from "../../../hooks/useSectionConfig.ts";
import { useEnergyData } from "../../../hooks/useEnergyData.ts";
import type { VehicleWithState } from "@chargeha/shared";
import styles from "./steps.module.css";

export function GridVoltageStep() {
  const { data: solarConfig } = useSolarConfig();
  const mutation = useSolarConfigMutation();
  const { data: energyData } = useEnergyData();
  const { data: vehiclesData } = trpc.vehicle.list.useQuery();

  const vehicles = (vehiclesData?.vehicles ?? []) as VehicleWithState[];
  const inverterVoltage = energyData?.realtime?.gridVoltageV ?? null;

  // Collect valid vehicle voltage readings (>= 100V)
  const vehicleReadings = vehicles
    .filter((v) => (v.state?.chargerVoltage ?? 0) >= 100)
    .map((v) => ({ name: v.name, voltage: v.state?.chargerVoltage ?? 0 }));

  const currentValue = String(solarConfig?.gridVoltage ?? 230);

  // Show Australia voltage note when any reading exceeds 230V
  const hasHighVoltage = (inverterVoltage !== null && inverterVoltage > 230) ||
    vehicleReadings.some((v) => v.voltage > 230);

  return (
    <div className={styles.stepContainer}>
      <Text size="2" color="gray">
        ChargeHA converts available solar watts into charging amps using your
        grid voltage. It reads this from your vehicle or inverter when available
        — this setting is used as a fallback when neither reports a valid
        reading.
      </Text>

      {(vehicleReadings.length > 0 || inverterVoltage !== null) && (
        <Callout.Root color="blue">
          <Callout.Icon>
            <Info size={16} />
          </Callout.Icon>
          <Callout.Text>
            <Text weight="medium">Detected voltage readings:</Text>
          </Callout.Text>
          <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1.25rem" }}>
            {inverterVoltage !== null && (
              <li>Inverter/Smart Meter: {Math.round(inverterVoltage)}V</li>
            )}
            {vehicleReadings.map((v) => (
              <li key={v.name}>
                {v.name}: {v.voltage}V
              </li>
            ))}
          </ul>
        </Callout.Root>
      )}

      <div className={styles.fieldGroup}>
        <Text as="label" size="2" weight="medium">
          Grid voltage
        </Text>
        <Select.Root
          size="2"
          value={currentValue}
          onValueChange={(v) => mutation.mutate({ gridVoltage: Number(v) })}
        >
          <Select.Trigger />
          <Select.Content>
            <Select.Item value="230">
              230V (Europe, Asia, Africa, Australia)
            </Select.Item>
            <Select.Item value="120">120V (North America, Japan)</Select.Item>
          </Select.Content>
        </Select.Root>
      </div>

      {hasHighVoltage && (
        <Text size="1" color="gray">
          Australia's nominal voltage is 230V but can vary up to 240V in
          practice. ChargeHA reads live voltage from your inverter or vehicle
          when available, so this setting only applies as a fallback.
        </Text>
      )}
    </div>
  );
}
