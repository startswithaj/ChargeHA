import { useState } from "react";
import { skipToken } from "@tanstack/react-query";
import { Badge, Button, Text } from "@radix-ui/themes";
import {
  type PluginStepDef,
  stepStyles as styles,
  type WizardNext,
} from "../../../hostUi.ts";
import { trpc } from "./trpc.ts";
import { FormError } from "../../../hostUi.ts";

function verifyNext(toggled: boolean): WizardNext {
  if (!toggled) {
    return { kind: "blocked", reason: "Toggle the plug to verify control" };
  }
  return { kind: "ready", hint: null, onNext: () => Promise.resolve() };
}

export const tapoVerifyStep: PluginStepDef = {
  id: "tapo-verify",
  label: "Verify Plug Control",
  useStep: ({ chargerId }) => {
    const status = trpc.plugin.charger.tapo.status.useQuery(
      chargerId === null ? skipToken : { chargerRowId: chargerId },
      { refetchInterval: 3000 },
    );
    const setPower = trpc.plugin.charger.tapo.setPower.useMutation({
      onSuccess: () => {
        setToggled(true);
        status.refetch();
      },
    });
    const [toggled, setToggled] = useState(false);

    return {
      next: verifyNext(toggled),
      view: (
        <div className={styles.stepContainer}>
          <Text size="2">
            Switch the plug on and off to confirm ChargeHA controls it. The
            measured power updates every few seconds.
          </Text>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Button
              size="2"
              disabled={setPower.isPending || chargerId === null}
              onClick={() =>
                chargerId !== null &&
                setPower.mutate({
                  chargerRowId: chargerId,
                  on: !(status.data?.on),
                })}
            >
              Turn {status.data?.on ? "Off" : "On"}
            </Button>
            {status.data && (
              <Badge color={status.data.on ? "green" : "gray"} size="2">
                {status.data.on
                  ? `On — ${Math.round(status.data.powerW)} W`
                  : "Off"}
              </Badge>
            )}
            {setPower.isError && (
              <FormError
                message={setPower.error instanceof Error
                  ? setPower.error.message
                  : "Command failed"}
              />
            )}
          </div>
        </div>
      ),
    };
  },
};
