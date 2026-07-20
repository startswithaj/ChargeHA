import { useMemo } from "react";
import { Button, Callout, Text } from "@radix-ui/themes";
import { AlertTriangle, CheckCircle, PartyPopper, Pencil } from "lucide-react";
import type { VehicleWithState } from "@chargeha/shared";
import { trpc } from "../../../trpc.ts";
import { useRouter } from "../../../hooks/useRouter.ts";
import type { StepDef, StepProps } from "../flow.ts";
import styles from "./steps.module.css";

interface ChecklistItem {
  label: string;
  completed: boolean;
  /** The step this item's Edit button jumps to. An id, not a position: which
   *  index a step sits at depends on the plugins selected. */
  stepId: string;
}

function ChecklistView(
  { checklist, onSkipTo }: {
    checklist: ChecklistItem[];
    onSkipTo: (id: string) => void;
  },
) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {checklist.map((item) => (
        <div
          key={item.label}
          style={{ display: "flex", alignItems: "center", gap: 8 }}
        >
          {item.completed
            ? <CheckCircle size={18} color="var(--green-9)" />
            : <AlertTriangle size={18} color="var(--orange-9)" />}
          <Text size="2" color={item.completed ? undefined : "orange"}>
            {item.label}
          </Text>
          <Button
            size="1"
            variant="ghost"
            color="gray"
            onClick={() => onSkipTo(item.stepId)}
            style={{ marginLeft: "auto" }}
          >
            <Pencil size={12} />
            Edit
          </Button>
        </div>
      ))}
    </div>
  );
}

function buildChecklist(
  { authMode, systemConfig, vehicles, equipmentConfig, homeConfig }: {
    authMode: string;
    systemConfig: { timezone?: string | null } | undefined;
    vehicles: VehicleWithState[];
    equipmentConfig: { energyAdapterType?: string | null } | undefined;
    homeConfig:
      | { homeLatitude?: number | null; homeLongitude?: number | null }
      | undefined;
  },
): ChecklistItem[] {
  // Every target is a core step, so it is always in the list.
  return [
    {
      label: authMode === "none"
        ? "No authentication configured"
        : "Authentication configured",
      completed: authMode === "local" || authMode === "oidc" ||
        authMode === "none",
      stepId: "authentication",
    },
    {
      label: "Timezone configured",
      completed: !!systemConfig?.timezone,
      stepId: "timezone",
    },
    {
      label: "Vehicle connected",
      completed: vehicles.length > 0,
      stepId: "vehicle-type",
    },
    {
      label: "Energy source configured",
      completed: !!equipmentConfig?.energyAdapterType &&
        equipmentConfig.energyAdapterType !== "",
      stepId: "inverter-type",
    },
    {
      label: "Home location set",
      completed: !!(homeConfig?.homeLatitude && homeConfig?.homeLongitude),
      stepId: "home-location",
    },
  ];
}

export const doneStep: StepDef = {
  id: "done",
  label: "Done",
  // No Next: the step finishes setup through its own "Go to Dashboard" CTA.
  useStep: (props) => ({
    next: { kind: "hidden" },
    view: <DoneSummary {...props} />,
  }),
};

function DoneSummary({ onSkipTo }: StepProps) {
  const { navigate } = useRouter();
  // Always refetch on mount so the summary reflects the just-finished setup,
  // not a stale cache from an earlier step or the quick demo setup.
  const fresh = { refetchOnMount: "always" } as const;
  const { data: systemConfig, isLoading: systemLoading } = trpc.config.system
    .get.useQuery(undefined, fresh);
  const { data: equipmentConfig, isLoading: equipmentLoading } = trpc.config
    .equipment.get.useQuery(undefined, fresh);
  const { data: homeConfig, isLoading: homeLoading } = trpc.config.home.get
    .useQuery(undefined, fresh);
  const { data: authSession, isLoading: authLoading } = trpc.auth.session
    .useQuery(undefined, fresh);
  const { data: vehiclesData, isLoading: vehiclesLoading } = trpc.vehicle.list
    .useQuery(undefined, fresh);
  const vehicles = useMemo(
    () => (vehiclesData?.vehicles ?? []) as VehicleWithState[],
    [vehiclesData],
  );

  const utils = trpc.useUtils();
  const completeMutation = trpc.wizard.complete.useMutation({
    onSuccess: () => {
      // Set wizard.status cache directly to prevent race condition:
      // if we only invalidate, the stale firstRun=true data can briefly
      // redirect back to the wizard before the refetch completes.
      utils.wizard.status.setData(undefined, {
        completed: true,
        firstRun: false,
      });
      navigate({ type: "app", page: "dashboard" });
    },
  });

  const authMode = authSession?.authMode ?? "none";

  // isLoading, not isFetching — the summary must not blank out on background refetches.
  const loading = systemLoading || equipmentLoading || homeLoading ||
    vehiclesLoading || authLoading;

  const checklist = buildChecklist({
    authMode,
    systemConfig,
    vehicles,
    equipmentConfig,
    homeConfig,
  });

  const skippedItems = checklist.filter((item) => !item.completed);

  if (loading) {
    return (
      <div className={styles.stepContainer}>
        <Text size="2" color="gray">Loading summary...</Text>
      </div>
    );
  }

  return (
    <div className={styles.stepContainer}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <PartyPopper size={24} />
        <Text size="4" weight="bold">Setup Complete!</Text>
      </div>

      <Text size="2" color="gray">
        Here&apos;s a summary of your ChargeHA configuration.
      </Text>

      <ChecklistView checklist={checklist} onSkipTo={onSkipTo} />

      {/* Warnings for skipped items */}
      {skippedItems.length > 0 && (
        <Callout.Root color="orange" size="1">
          <Callout.Icon>
            <AlertTriangle size={16} />
          </Callout.Icon>
          <Callout.Text>
            {skippedItems.length === 1
              ? "1 step was skipped."
              : `${skippedItems.length} steps were skipped.`}{" "}
            You can configure these later in Settings.
          </Callout.Text>
        </Callout.Root>
      )}

      {/* Actions */}
      {completeMutation.isError && (
        <Callout.Root color="red" size="1">
          <Callout.Icon>
            <AlertTriangle size={16} />
          </Callout.Icon>
          <Callout.Text>{completeMutation.error.message}</Callout.Text>
        </Callout.Root>
      )}

      <div className={styles.stepActions}>
        <Button
          size="3"
          disabled={completeMutation.isPending}
          onClick={() => completeMutation.mutate()}
        >
          {completeMutation.isPending ? "Completing..." : "Go to Dashboard"}
        </Button>
      </div>
    </div>
  );
}
