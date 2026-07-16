import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle, ExternalLink, Key } from "lucide-react";
import { AlertDialog, Badge, Button, Card, Code, Text } from "@radix-ui/themes";
import type { VehicleWithState } from "@chargeha/shared";
import { trpc } from "./trpc.ts";
import {
  type PublicKeyHosting,
  resolvePublicKeyDomain,
} from "../shared/publicKeyDomain.ts";
import { Spinner } from "../../../hostUi.ts";
import { ErrorBanner } from "../../../hostUi.ts";
import { useInvalidateVehiclePlugins } from "../../../hostUi.ts";
import { TeslaSetupInstructions } from "./TeslaSetupInstructions.tsx";

function useTransitionToAdd(
  { polling, setPolling, teslaAuthQuery, autoAddVehiclesMutation }: {
    polling: boolean;
    setPolling: (b: boolean) => void;
    teslaAuthQuery: { data?: { authenticated?: boolean } };
    autoAddVehiclesMutation: { mutate: () => void };
  },
) {
  useEffect(() => {
    if (polling && teslaAuthQuery.data?.authenticated) {
      setPolling(false);
      autoAddVehiclesMutation.mutate();
    }
  }, [polling, teslaAuthQuery.data?.authenticated]);
}

function TeslaHeader(
  { teslaAvailable, authenticated }: {
    teslaAvailable: boolean;
    authenticated: boolean;
  },
) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 8,
      }}
    >
      <Text size="2" weight="medium">Tesla</Text>
      {teslaAvailable && authenticated && (
        <Badge color="green" size="1">Connected</Badge>
      )}
      {teslaAvailable && !authenticated && (
        <Badge color="orange" size="1">Not authenticated</Badge>
      )}
      {!teslaAvailable && <Badge color="gray" size="1">Not configured</Badge>}
    </div>
  );
}

function ResetBlock(
  { handleReset, resetting }: {
    handleReset: () => void;
    resetting: boolean;
  },
) {
  return (
    <div
      style={{
        marginTop: 12,
        paddingTop: 12,
        borderTop: "1px solid var(--gray-a4)",
      }}
    >
      <AlertDialog.Root>
        <AlertDialog.Trigger>
          <Button size="1" variant="soft" color="red" disabled={resetting}>
            Reset Tesla Setup
          </Button>
        </AlertDialog.Trigger>
        <AlertDialog.Content maxWidth="420px">
          <AlertDialog.Title>Reset Tesla setup?</AlertDialog.Title>
          <AlertDialog.Description size="2">
            All current Tesla settings will be erased and onboarding will start
            fresh.
          </AlertDialog.Description>
          <div
            style={{
              display: "flex",
              gap: 12,
              marginTop: 16,
              justifyContent: "flex-end",
            }}
          >
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">Cancel</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button color="red" onClick={handleReset}>
                Erase and start fresh
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Root>
      <Text size="1" color="gray" style={{ marginLeft: 8 }}>
        Erases all Tesla credentials, keys, and vehicles so you can set up Tesla
        again from scratch.
      </Text>
    </div>
  );
}

