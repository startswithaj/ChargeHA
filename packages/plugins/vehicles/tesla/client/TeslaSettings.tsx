import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle, ExternalLink, Key } from "lucide-react";
import { Badge, Button, Card, Code, Text } from "@radix-ui/themes";
import type { VehicleWithState } from "@chargeha/shared";
import { trpc } from "./trpc.ts";
import { Spinner } from "../../../../client/src/components/ui/Spinner.tsx";
import { ErrorBanner } from "../../../../client/src/components/ui/ErrorBanner.tsx";
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

function DisconnectBlock(
  { handleDisconnect }: { handleDisconnect: () => void },
) {
  return (
    <div
      style={{
        marginTop: 12,
        paddingTop: 12,
        borderTop: "1px solid var(--gray-a4)",
      }}
    >
      <Button size="1" variant="soft" color="red" onClick={handleDisconnect}>
        Disconnect Tesla
      </Button>
      <Text size="1" color="gray" style={{ marginLeft: 8 }}>
        Clears tokens and removes Tesla vehicles. You can reconnect to
        re-authorize with updated permissions.
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

function KeyPairingBlock(
  {
    keyPaired,
    pairingChecking,
    proxyDown,
    teslaDomain,
    origin,
    handleCheckPairing,
  }: {
    keyPaired: boolean | null;
    pairingChecking: boolean;
    proxyDown: boolean;
    teslaDomain: string | null | undefined;
    origin: string;
    handleCheckPairing: () => void;
  },
) {
  const pairingDomain = teslaDomain ?? origin.replace(/^https?:\/\//, "");
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
              Open this link on your phone while near the vehicle:{" "}
              <a
                href={`https://tesla.com/_ak/${pairingDomain}`}
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--accent-11)", wordBreak: "break-all" }}
              >
                tesla.com/_ak/{pairingDomain}
              </a>
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

function useTeslaSettingsState() {
  const utils = trpc.useUtils();
  const origin = globalThis.location?.origin ?? "http://localhost:5175";
  const redirectUri = `${origin}/api/vehicle/tesla/callback`;
  const [polling, setPolling] = useState(false);

  const teslaAuthQuery = trpc.tesla.teslaStatus.useQuery(undefined, {
    refetchInterval: polling ? 3000 : false,
  });
  const teslaVehiclesQuery = trpc.tesla.teslaVehicles.useQuery(undefined, {
    enabled: teslaAuthQuery.data?.authenticated === true,
    select: (data: { vehicles: Array<{ vin: string; name: string }> }) =>
      data.vehicles,
  });
  const vehiclesQuery = trpc.vehicle.list.useQuery(undefined, {
    select: (data: { vehicles: VehicleWithState[] }) => data.vehicles,
  });
  const pluginWarningsQuery = trpc.health.pluginWarnings.useQuery();

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
    pluginWarningsQuery,
  };
}

function useTeslaSettingsMutations(
  { utils, setPolling }: {
    utils: ReturnType<typeof trpc.useUtils>;
    setPolling: (b: boolean) => void;
  },
) {
  const connectMutation = trpc.tesla.getAuthUrl.useMutation({
    onSuccess: ({ url }: { url: string }) => {
      globalThis.open(url, "_blank");
      setPolling(true);
    },
  });
  const autoAddVehiclesMutation = useMutation({
    mutationFn: async () => {
      const result = await utils.client.tesla.teslaVehicles.query();
      const teslaList = result.vehicles;
      utils.tesla.teslaVehicles.setData(undefined, { vehicles: teslaList });
      const vehicleData = utils.vehicle.list.getData();
      const currentVehicles = vehicleData?.vehicles ?? [];
      const existingVins = new Set(
        currentVehicles.map((v: VehicleWithState) => v.id),
      );
      await teslaList
        .filter((tv) => !existingVins.has(tv.vin))
        .reduce(
          (chain, tv) =>
            chain.then(() =>
              utils.client.tesla.selectVehicle.mutate({
                vin: tv.vin,
                name: tv.name,
              })
            ),
          Promise.resolve() as Promise<unknown>,
        );
    },
    onSuccess: () => {
      utils.vehicle.list.invalidate();
      utils.tesla.teslaVehicles.invalidate();
    },
    onError: () => {
      console.error("[TeslaSettings] Auto-add vehicles failed");
      utils.vehicle.list.invalidate();
      utils.tesla.teslaVehicles.invalidate();
    },
  });
  const addTeslaVehicleMutation = trpc.tesla.selectVehicle.useMutation({
    onSuccess: () => {
      utils.vehicle.list.invalidate();
      utils.tesla.teslaVehicles.invalidate();
    },
  });
  const disconnectMutation = trpc.tesla.disconnect.useMutation({
    onSuccess: () => {
      utils.tesla.teslaStatus.setData(undefined, {
        authenticated: false,
        vehicleConfigured: false,
        vin: null,
        vehicleName: null,
        keyPaired: null,
        domain: null,
      });
      utils.tesla.teslaVehicles.setData(undefined, { vehicles: [] });
      utils.vehicle.list.invalidate();
    },
  });
  const checkPairingMutation = trpc.tesla.checkKeyPairing.useMutation({
    onSuccess: ({ paired }) => {
      utils.tesla.teslaStatus.setData(
        undefined,
        (old) => old ? { ...old, keyPaired: paired } : old,
      );
    },
  });
  return {
    connectMutation,
    autoAddVehiclesMutation,
    addTeslaVehicleMutation,
    disconnectMutation,
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
    pluginWarningsQuery,
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
    disconnectMutation,
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
  const handleDisconnect = () => disconnectMutation.mutate();
  const handleCheckPairing = () => checkPairingMutation.mutate();

  const pairingChecking = checkPairingMutation.isPending;
  const proxyDown = (pluginWarningsQuery.data ?? []).length > 0;

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
          teslaDomain={teslaAuth?.domain}
          origin={origin}
          handleCheckPairing={handleCheckPairing}
        />
      )}

      {teslaAvailable && teslaAuth?.authenticated && (
        <DisconnectBlock handleDisconnect={handleDisconnect} />
      )}
    </div>
  );
}
