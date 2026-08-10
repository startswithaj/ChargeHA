import { useMemo, useState } from "react";
import { AlertTriangle, Ban, Car, Info, Plus, Settings } from "lucide-react";
import { Button, Card, Text } from "@radix-ui/themes";
import type {
  ChargeSchedule,
  Schedule,
  ScheduleFormData,
} from "@chargeha/shared";
import {
  chargerPluginOptions,
  vehicleScheduleNotes,
} from "@chargeha/plugins/componentRegistry";
import { useSchedules } from "../../../hooks/useSchedules.ts";
import { useVehicles } from "../../../hooks/useVehicles.ts";
import { useChargers } from "../../../hooks/useChargers.ts";
import { useSystemConfig } from "../../../hooks/useSectionConfig.ts";
import { ScheduleCard } from "../../ScheduleCard/ScheduleCard.tsx";
import { ScheduleForm } from "../../ScheduleDialog/ScheduleDialog.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { findNextGap } from "./scheduleGapUtils.ts";
import { chargePointIdentifier } from "../../../lib/chargePointIdentity.ts";
import {
  chargerNotices,
  type NoticePoint,
  vehicleNotices,
} from "./scheduleNotices.ts";
import type { ScheduleNotice } from "./ScheduleNotice.tsx";
import {
  type ScheduleTarget,
  TargetScheduleSection,
} from "./VehicleScheduleSection.tsx";
import styles from "./Schedules.module.css";

// Tracks which inline form is open: creating for a target/blockout, or editing a schedule
type FormTarget =
  | { action: "create-charge"; target: ScheduleTarget }
  | { action: "create-blockout" }
  | { action: "edit"; schedule: Schedule };

interface SchedulesProps {
  onNavigateSettings?: () => void;
}

function isBlockoutTarget(target: FormTarget | null): boolean {
  if (target === null) return false;
  if (target.action === "create-blockout") return true;
  return target.action === "edit" &&
    target.schedule.scheduleType === "blockout";
}

function useFormHelpers(
  { formTarget, setFormTarget, addSchedule, updateSchedule }: {
    formTarget: FormTarget | null;
    setFormTarget: (t: FormTarget | null) => void;
    addSchedule: (data: ScheduleFormData) => Promise<string | null>;
    updateSchedule: (
      id: string,
      data: ScheduleFormData,
    ) => Promise<string | null>;
  },
) {
  const closeForm = () => setFormTarget(null);

  const handleSave = (data: ScheduleFormData): Promise<string | null> => {
    if (formTarget?.action === "edit") {
      return updateSchedule(formTarget.schedule.id, data);
    }
    return addSchedule(data);
  };

  const openEdit = (schedule: Schedule) => {
    setFormTarget({ action: "edit", schedule });
  };

  const isFormForTarget = (target: ScheduleTarget) =>
    formTarget !== null &&
    ((formTarget.action === "create-charge" &&
      formTarget.target.kind === target.kind &&
      formTarget.target.id === target.id) ||
      (formTarget.action === "edit" &&
        formTarget.schedule.scheduleType === "charge" &&
        (target.kind === "vehicle"
          ? formTarget.schedule.vehicleId === target.id
          : formTarget.schedule.chargerId === target.id)));

  const isFormForBlockout = isBlockoutTarget(formTarget);

  const editingScheduleId = formTarget?.action === "edit"
    ? formTarget.schedule.id
    : null;

  return {
    closeForm,
    handleSave,
    openEdit,
    isFormForTarget,
    isFormForBlockout,
    editingScheduleId,
  };
}

