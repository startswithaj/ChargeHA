import { useMemo, useState } from "react";
import {
  Button,
  Code,
  SegmentedControl,
  Separator,
  Text,
  TextField,
} from "@radix-ui/themes";
import { Loader2 } from "lucide-react";
import { trpc } from "./trpc.ts";
import { NetworkDeviceSearch, useDefaultSubnet } from "../../../hostUi.ts";
import { stepStyles as styles } from "../../../hostUi.ts";
import { TestResultBadge, type TestStatus } from "../../../hostUi.ts";
import type { EnphaseDevice } from "../../InverterSetupShared.tsx";

export interface EnphaseLocalFormValues {
  host: string;
  email: string;
  password: string;
  token: string;
}

interface EnphaseLocalFormProps {
  initial: EnphaseLocalFormValues;
  onTestSuccess: (values: EnphaseLocalFormValues) => void;
}

function LabelledField(
  { label, help, value, onChange, type, placeholder }: {
    label: string;
    help?: string;
    value: string;
    onChange: (v: string) => void;
    type?: string;
    placeholder?: string;
  },
) {
  return (
    <div className={styles.fieldGroup}>
      <Text as="label" size="2" weight="medium">{label}</Text>
      {help && <Text size="1" color="gray">{help}</Text>}
      <TextField.Root
        size="2"
        type={type as "text" | "password" | undefined}
        placeholder={placeholder}
        value={value}
        onChange={(e: { target: { value: string } }) =>
          onChange(e.target.value)}
        aria-label={label}
      />
    </div>
  );
}

function SearchSection(
  {
    subnet,
    setSubnet,
    detectedSubnets,
    searchMutation,
    searchResults,
    onSelectDevice,
  }: {
    subnet: string;
    setSubnet: (v: string) => void;
    detectedSubnets?: string[];
    searchMutation: ReturnType<
      typeof trpc.plugin.energy.enphase_local.discover.useMutation
    >;
    searchResults: EnphaseDevice[];
    onSelectDevice: (device: EnphaseDevice) => void;
  },
) {
  return (
    <>
      <NetworkDeviceSearch
        deviceNoun="Envoy gateways"
        subnet={subnet}
        onSubnetChange={setSubnet}
        detectedSubnets={detectedSubnets}
        onSearch={() => searchMutation.mutate({ subnet: subnet || undefined })}
        isPending={searchMutation.isPending}
        searched={searchMutation.isSuccess}
        results={searchResults}
        onUse={onSelectDevice}
        emptyMessage={
          <>
            No Envoy found. Try entering your subnet above (check your router
            settings or run <Code size="1">ifconfig</Code>).
          </>
        }
      />
    </>
  );
}

function useTestStatus(
  testMutation: ReturnType<
    typeof trpc.plugin.energy.enphase_local.testConnection.useMutation
  >,
): TestStatus {
  return useMemo(() => {
    if (testMutation.isPending) return { status: "testing" };
    if (testMutation.isSuccess && testMutation.data.success) {
      return { status: "success", detail: testMutation.data.device?.name };
    }
    if (testMutation.isSuccess && !testMutation.data.success) {
      return {
        status: "error",
        message: testMutation.data.error ?? "Connection failed",
      };
    }
    if (testMutation.isError) {
      return { status: "error", message: testMutation.error.message };
    }
    return { status: "idle" };
  }, [
    testMutation.isPending,
    testMutation.isSuccess,
    testMutation.isError,
    testMutation.data,
    testMutation.error,
  ]);
}

export type AuthMethod = "credentials" | "token";

function AuthFields(
  {
    method,
    setMethod,
    email,
    setEmail,
    password,
    setPassword,
    token,
    setToken,
  }: {
    method: AuthMethod;
    setMethod: (v: AuthMethod) => void;
    email: string;
    setEmail: (v: string) => void;
    password: string;
    setPassword: (v: string) => void;
    token: string;
    setToken: (v: string) => void;
  },
) {
  return (
    <>
      <div className={styles.fieldGroup}>
        <Text as="label" size="2" weight="medium">Authentication</Text>
        <SegmentedControl.Root
          value={method}
          onValueChange={(v: string) => setMethod(v as AuthMethod)}
        >
          <SegmentedControl.Item value="credentials">
            Enphase account
          </SegmentedControl.Item>
          <SegmentedControl.Item value="token">
            Access token
          </SegmentedControl.Item>
        </SegmentedControl.Root>
      </div>

      {method === "credentials" && (
        <>
          <Text as="p" size="1" color="gray">
            ChargeHA uses your Enphase account email and password to generate an
            access token and renews it before it expires. Your credentials are
            stored encrypted with your <Code size="1">ENCRYPTION_KEY</Code>.
          </Text>
          <LabelledField
            label="Enphase account email"
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
          />
          <LabelledField
            label="Enphase account password"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="Enphase password"
          />
        </>
      )}

      {method === "token" && (
        <>
          <Text as="p" size="1" color="gray">
            Sign in at entrez.enphaseenergy.com, select your system and IQ
            Gateway serial number, and paste the generated access token below.
            Owner tokens are valid for 1 year and must be replaced manually.
          </Text>
          <LabelledField
            label="Access token"
            type="password"
            value={token}
            onChange={setToken}
          />
        </>
      )}
    </>
  );
}

