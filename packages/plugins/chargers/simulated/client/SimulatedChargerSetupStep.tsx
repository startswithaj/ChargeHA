import { Text } from "@radix-ui/themes";
import {
  advanceOnly,
  type PluginStepDef,
  stepStyles as styles,
} from "../../../hostUi.ts";

export const simulatedChargerSetupStep: PluginStepDef = {
  id: "simulated-charger-setup",
  label: "Simulated Charger",
  useStep: () => ({
    next: { kind: "ready", hint: null, onNext: advanceOnly },
    view: (
      <div className={styles.stepContainer}>
        <Text size="2">
          Creates a virtual smart charger for testing — no hardware required.
          Adjust its plugged-in state and simulated vehicle appetite from Settings
          once it's added.
        </Text>
      </div>
    ),
  }),
};
