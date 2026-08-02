import { useState } from "react";
import { Badge, Code, Text, TextField } from "@radix-ui/themes";
import {
  type PluginStepDef,
  SettingsRow,
  stepStyles as styles,
  type WizardNext,
} from "../../../hostUi.ts";
import { trpc } from "./trpc.ts";

function ocppNext(connected: boolean): WizardNext {
  if (!connected) {
    return { kind: "blocked", reason: "Waiting for the charger to connect" };
  }
  return { kind: "ready", hint: null, onNext: () => Promise.resolve() };
}

function connectionBadge(
  connected: boolean,
  info: { vendor: string; model: string } | null | undefined,
): JSX.Element {
  if (connected) {
    return (
      <Badge color="green" size="2">
        Connected — {info?.vendor} {info?.model}
      </Badge>
    );
  }
  return <Badge color="gray" size="2">Waiting for charger…</Badge>;
}

export const ocppSetupStep: PluginStepDef = {
  id: "ocpp-setup",
  label: "OCPP Charger",
  useStep: () => {
    const { data: config } = trpc.plugin.charger.ocpp.getConfig.useQuery();
    const utils = trpc.useUtils();
    const saveMutation = trpc.plugin.charger.ocpp.setConfig.useMutation({
      onSuccess: () => utils.plugin.charger.ocpp.getConfig.invalidate(),
    });
    const status = trpc.plugin.charger.ocpp.status.useQuery(undefined, {
      refetchInterval: 2000,
    });
    const [chargerId, setChargerId] = useState<string | null>(null);

    const effectiveId = chargerId ?? config?.ocppChargerId ?? "";
    // location.port is "" on default ports (80/443) — omit the colon then.
    const wsUrl = `ws://${globalThis.location.hostname}${
      globalThis.location.port ? `:${globalThis.location.port}` : ""
    }/api/charger/ocpp/${effectiveId || "<charger-id>"}`;
    const connected = status.data?.connected === true;

    return {
      next: ocppNext(connected),
      view: (
        <div className={styles.stepContainer}>
          <SettingsRow
            label="Charger ID"
            help="Any name you choose — it becomes part of the URL below and identifies your charger."
          >
            <TextField.Root
              size="2"
              placeholder="my-wallbox"
              value={effectiveId}
              onChange={(e: { target: { value: string } }) =>
                setChargerId(e.target.value)}
              onBlur={() => {
                // Save on blur, not per keystroke — the id gates the WS
                // route allowlist and half-typed ids must never hit the DB
                // (same local-state-then-save pattern as the other plugins).
                const trimmed = (chargerId ?? "").trim();
                if (trimmed && trimmed !== config?.ocppChargerId) {
                  saveMutation.mutate({ ocppChargerId: trimmed });
                }
              }}
            />
          </SettingsRow>
          <Text size="2">
            Enter this URL in your charger's OCPP settings (its app or web
            portal), then wait — the charger connects to ChargeHA:
          </Text>
          <Code size="2">{wsUrl}</Code>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {connectionBadge(connected, status.data?.info)}
          </div>
        </div>
      ),
    };
  },
};