function TestConnectionRow(
  { pending, disabled, onTest, testResult }: {
    pending: boolean;
    disabled: boolean;
    onTest: () => void;
    testResult: TestStatus;
  },
) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Button size="2" variant="soft" disabled={disabled} onClick={onTest}>
        {pending && <Loader2 size={14} className={styles.spinner} />}
        {pending ? "Testing..." : "Test Connection"}
      </Button>
      <TestResultBadge testResult={testResult} />
    </div>
  );
}

// Search state + the subnet default, split out to keep EnphaseLocalForm
// under the function-length limit.
function useEnphaseSearch() {
  const [subnet, setSubnet] = useState("");
  const [searchResults, setSearchResults] = useState<EnphaseDevice[]>([]);

  // Defaults the subnet field to where ChargeHA itself is reachable, once,
  // while still leaving it fully editable.
  const lanSubnets = trpc.plugin.energy.enphase_local.lanSubnets.useQuery();
  useDefaultSubnet(lanSubnets.data, subnet, setSubnet);

  const searchMutation = trpc.plugin.energy.enphase_local.discover.useMutation({
    onSuccess: (result: { found: EnphaseDevice[] }) =>
      setSearchResults(result.found),
    onError: () => setSearchResults([]),
  });

  return {
    subnet,
    setSubnet,
    lanSubnets,
    searchMutation,
    searchResults,
    setSearchResults,
  };
}

export function EnphaseLocalForm(
  { initial, onTestSuccess }: EnphaseLocalFormProps,
): JSX.Element {
  const [host, setHost] = useState(initial.host);
  const [email, setEmail] = useState(initial.email);
  const [password, setPassword] = useState(initial.password);
  const [token, setToken] = useState(initial.token);
  const [method, setMethod] = useState<AuthMethod>(
    initial.token && !initial.email ? "token" : "credentials",
  );
  const {
    subnet,
    setSubnet,
    lanSubnets,
    searchMutation,
    searchResults,
    setSearchResults,
  } = useEnphaseSearch();
  // Read from the device's /info — shown for confirmation, never typed or stored.
  const [detectedSerial, setDetectedSerial] = useState("");

  // Only the selected method's values are sent, so the other method can't shadow it.
  const active = method === "credentials"
    ? { email, password, token: "" }
    : { email: "", password: "", token };

  const testMutation = trpc.plugin.energy.enphase_local.testConnection
    .useMutation({
      onSuccess: (
        data: {
          success: boolean;
          serial?: string;
          fetchedToken?: string | null;
        },
      ) => {
        if (!data.success) return;
        if (data.serial) setDetectedSerial(data.serial);
        onTestSuccess({
          host,
          email: active.email,
          password: active.password,
          // Persist the token fetched during the test so the first poll skips a cloud round-trip.
          token: active.token || data.fetchedToken || "",
        });
      },
    });

  const testResult = useTestStatus(testMutation);
  const canTest = host &&
    (method === "credentials" ? email && password : token);

  const handleSelectDevice = (device: EnphaseDevice) => {
    setHost(device.host);
    setDetectedSerial(device.serial);
    setSearchResults([]);
    searchMutation.reset();
  };

  return (
    <>
      <Text as="p" size="3" color="gray">
        Connect to your Enphase Envoy / IQ Gateway on your local network
        (firmware 7+).
      </Text>

      <LabelledField
        label="Envoy IP address"
        value={host}
        onChange={setHost}
        placeholder="192.168.1.60"
      />

      <SearchSection
        subnet={subnet}
        setSubnet={setSubnet}
        detectedSubnets={lanSubnets.data}
        searchMutation={searchMutation}
        searchResults={searchResults}
        onSelectDevice={handleSelectDevice}
      />

      {detectedSerial && (
        <Text size="1" color="gray">
          Gateway serial: {detectedSerial}
        </Text>
      )}

      <Separator size="4" />

      <AuthFields
        method={method}
        setMethod={setMethod}
        email={email}
        setEmail={setEmail}
        password={password}
        setPassword={setPassword}
        token={token}
        setToken={setToken}
      />

      <TestConnectionRow
        pending={testMutation.isPending}
        disabled={!canTest || testMutation.isPending}
        onTest={() => testMutation.mutate({ host, ...active })}
        testResult={testResult}
      />
    </>
  );
}