function ProxyDownBanner() {
  return (
    <Card style={{ borderLeft: "3px solid var(--orange-9)", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <AlertTriangle
          size={20}
          style={{ color: "var(--orange-9)", flexShrink: 0 }}
        />
        <div>
          <Text size="2" weight="bold" style={{ display: "block" }}>
            Tesla Proxy Unreachable
          </Text>
          <Text size="2" color="gray">
            Vehicle commands will fail. Make sure <code>tesla-http-proxy</code>
            {" "}
            is running on port 4443.
          </Text>
        </div>
      </div>
    </Card>
  );
}

function AuthorizeBlock(
  { polling, redirectUri, handleConnect }: {
    polling: boolean;
    redirectUri: string;
    handleConnect: () => void;
  },
) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {polling && (
        <Text size="2" color="gray">
          Waiting for Tesla authorization... complete the sign-in in the other
          tab.
        </Text>
      )}
      {!polling && (
        <>
          <Text size="1" color="gray">
            Redirect URI: <Code size="1">{redirectUri}</Code>
          </Text>
          <div>
            <Button size="2" onClick={handleConnect}>
              <ExternalLink size={14} />
              Authorize with Tesla
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function TeslaVehiclesList(
  { teslaVehicles, vehicles, handleAddTeslaVehicle }: {
    teslaVehicles: { vin: string; name: string }[];
    vehicles: VehicleWithState[];
    handleAddTeslaVehicle: (vin: string, name: string) => void;
  },
) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {teslaVehicles.map((v) => {
        const alreadyAdded = vehicles.some((cv) => cv.id === v.vin);
        return (
          <div
            key={v.vin}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "6px 10px",
              borderRadius: 6,
              background: "var(--gray-a2)",
            }}
          >
            <div>
              <Text size="2" weight="medium">{v.name}</Text>
              <Text size="1" color="gray" style={{ display: "block" }}>
                {v.vin}
              </Text>
            </div>
            {alreadyAdded && <Badge color="green" size="1">Added</Badge>}
            {!alreadyAdded && (
              <Button
                size="1"
                variant="soft"
                onClick={() => handleAddTeslaVehicle(v.vin, v.name)}
              >
                Add
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PairingLinkStep({ pairingDomain }: { pairingDomain: string | null }) {
  if (!pairingDomain) {
    return (
      <>
        Your key domain rode the Cloudflare tunnel, which is no longer running —
        restart the setup wizard to start a new tunnel and re-run partner
        registration before pairing.
      </>
    );
  }
  return (
    <>
      Open this link on your phone while near the vehicle:{" "}
      <a
        href={`https://tesla.com/_ak/${pairingDomain}`}
        target="_blank"
        rel="noreferrer"
        style={{ color: "var(--accent-11)", wordBreak: "break-all" }}
      >
        tesla.com/_ak/{pairingDomain}
      </a>
    </>
  );
}

function KeyPairingBlock(
  {
    keyPaired,
    pairingChecking,
    proxyDown,
    pairingDomain,
    handleCheckPairing,
  }: {
    keyPaired: boolean | null;
    pairingChecking: boolean;
    proxyDown: boolean;
    /** Resolved key domain — null when it rode the tunnel and the tunnel is
     *  gone, in which case there is no valid pairing link to show. */
    pairingDomain: string | null;
    handleCheckPairing: () => void;
  },
) {
  return (
    <div
      style={{
        marginTop: 12,
        paddingTop: 12,
        borderTop: "1px solid var(--gray-a4)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <Key size={14} />
        <Text size="2" weight="medium">Vehicle Key Pairing</Text>
        {keyPaired === true && <Badge color="green" size="1">Paired</Badge>}
        {keyPaired === false && <Badge color="red" size="1">Not Paired</Badge>}
      </div>

      {keyPaired === false && (
        <ErrorBanner
          title="Your public key needs to be paired with the vehicle"
          description="Vehicle commands won't work until you approve the key on your vehicle's touchscreen. Follow these steps:"
        >
          <ol
            style={{
              margin: 0,
              paddingLeft: 20,
              fontSize: 13,
              color: "var(--gray-11)",
            }}
          >
            <li style={{ marginBottom: 4 }}>
              <PairingLinkStep pairingDomain={pairingDomain} />
            </li>
            <li style={{ marginBottom: 4 }}>
              The Tesla app will open and ask you to approve a third-party key
              <span>— tap</span>
              <strong>Approve</strong>.
            </li>
            <li style={{ marginBottom: 4 }}>
              On the vehicle's touchscreen, confirm the key card tap when
              prompted.
            </li>
          </ol>
          <Button
            size="1"
            variant="soft"
            style={{ alignSelf: "flex-start", marginTop: 4 }}
            disabled={pairingChecking}
            onClick={handleCheckPairing}
          >
            {pairingChecking ? <Spinner /> : <CheckCircle size={14} />}
            {pairingChecking ? "Checking..." : "Re-check Pairing"}
          </Button>
        </ErrorBanner>
      )}

      {keyPaired === true && (
        <Text size="1" color="gray">
          Your public key is paired with the vehicle. Commands are working.
        </Text>
      )}

      {keyPaired === null && !proxyDown && (
        <Button
          size="1"
          variant="soft"
          disabled={pairingChecking}
          onClick={handleCheckPairing}
        >
          {pairingChecking ? <Spinner /> : <Key size={14} />}
          {pairingChecking ? "Checking..." : "Check Key Pairing"}
        </Button>
      )}
    </div>
  );
}

/** Key domain for re-pairing, resolved live — null when it rode the tunnel
 *  and the tunnel is gone (re-pairing then needs a fresh tunnel session). */
function usePairingDomain(): string | null {
  const { data: teslaConfig } = trpc.plugin.vehicle.tesla.getConfig.useQuery();
  const tunnelStatus = trpc.plugin.vehicle.tesla.tunnelStatus.useQuery();
  const resolved = resolvePublicKeyDomain(
    (teslaConfig?.teslaPublicKeyHosting ?? "") as PublicKeyHosting,
    teslaConfig?.teslaPublicKeyDomain ?? null,
    tunnelStatus.data?.url ?? null,
  );
  // The tesla.com/_ak/ pairing link wants a bare hostname, not a URL.
  return resolved?.replace(/^https?:\/\//, "") ?? null;
}

function useTeslaSettingsState() {
  const utils = trpc.useUtils();
  const origin = globalThis.location?.origin ?? "http://localhost:5175";
  const redirectUri = `${origin}/api/vehicle/tesla/callback`;
  const [polling, setPolling] = useState(false);

  const teslaAuthQuery = trpc.plugin.vehicle.tesla.teslaStatus.useQuery(
    undefined,
    {
      refetchInterval: polling ? 3000 : false,
    },
  );
  const teslaVehiclesQuery = trpc.plugin.vehicle.tesla.teslaVehicles.useQuery(
    undefined,
    {
      enabled: teslaAuthQuery.data?.authenticated === true,
      select: (data: { vehicles: Array<{ vin: string; name: string }> }) =>
        data.vehicles,
    },
  );
  const vehiclesQuery = trpc.plugin.vehicle.tesla.listVehicles.useQuery(
    undefined,
    {
      select: (data: { vehicles: VehicleWithState[] }) => data.vehicles,
    },
  );
  const proxyHealthQuery = trpc.plugin.vehicle.tesla.proxyHealth.useQuery();

  useEffect(() => {
    if (!polling) return;
    const timeout = setTimeout(() => setPolling(false), 5 * 60 * 1000);
    return () => clearTimeout(timeout);
  }, [polling]);

  return {
    utils,
    origin,
    redirectUri,
    polling,
    setPolling,
    teslaAuthQuery,
    teslaVehiclesQuery,
    vehiclesQuery,
    proxyHealthQuery,
  };
}

function useTeslaSettingsMutations(
  { utils, setPolling }: {
    utils: ReturnType<typeof trpc.useUtils>;
    setPolling: (b: boolean) => void;
  },
) {
  const invalidateVehiclePlugins = useInvalidateVehiclePlugins();
  const connectMutation = trpc.plugin.vehicle.tesla.getAuthUrl.useMutation({
    onSuccess: ({ url }: { url: string }) => {
      globalThis.open(url, "_blank");
      setPolling(true);
    },
  });
  const autoAddVehiclesMutation = useMutation({
    mutationFn: async () => {
      const result = await utils.client.plugin.vehicle.tesla.teslaVehicles
        .query();
      const teslaList = result.vehicles;
      utils.plugin.vehicle.tesla.teslaVehicles.setData(undefined, {
        vehicles: teslaList,
      });
      const vehicleData = utils.plugin.vehicle.tesla.listVehicles.getData();
      const currentVehicles = vehicleData?.vehicles ?? [];
      const existingVins = new Set(
        currentVehicles.map((v: VehicleWithState) => v.id),
      );
      const newVehicles = teslaList.filter((tv) => !existingVins.has(tv.vin));
      if (newVehicles.length > 0) {
        await utils.client.plugin.vehicle.tesla.selectVehicles.mutate({
          vehicles: newVehicles.map((tv, idx) => ({
            vin: tv.vin,
            name: tv.name,
            priority: currentVehicles.length + idx + 1,
          })),
        });
      }
    },
    onSuccess: () => {
      utils.plugin.vehicle.tesla.listVehicles.invalidate();
      utils.plugin.vehicle.tesla.teslaVehicles.invalidate();
    },
    onError: () => {
      console.error("[TeslaSettings] Auto-add vehicles failed");
      utils.plugin.vehicle.tesla.listVehicles.invalidate();
      utils.plugin.vehicle.tesla.teslaVehicles.invalidate();
    },
  });
  const addTeslaVehicleMutation = trpc.plugin.vehicle.tesla.selectVehicle
    .useMutation({
      onSuccess: () => {
        utils.plugin.vehicle.tesla.listVehicles.invalidate();
        utils.plugin.vehicle.tesla.teslaVehicles.invalidate();
      },
    });
  const resetMutation = trpc.plugin.vehicle.tesla.resetOnboarding.useMutation({
    onSuccess: () => {
      // Config + vehicles are gone: flip the plugin back to "not configured"
      // so the "+ Set up Tesla" onboarding card reappears in Vehicle settings.
      invalidateVehiclePlugins();
      utils.plugin.vehicle.tesla.teslaStatus.invalidate();
      utils.plugin.vehicle.tesla.teslaVehicles.invalidate();
      utils.plugin.vehicle.tesla.listVehicles.invalidate();
    },
  });
  const checkPairingMutation = trpc.plugin.vehicle.tesla.checkKeyPairing
    .useMutation({
      onSuccess: ({ paired }) => {
        utils.plugin.vehicle.tesla.teslaStatus.setData(
          undefined,
          (old) => old ? { ...old, keyPaired: paired } : old,
        );
      },
    });
  return {
    connectMutation,
    autoAddVehiclesMutation,
    addTeslaVehicleMutation,
    resetMutation,
    checkPairingMutation,
  };
}

export function TeslaSettings(): JSX.Element {
  const state = useTeslaSettingsState();
  const {
    utils,
    origin,
    redirectUri,
    polling,
    setPolling,
    teslaAuthQuery,
    teslaVehiclesQuery,
    vehiclesQuery,
    proxyHealthQuery,
  } = state;

  const teslaAuth = teslaAuthQuery.data ?? null;
  const teslaAvailable = teslaAuthQuery.isSuccess;
  const teslaVehicles = teslaVehiclesQuery.data ?? [];
  const vehicles = vehiclesQuery.data ?? [];
  const keyPaired = teslaAuth?.keyPaired ?? null;

  const {
    connectMutation,
    autoAddVehiclesMutation,
    addTeslaVehicleMutation,
    resetMutation,
    checkPairingMutation,
  } = useTeslaSettingsMutations({ utils, setPolling });

  useTransitionToAdd({
    polling,
    setPolling,
    teslaAuthQuery,
    autoAddVehiclesMutation,
  });

  const handleConnect = () =>
    connectMutation.mutate({ origin: globalThis.location.origin });
  const handleAddTeslaVehicle = (vin: string, name: string) =>
    addTeslaVehicleMutation.mutate({ vin, name });
  const handleCheckPairing = () => checkPairingMutation.mutate();
  const pairingChecking = checkPairingMutation.isPending;
  const proxyDown = (proxyHealthQuery.data?.warnings ?? []).length > 0;
  const pairingDomain = usePairingDomain();

  return (
    <div
      style={{
        marginTop: 12,
        paddingTop: 12,
        borderTop: "1px solid var(--gray-a4)",
      }}
    >
      {proxyDown && <ProxyDownBanner />}

      <TeslaHeader
        teslaAvailable={teslaAvailable}
        authenticated={!!teslaAuth?.authenticated}
      />

      {!teslaAvailable && (
        <TeslaSetupInstructions origin={origin} redirectUri={redirectUri} />
      )}

      {teslaAvailable && !teslaAuth?.authenticated && (
        <AuthorizeBlock
          polling={polling}
          redirectUri={redirectUri}
          handleConnect={handleConnect}
        />
      )}

      {teslaAvailable && teslaAuth?.authenticated &&
        teslaVehicles.length > 0 && (
        <TeslaVehiclesList
          teslaVehicles={teslaVehicles}
          vehicles={vehicles}
          handleAddTeslaVehicle={handleAddTeslaVehicle}
        />
      )}

      {teslaAvailable && teslaAuth?.authenticated &&
        teslaVehicles.length === 0 &&
        vehicles.filter((v: VehicleWithState) => v.adapterType === "tesla")
            .length === 0 &&
        (
          <Text size="2" color="gray">
            No vehicles found on your Tesla account.
          </Text>
        )}

      {teslaAvailable && teslaAuth?.authenticated &&
        vehicles.some((v: VehicleWithState) => v.adapterType === "tesla") && (
        <KeyPairingBlock
          keyPaired={keyPaired}
          pairingChecking={pairingChecking}
          proxyDown={proxyDown}
          pairingDomain={pairingDomain}
          handleCheckPairing={handleCheckPairing}
        />
      )}

      {teslaAvailable && (
        <ResetBlock
          handleReset={() => resetMutation.mutate()}
          resetting={resetMutation.isPending}
        />
      )}
    </div>
  );
}
