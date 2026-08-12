import { useMemo, useState } from "react";
import { Button, Text, TextField } from "@radix-ui/themes";
import { Loader2 } from "lucide-react";
import { trpc } from "./trpc.ts";
import {
  stepStyles as styles,
  TestResultBadge,
  type TestStatus,
} from "../../../hostUi.ts";
import { type StationOption, StationPicker } from "./StationPicker.tsx";
import { FormError } from "../../../hostUi.ts";

interface GoodweSemsFormProps {
  initialAccount: string;
  initialStationId: string;
  onTestSuccess: (
    account: string,
    password: string,
    stationId: string,
  ) => void;
}

function CredentialFields(
  {
    account,
    setAccount,
    password,
    setPassword,
  }: {
    account: string;
    setAccount: (v: string) => void;
    password: string;
    setPassword: (v: string) => void;
  },
) {
  return (
    <>
      <div className={styles.fieldGroup}>
        <Text as="label" size="2" weight="medium">Account</Text>
        <TextField.Root
          size="2"
          type="email"
          placeholder="your@email.com"
          value={account}
          onChange={(e: { target: { value: string } }) =>
            setAccount(e.target.value)}
          aria-label="Account"
        />
      </div>
      <div className={styles.fieldGroup}>
        <Text as="label" size="2" weight="medium">Password</Text>
        <TextField.Root
          size="2"
          type="password"
          placeholder="SEMS Portal password"
          value={password}
          onChange={(e: { target: { value: string } }) =>
            setPassword(e.target.value)}
          aria-label="Password"
        />
      </div>
    </>
  );
}

function ActionRow(
  { label, pendingLabel, pending, disabled, onClick, children }: {
    label: string;
    pendingLabel: string;
    pending: boolean;
    disabled: boolean;
    onClick: () => void;
    children?: JSX.Element | false | null;
  },
) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Button size="2" variant="soft" disabled={disabled} onClick={onClick}>
        {pending && <Loader2 size={14} className={styles.spinner} />}
        {pending ? pendingLabel : label}
      </Button>
      {children}
    </div>
  );
}

interface TestMutationState {
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  data?: { success: boolean; systemName?: string; error?: string };
  error: { message: string } | null;
}

/** Collapse the test mutation's flags into the badge's status union. */
function useTestResult(mutation: TestMutationState): TestStatus {
  return useMemo(() => {
    if (mutation.isPending) return { status: "testing" };
    if (mutation.isSuccess && mutation.data?.success) {
      return { status: "success", detail: mutation.data.systemName };
    }
    if (mutation.isSuccess && !mutation.data?.success) {
      return {
        status: "error",
        message: mutation.data?.error ?? "Connection failed",
      };
    }
    if (mutation.isError) {
      return { status: "error", message: mutation.error?.message ?? "Failed" };
    }
    return { status: "idle" };
  }, [
    mutation.isPending,
    mutation.isSuccess,
    mutation.isError,
    mutation.data,
    mutation.error,
  ]);
}

export function GoodweSemsForm({
  initialAccount,
  initialStationId,
  onTestSuccess,
}: GoodweSemsFormProps): JSX.Element {
  const [account, setAccount] = useState(initialAccount);
  const [password, setPassword] = useState("");
  const [stationId, setStationId] = useState(initialStationId);

  const stationsMutation = trpc.plugin.energy.goodwe_sems.listStations
    .useMutation();

  const stations: StationOption[] = useMemo(() => {
    const data = stationsMutation.data;
    if (!data || !data.success) return [];
    return data.stations;
  }, [stationsMutation.data]);

  // Loading a different account's stations leaves the previous pick behind.
  // Derived rather than reset in an effect, so there is no render-time write.
  const selectedStationId = useMemo(() => {
    if (stations.length === 0) return stationId;
    return stations.some((s) => s.id === stationId) ? stationId : "";
  }, [stations, stationId]);

  const testMutation = trpc.plugin.energy.goodwe_sems.testConnection
    .useMutation({
      onSuccess: (data: { success: boolean }) => {
        if (data.success) onTestSuccess(account, password, selectedStationId);
      },
    });

  const stationsError: string | null = useMemo(() => {
    if (stationsMutation.isError) return stationsMutation.error.message;
    const data = stationsMutation.data;
    if (data && !data.success) return data.error ?? "Could not list stations";
    return null;
  }, [
    stationsMutation.isError,
    stationsMutation.error,
    stationsMutation.data,
  ]);

  const testResult = useTestResult(testMutation);

  return (
    <>
      <Text as="p" size="3" color="gray">
        Connect to your GoodWe inverter via the SEMS Portal cloud API using your
        <strong>semsportal.com</strong>{" "}
        account. Grid and consumption readings require a GoodWe HomeKit or smart
        meter.
      </Text>

      <CredentialFields
        account={account}
        setAccount={setAccount}
        password={password}
        setPassword={setPassword}
      />

      <ActionRow
        label="Load Stations"
        pendingLabel="Loading..."
        pending={stationsMutation.isPending}
        disabled={!account || !password || stationsMutation.isPending}
        onClick={() => stationsMutation.mutate({ account, password })}
      >
        <FormError message={stationsError} />
      </ActionRow>

      <StationPicker
        stations={stations}
        selectedStationId={selectedStationId}
        onSelect={setStationId}
        searched={stationsMutation.data !== undefined && !stationsError}
      />

      <ActionRow
        label="Test Connection"
        pendingLabel="Testing..."
        pending={testMutation.isPending}
        disabled={!account || !password || !selectedStationId ||
          testMutation.isPending}
        onClick={() =>
          testMutation.mutate({
            account,
            password,
            stationId: selectedStationId,
          })}
      >
        <TestResultBadge testResult={testResult} />
      </ActionRow>
    </>
  );
}
