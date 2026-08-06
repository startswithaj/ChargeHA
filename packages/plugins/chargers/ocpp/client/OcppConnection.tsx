import { Callout, Code, Text } from "@radix-ui/themes";
import { Wrench } from "lucide-react";
import { CHARGER_ID_PLACEHOLDER } from "./fields.ts";

/** Base URL the charger connects to. The charge point id is a separate field
 *  on most chargers, so it is given separately rather than only baked into a
 *  combined URL. */
export function ocppServerUrl(): string {
  const port = globalThis.location.port ? `:${globalThis.location.port}` : "";
  return `ws://${globalThis.location.hostname}${port}/api/charger/ocpp`;
}

const stepGrid = {
  display: "grid",
  gridTemplateColumns: "auto 1fr",
  gap: "8px 10px",
  alignItems: "baseline",
  marginTop: 10,
} as const;

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <>
      <Text size="2" weight="bold">{n}.</Text>
      <Text size="2" as="div">{children}</Text>
    </>
  );
}

/** These are actions the user carries out on the charger itself, not settings
 *  ChargeHA applies — so they read as a callout, not as more config rows. */
export function OcppConnectionDetails({ chargerId }: { chargerId: string }) {
  const base = ocppServerUrl();
  const id = chargerId || CHARGER_ID_PLACEHOLDER;
  return (
    <Callout.Root color="blue" size="1">
      <Callout.Icon>
        <Wrench size={16} />
      </Callout.Icon>
      <Callout.Text>
        <Text size="2" weight="bold">Now set up the charger itself</Text>
        <div style={stepGrid}>
          <Step n={1}>
            Open your charger's own app or web portal and find its OCPP
            settings.
          </Step>
          <Step n={2}>
            Set the server URL to <Code size="2">{base}</Code>
          </Step>
          <Step n={3}>
            Set the charge point ID to <Code size="2">{id}</Code>{" "}
            — it must match exactly.
          </Step>
          <Step n={4}>
            Save on the charger, then wait here — it connects to ChargeHA over
            your LAN.
          </Step>
        </div>
        <Text size="1" color="gray" style={{ display: "block", marginTop: 10 }}>
          If your charger has only one URL field, use{" "}
          <Code size="1">{`${base}/${id}`}</Code>{" "}
          instead — some chargers append the charge point id for you, others
          expect it in the URL.
        </Text>
      </Callout.Text>
    </Callout.Root>
  );
}