function TargetSections(
  {
    targets,
    points,
    chargers,
    chargeSchedules,
    schedules,
    formTarget,
    editingScheduleId,
    isFormForTarget,
    setFormTarget,
    handleSave,
    closeForm,
    toggleSchedule,
    openEdit,
    removeSchedule,
  }: {
    targets: ScheduleTarget[];
    points: NoticePoint[];
    chargers: Chargers;
    chargeSchedules: ChargeSchedule[];
    schedules: Schedule[];
    formTarget: FormTarget | null;
    editingScheduleId: string | null;
    isFormForTarget: (target: ScheduleTarget) => boolean;
    setFormTarget: (t: FormTarget | null) => void;
    handleSave: (data: ScheduleFormData) => Promise<string | null>;
    closeForm: () => void;
    toggleSchedule: (id: string, enabled: boolean) => void;
    openEdit: (s: Schedule) => void;
    removeSchedule: (id: string) => void;
  },
) {
  const gapKey = (t: ScheduleTarget) =>
    t.kind === "vehicle"
      ? { vehicleId: t.id, chargerId: null }
      : { vehicleId: null, chargerId: t.id };
  return (
    <>
      {targets.map((target) => {
        const targetSchedules = chargeSchedules.filter((s) =>
          target.kind === "vehicle"
            ? s.vehicleId === target.id
            : s.chargerId === target.id
        );
        return (
          <TargetScheduleSection
            key={`${target.kind}-${target.id}`}
            target={target}
            targetSchedules={targetSchedules}
            notices={noticesForTarget(
              target,
              targetSchedules,
              points,
              chargers,
              chargeSchedules,
            )}
            showingForm={isFormForTarget(target)}
            gap={findNextGap(schedules, "charge", gapKey(target))}
            editingScheduleId={editingScheduleId}
            isCreating={formTarget?.action === "create-charge" &&
              formTarget.target.kind === target.kind &&
              formTarget.target.id === target.id}
            onAddSchedule={() =>
              setFormTarget({ action: "create-charge", target })}
            onSave={handleSave}
            onCancel={closeForm}
            onToggle={toggleSchedule}
            onEdit={openEdit}
            onDelete={removeSchedule}
          />
        );
      })}
    </>
  );
}

function NoVehiclesEmptyState(
  { onNavigateSettings }: { onNavigateSettings?: () => void },
) {
  return (
    <div className={styles.page}>
      <Text size="5" weight="bold">Schedules</Text>
      <Card>
        <div className={styles.noVehicles}>
          <Car size={24} style={{ color: "var(--gray-9)" }} />
          <div className={styles.noVehiclesText}>
            <Text size="3" weight="bold" style={{ display: "block" }}>
              No vehicles configured
            </Text>
            <Text size="2" color="gray">
              Add a vehicle in Settings to start creating charge and blockout
              schedules.
            </Text>
          </div>
          <Button variant="soft" size="2" onClick={onNavigateSettings}>
            <Settings size={16} />
            Add Vehicle
          </Button>
        </div>
      </Card>
    </div>
  );
}

function PageHeader(
  { timezone, activeScheduleNotes }: {
    timezone: string;
    activeScheduleNotes: Array<{ adapterType: string; text: string }>;
  },
) {
  return (
    <div className={styles.pageHeader}>
      <div className={styles.titleRow}>
        <Text size="5" weight="bold">Schedules</Text>
        <Text size="1" color="gray">Times shown in {timezone}</Text>
      </div>
      <div>
        <Text size="2" color="gray">
          Charge schedules override solar tracking and charge at the set rate
          regardless of solar production. Use these for off-peak windows where
          you want guaranteed charging.
        </Text>
      </div>
      {activeScheduleNotes.map((note) => (
        <div key={note.adapterType} className={styles.disclaimer}>
          <AlertTriangle
            size={16}
            style={{ color: "var(--amber-9)", flexShrink: 0, marginTop: 1 }}
          />
          <Text size="1" color="gray">{note.text}</Text>
        </div>
      ))}
    </div>
  );
}

