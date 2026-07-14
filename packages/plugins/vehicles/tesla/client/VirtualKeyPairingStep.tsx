import { useMemo, useState } from "react";
import { Button, Callout, Text } from "@radix-ui/themes";
import { AlertCircle, CheckCircle, Loader2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import type { VehicleWithState } from "@chargeha/shared";
import { trpc } from "./trpc.ts";
import { useTeslaConfig } from "./useTeslaConfig.ts";
import type { StepProps } from "../../../../client/src/components/Wizard/WizardShell.tsx";
import { useWizardNextControl } from "../../../../client/src/components/Wizard/wizardNextControl.ts";
import styles from "../../../../client/src/components/Wizard/steps/steps.module.css";

function parseHostname(domain: string): string {
  try {
    return new URL(domain).hostname;
  } catch {
    return domain;
  }
}

function getPairingUrl(domain: string): string {
  const hostname = parseHostname(domain);
  return hostname ? `https://tesla.com/_ak/${hostname}` : "";
}

function deriveVerifyError(
  verifyMutation: ReturnType<typeof trpc.tesla.checkKeyPairing.useMutation>,
): string | null | undefined {
  const notPairedMessage = verifyMutation.data?.error ||
    "Virtual key not yet paired. Please complete the pairing steps first.";
  const resultError = (verifyMutation.data && !verifyMutation.data.paired)
    ? notPairedMessage
    : null;
  return verifyMutation.error?.message ?? resultError;
}

function PairingUrlDisplay({ pairingUrl }: { pairingUrl: string }) {
  return (
    <>
      <Text as="p" size="2" weight="medium">Pairing URL</Text>
      <div className={styles.copyRow}>
        <code className={styles.codeSnippet}>{pairingUrl}</code>
      </div>
      <div className={styles.qrCodeContainer} data-testid="qr-code">
        <QRCodeSVG value={pairingUrl} size={200} />
      </div>
    </>
  );
}

function PairingInstructions() {
  return (
    <div className={styles.instructionBox}>
      <Text as="p" size="2" weight="medium">Instructions:</Text>
      <ol className={styles.instructionList}>
        <li>
          <Text size="2">
            Open the pairing URL on your phone while near the vehicle
          </Text>
        </li>
        <li>
          <Text size="2">
            Approve the virtual key in the Tesla app when prompted
          </Text>
        </li>
        <li>
          <Text size="2">
            Confirm on the vehicle's center screen by tapping the key card on
            the center console
          </Text>
        </li>
      </ol>
    </div>
  );
}

export function VirtualKeyPairingStep(_props: StepProps): JSX.Element {
  const [verified, setVerified] = useState(false);

  const {
    data: vehiclesData,
    isLoading: vehiclesLoading,
    error: vehiclesError,
  } = trpc.vehicle.list.useQuery();
  const vehicles = useMemo(
    () => (vehiclesData?.vehicles ?? []) as VehicleWithState[],
    [vehiclesData],
  );

  const {
    data: teslaConfig,
    isLoading: configLoading,
    error: configError,
  } = useTeslaConfig();

  const verifyMutation = trpc.tesla.checkKeyPairing.useMutation({
    onSuccess: (result: { paired: boolean | null; error?: string }) => {
      if (result.paired) {
        setVerified(true);
      }
    },
  });

  const loading = vehiclesLoading || configLoading;
  const queryError = vehiclesError ?? configError;

  useWizardNextControl({
    canProceed: verified,
    hint: verified
      ? "Virtual key paired — Next continues"
      : "Pair and verify the virtual key to continue",
  });

  const domain = teslaConfig?.teslaPublicKeyDomain ||
    (typeof globalThis !== "undefined" ? globalThis.location.origin : "");
  const pairingUrl = getPairingUrl(domain);

  const error = queryError?.message ?? deriveVerifyError(verifyMutation);

  if (loading) {
    return (
      <div className={styles.stepContainer}>
        <Callout.Root color="blue">
          <Callout.Icon>
            <Loader2 size={16} className={styles.spinner} />
          </Callout.Icon>
          <Callout.Text>Loading vehicle data...</Callout.Text>
        </Callout.Root>
      </div>
    );
  }

  return (
    <div className={styles.stepContainer}>
      <Text as="p" size="3" color="gray">
        A virtual key allows ChargeHA to send commands to your vehicle. Complete
        the pairing for each vehicle below.
      </Text>

      {vehicles.map((vehicle) => (
        <div key={vehicle.id} className={styles.instructionBox}>
          <Text weight="medium" size="3">{vehicle.name}</Text>
          <Text as="p" size="1" color="gray">VIN: {vehicle.id}</Text>
        </div>
      ))}

      {pairingUrl && <PairingUrlDisplay pairingUrl={pairingUrl} />}

      <PairingInstructions />

      <div className={styles.verifyRow}>
        <Button
          variant="soft"
          onClick={() => verifyMutation.mutate()}
          disabled={verifyMutation.isPending}
        >
          {verifyMutation.isPending && (
            <Loader2 size={16} className={styles.spinner} />
          )}
          {verifyMutation.isPending ? "Verifying..." : "Verify Pairing"}
        </Button>
      </div>

      {verified && (
        <Callout.Root color="green">
          <Callout.Icon>
            <CheckCircle size={16} />
          </Callout.Icon>
          <Callout.Text>Virtual key paired successfully!</Callout.Text>
        </Callout.Root>
      )}

      {error && (
        <Callout.Root color="red">
          <Callout.Icon>
            <AlertCircle size={16} />
          </Callout.Icon>
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      )}
    </div>
  );
}
