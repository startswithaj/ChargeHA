import { useMemo, useState } from "react";
import { Button, Callout, Text } from "@radix-ui/themes";
import { AlertCircle, CheckCircle, Loader2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { trpc } from "./trpc.ts";
import { useTeslaConfig } from "./useTeslaConfig.ts";
import {
  type PublicKeyHosting,
  resolvePublicKeyDomain,
} from "../shared/publicKeyDomain.ts";
import {
  advanceOnly,
  type PluginStepDef,
  stepStyles as styles,
  type WizardNext,
} from "../../../hostUi.ts";

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

/** Pairing URL for the resolved key domain, or "" when the domain rides the
 *  tunnel and the tunnel is down (pairing is impossible then). */
function computePairingUrl(
  hosting: PublicKeyHosting,
  savedDomain: string | null,
  tunnelUrl: string | null,
): { pairingUrl: string; tunnelDown: boolean } {
  const tunnelDown = hosting === "tunnel" && !tunnelUrl;
  const domain = resolvePublicKeyDomain(hosting, savedDomain, tunnelUrl) ??
    globalThis.location?.origin ?? "";
  return { pairingUrl: tunnelDown ? "" : getPairingUrl(domain), tunnelDown };
}

function LoadingView() {
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

function TunnelDownCallout() {
  return (
    <Callout.Root color="red">
      <Callout.Text>
        The tunnel is not running. Pairing needs the tunnel up for the whole
        process — if it stopped since partner registration, restart it on the
        hosting step and re-run registration (the tunnel URL changes on every
        start).
      </Callout.Text>
    </Callout.Root>
  );
}

function deriveVerifyError(
  verifyMutation: ReturnType<
    typeof trpc.plugin.vehicle.tesla.checkKeyPairing.useMutation
  >,
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

export const virtualKeyPairingStep: PluginStepDef = {
  id: "tesla-virtual-key-pairing",
  label: "Virtual Key Pairing",
  useStep: () => {
    const pairing = useVirtualKeyPairing();
    return {
      next: pairingNext(pairing.loading, pairing.verified),
      view: pairing.loading
        ? <LoadingView />
        : <VirtualKeyPairingView {...pairing} />,
    };
  },
};

function pairingNext(loading: boolean, verified: boolean): WizardNext {
  if (verified) {
    return {
      kind: "ready",
      hint: "Virtual key paired — Next continues",
      onNext: advanceOnly,
    };
  }
  if (loading) return { kind: "loading" };
  return {
    kind: "blocked",
    reason: "Pair and verify the virtual key to continue",
  };
}

function useVirtualKeyPairing() {
  const [verified, setVerified] = useState(false);

  const {
    data: vehiclesData,
    isLoading: vehiclesLoading,
    error: vehiclesError,
  } = trpc.plugin.vehicle.tesla.listVehicles.useQuery();
  const vehicles = useMemo(
    () => vehiclesData?.vehicles ?? [],
    [vehiclesData],
  );

  const {
    data: teslaConfig,
    isLoading: configLoading,
    error: configError,
  } = useTeslaConfig();

  const tunnelStatus = trpc.plugin.vehicle.tesla.tunnelStatus.useQuery();

  const verifyMutation = trpc.plugin.vehicle.tesla.checkKeyPairing.useMutation({
    onSuccess: (result: { paired: boolean | null; error?: string }) => {
      if (result.paired) {
        setVerified(true);
      }
    },
  });

  const queryError = vehiclesError ?? configError;

  const { pairingUrl, tunnelDown } = computePairingUrl(
    teslaConfig?.teslaPublicKeyHosting ?? "",
    teslaConfig?.teslaPublicKeyDomain ?? null,
    tunnelStatus.data?.url ?? null,
  );

  return {
    verified,
    loading: vehiclesLoading || configLoading,
    vehicles,
    pairingUrl,
    tunnelDown,
    verifying: verifyMutation.isPending,
    verify: () => verifyMutation.mutate(),
    error: queryError?.message ?? deriveVerifyError(verifyMutation),
  };
}

function VirtualKeyPairingView(
  { verified, vehicles, pairingUrl, tunnelDown, verifying, verify, error }:
    ReturnType<typeof useVirtualKeyPairing>,
) {
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

      {tunnelDown && <TunnelDownCallout />}

      {pairingUrl && <PairingUrlDisplay pairingUrl={pairingUrl} />}

      <PairingInstructions />

      <div className={styles.verifyRow}>
        <Button variant="soft" onClick={verify} disabled={verifying}>
          {verifying && <Loader2 size={16} className={styles.spinner} />}
          {verifying ? "Verifying..." : "Verify Pairing"}
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