function BlockoutSection(
  {
    blockoutSchedules,
    isFormForBlockout,
    editingScheduleId,
    handleSave,
    closeForm,
    toggleSchedule,
    openEdit,
    removeSchedule,
    setFormTarget,
    formTarget,
    schedules,
  }: {
    blockoutSchedules: Schedule[];
    isFormForBlockout: boolean;
    editingScheduleId: string | null;
    handleSave: (data: ScheduleFormData) => Promise<string | null>;
    closeForm: () => void;
    toggleSchedule: (id: string, enabled: boolean) => void;
    openEdit: (s: Schedule) => void;
    removeSchedule: (id: string) => void;
    setFormTarget: (t: FormTarget | null) => void;
    formTarget: FormTarget | null;
    schedules: Schedule[];
  },
) {
  return (
    <>
      <div className={styles.sectionHeader}>
        <Text size="3" weight="medium">Blockout Schedules</Text>
        {!isFormForBlockout && (
          <Button
            variant="soft"
            size="1"
            onClick={() => setFormTarget({ action: "create-blockout" })}
          >
            <Plus size={14} />
            Add Blockout Period
          </Button>
        )}
      </div>
      {blockoutSchedules.length === 0 && !isFormForBlockout && (
        <EmptyState
          icon={<Ban size={20} />}
          message="No blockout periods. Create one to prevent charging during peak tariff hours."
        />
      )}
      <div className={styles.scheduleList}>
        {blockoutSchedules.map((s) => {
          if (editingScheduleId === s.id) {
            return (
              <ScheduleForm
                key={`edit-${s.id}`}
                editingSchedule={s}
                scheduleType="blockout"
                vehicleId={null}
                onSave={handleSave}
                onCancel={closeForm}
              />
            );
          }
          return (
            <ScheduleCard
              key={s.id}
              schedule={s}
              onToggle={toggleSchedule}
              onEdit={openEdit}
              onDelete={removeSchedule}
            />
          );
        })}
      </div>
      {formTarget?.action === "create-blockout" && (
        <ScheduleForm
          editingSchedule={null}
          scheduleType="blockout"
          vehicleId={null}
          defaultStartTime={findNextGap(schedules, "blockout", {
            vehicleId: null,
            chargerId: null,
          }).startTime}
          defaultEndTime={findNextGap(schedules, "blockout", {
            vehicleId: null,
            chargerId: null,
          }).endTime}
          onSave={handleSave}
          onCancel={closeForm}
        />
      )}
    </>
  );
}

type Vehicles = ReturnType<typeof useVehicles>["vehicles"];
type Chargers = ReturnType<typeof useChargers>["chargers"];

const chargerOption = (adapterType: string) =>
  chargerPluginOptions.find((o) => o.id === adapterType);

/** Everything the notice builders need about one charging point, including
 *  the server's live vehicle resolution. */
function toNoticePoints(chargers: Chargers, vehicles: Vehicles): NoticePoint[] {
  return chargers.map((c) => ({
    id: c.id,
    name: c.name,
    resolvedVehicleId: c.resolvedVehicleId,
    resolvedVehicleName:
      vehicles.find((v) => v.id === c.resolvedVehicleId)?.name ?? null,
    kind: c.kind,
    vehicleResolution: c.vehicleResolution,
    vehicleId: c.vehicleId,
  }));
}

/** Charger groups: every smart point, always — including one with a vehicle
 *  assigned, whose own charger-keyed schedules would otherwise have no group
 *  to appear in and would silently vanish from this page. A vehicle_api point
 *  is the vehicle by construction (resolveConstructionLinked), so it is only
 *  ever a vehicle group; giving it both would list one charging point twice
 *  under two names. */
function chargerTargets(chargers: Chargers): ScheduleTarget[] {
  return chargers
    .filter((c) => c.kind !== "vehicle_api")
    .map((c): ScheduleTarget => ({
      kind: "charger",
      id: c.id,
      name: c.name,
      badge: chargerOption(c.chargerAdapterType)?.label ??
        c.chargerAdapterType,
      identifier: chargePointIdentifier(c),
    }));
}

/** One group per distinct car a charging point is tied to — by assignment or
 *  construction (`vehicleId`), or by the resolution in force right now
 *  (`resolvedVehicleId`). Resolution counts because otherwise an unassigned
 *  smart charger's vehicle-keyed schedules would have no group and vanish from
 *  the page while still running in the engine. Deduped, so two points on one
 *  car give one group; a car no point is tied to gets none. */
function vehicleTargets(
  chargers: Chargers,
  vehicles: Vehicles,
): ScheduleTarget[] {
  const ids = [
    ...new Set(
      chargers.flatMap((c) =>
        [c.vehicleId, c.resolvedVehicleId].filter((id): id is string =>
          id !== null
        )
      ),
    ),
  ];
  return ids.map((id): ScheduleTarget => {
    const vehicle = vehicles.find((v) => v.id === id);
    const point = chargers.find((c) => c.vehicleId === id);
    return {
      kind: "vehicle",
      id,
      name: vehicle?.name ?? point?.name ?? id,
      badge: vehicle?.adapterType ?? point?.chargerAdapterType ?? "vehicle",
      // A car has no charge point id of its own — that belongs to the charger.
      identifier: null,
    };
  });
}

// Chargers first, then cars: one group per charging point, one per car any
// point is tied to. A fixed order matters on a settings screen — ordering by
// live resolution would move groups up and down the page as cars plug in.
function buildScheduleTargets(
  vehicles: Vehicles,
  chargers: Chargers,
): ScheduleTarget[] {
  return [...chargerTargets(chargers), ...vehicleTargets(chargers, vehicles)];
}

/** Notices only make sense against schedules that exist — an empty group
 *  already says "nothing here" with its empty state. */
function noticesForTarget(
  target: ScheduleTarget,
  targetSchedules: ChargeSchedule[],
  points: NoticePoint[],
  chargers: Chargers,
  chargeSchedules: ChargeSchedule[],
): ScheduleNotice[] {
  if (targetSchedules.length === 0) return [];
  if (target.kind === "charger") {
    const point = points.find((p) => p.id === target.id);
    return point ? chargerNotices(point, chargeSchedules) : [];
  }
  // Only a smart charger's resolution can surprise the user. A vehicle_api
  // point is linked by construction, so there is nothing to report.
  const tiedToSmartCharger = chargers.some((c) =>
    c.kind === "smart" &&
    (c.vehicleId === target.id || c.resolvedVehicleId === target.id)
  );
  if (!tiedToSmartCharger) return [];
  return vehicleNotices(target.id, target.name, points);
}

function SchedulesLoading() {
  return (
    <div className={styles.page}>
      <Text size="5" weight="bold">Schedules</Text>
      <Text size="2" color="gray">Loading...</Text>
    </div>
  );
}

export function Schedules({ onNavigateSettings }: SchedulesProps) {
  const { vehicles, loading: vehiclesLoading } = useVehicles();
  const { chargers } = useChargers();
  const {
    schedules,
    chargeSchedules,
    blockoutSchedules,
    addSchedule,
    updateSchedule,
    toggleSchedule,
    removeSchedule,
  } = useSchedules();

  // Show schedule notes only for vehicle adapter types the user has
  const activeScheduleNotes = useMemo(() => {
    const adapterTypes = new Set(vehicles.map((v) => v.adapterType));
    return vehicleScheduleNotes.filter((n) => adapterTypes.has(n.adapterType));
  }, [vehicles]);

  const [formTarget, setFormTarget] = useState<FormTarget | null>(null);

  // Configured zone schedules are evaluated in (reactive); else the browser's.
  const { data: systemConfig } = useSystemConfig();
  const timezone = systemConfig?.timezone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone;

  const {
    closeForm,
    handleSave,
    openEdit,
    isFormForTarget,
    isFormForBlockout,
    editingScheduleId,
  } = useFormHelpers({
    formTarget,
    setFormTarget,
    addSchedule,
    updateSchedule,
  });

  const targets = buildScheduleTargets(vehicles, chargers);
  const points = toNoticePoints(chargers, vehicles);

  if (!vehiclesLoading && targets.length === 0) {
    return <NoVehiclesEmptyState onNavigateSettings={onNavigateSettings} />;
  }

  if (vehiclesLoading) return <SchedulesLoading />;

  return (
    <div className={styles.page}>
      <PageHeader
        timezone={timezone}
        activeScheduleNotes={activeScheduleNotes}
      />

      <TargetSections
        targets={targets}
        points={points}
        chargers={chargers}
        chargeSchedules={chargeSchedules}
        schedules={schedules}
        formTarget={formTarget}
        editingScheduleId={editingScheduleId}
        isFormForTarget={isFormForTarget}
        setFormTarget={setFormTarget}
        handleSave={handleSave}
        closeForm={closeForm}
        toggleSchedule={toggleSchedule}
        openEdit={openEdit}
        removeSchedule={removeSchedule}
      />

      <div className={styles.separator} />

      <BlockoutSection
        blockoutSchedules={blockoutSchedules}
        isFormForBlockout={isFormForBlockout}
        editingScheduleId={editingScheduleId}
        handleSave={handleSave}
        closeForm={closeForm}
        toggleSchedule={toggleSchedule}
        openEdit={openEdit}
        removeSchedule={removeSchedule}
        setFormTarget={setFormTarget}
        formTarget={formTarget}
        schedules={schedules}
      />

      <Card className={styles.infoCard}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <Info
            size={16}
            style={{ color: "var(--gray-9)", flexShrink: 0, marginTop: 2 }}
          />
          <Text size="1" color="gray">
            Outside of scheduled windows, vehicles in Auto mode will charge
            based on excess solar production. Blockout schedules take priority
            over charge schedules — if a blockout is active, charging will not
            start regardless of other settings.
          </Text>
        </div>
      </Card>
    </div>
  );
}
