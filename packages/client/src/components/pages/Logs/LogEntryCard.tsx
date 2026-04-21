import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge, Card, Text } from "@radix-ui/themes";
import type { ControllerLogEntry } from "../../../hooks/useControllerLogs.ts";
import styles from "./Logs.module.css";

function actionColor(
  action: string,
): "green" | "red" | "blue" | "gray" {
  switch (action) {
    case "start":
      return "green";
    case "stop":
      return "red";
    case "adjust_amps":
      return "blue";
    default:
      return "gray";
  }
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts + "Z");
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

type Inputs = NonNullable<ControllerLogEntry["inputs"]>;

function ChecksGroup({ checks }: { checks: ControllerLogEntry["checks"] }) {
  return (
    <div className={styles.detailGroup}>
      <Text size="2" className={styles.detailLabel}>Checks</Text>
      <div className={styles.checksList}>
        {checks.map((c, i) => (
          <div key={i} className={styles.checkItem}>
            <span className={styles.checkName}>{c.check}:</span>
            <span className={styles.checkResult}>{c.result}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EnergyGroup({ energy }: { energy: NonNullable<Inputs["energy"]> }) {
  return (
    <div className={styles.detailGroup}>
      <Text size="2" className={styles.detailLabel}>Energy</Text>
      <div className={styles.dataGrid}>
        <span className={styles.dataKey}>Solar</span>
        <span className={styles.dataValue}>
          {Math.round(energy.solarProductionW)}W
        </span>
        <span className={styles.dataKey}>Grid</span>
        <span className={styles.dataValue}>
          {Math.round(energy.gridPowerW)}W
        </span>
        <span className={styles.dataKey}>Home</span>
        <span className={styles.dataValue}>
          {Math.round(energy.homeConsumptionW)}W
        </span>
        {energy.batterySoc !== null && (
          <>
            <span className={styles.dataKey}>Battery</span>
            <span className={styles.dataValue}>{energy.batterySoc}%</span>
          </>
        )}
      </div>
    </div>
  );
}

function VehicleStateGroup(
  { vs }: { vs: NonNullable<Inputs["vehicleState"]> },
) {
  return (
    <div className={styles.detailGroup}>
      <Text size="2" className={styles.detailLabel}>Vehicle State</Text>
      <div className={styles.dataGrid}>
        <span className={styles.dataKey}>Plugged in</span>
        <span className={styles.dataValue}>
          {vs.isPluggedIn ? "Yes" : "No"}
        </span>
        <span className={styles.dataKey}>Charging</span>
        <span className={styles.dataValue}>
          {vs.isCharging ? "Yes" : "No"}
        </span>
        <span className={styles.dataKey}>Battery</span>
        <span className={styles.dataValue}>
          {vs.batteryLevel}% / {vs.chargeLimit}%
        </span>
        <span className={styles.dataKey}>Amps</span>
        <span className={styles.dataValue}>
          {vs.chargeAmps}A ({vs.chargeAmpsMin}-{vs.chargeAmpsMax}A)
        </span>
        <span className={styles.dataKey}>Power</span>
        <span className={styles.dataValue}>
          {vs.chargePowerKw.toFixed(1)} kW
        </span>
      </div>
    </div>
  );
}

function SchedulesGroup(
  { schedules }: { schedules: Inputs["activeSchedules"] },
) {
  return (
    <div className={styles.detailGroup}>
      <Text size="2" className={styles.detailLabel}>Active Schedules</Text>
      {schedules.map((s) => (
        <Text key={s.id} size="1" color="gray">
          {s.type}: {s.startTime} - {s.endTime}
        </Text>
      ))}
    </div>
  );
}

export function LogEntryCard({ entry }: { entry: ControllerLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const inputs = entry.inputs;

  return (
    <Card
      className={styles.logEntry}
      onClick={() => setExpanded(!expanded)}
    >
      <div className={styles.logHeader}>
        <div className={styles.logTopRow}>
          <span className={styles.chevron}>
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <Text size="1" color="gray" className={styles.timestamp}>
            {formatTimestamp(entry.timestamp)}
          </Text>
          <div className={styles.badges}>
            <Badge size="1" variant="soft" color="gray">
              {entry.vehicleName}
            </Badge>
            <Badge size="1" variant="outline">
              {entry.mode}
            </Badge>
            <Badge size="1" color={actionColor(entry.action)}>
              {entry.action}
            </Badge>
            {entry.traceId && (
              <Badge
                size="1"
                variant="soft"
                color="gray"
                style={{ fontFamily: "monospace" }}
              >
                {entry.traceId}
              </Badge>
            )}
          </div>
          {entry.targetAmps !== null && (
            <Text size="1" color="gray" className={styles.ampsLabel}>
              {entry.targetAmps}A
            </Text>
          )}
        </div>
        <div className={styles.logBottomRow}>
          <Text size="2" color="gray">
            {entry.actionDetail}
          </Text>
        </div>
      </div>

      {expanded && (
        <div className={styles.expandedSection}>
          {entry.checks.length > 0 && <ChecksGroup checks={entry.checks} />}
          {inputs?.energy && <EnergyGroup energy={inputs.energy} />}
          {inputs?.vehicleState && (
            <VehicleStateGroup vs={inputs.vehicleState} />
          )}
          {(inputs?.activeSchedules?.length ?? 0) > 0 && inputs && (
            <SchedulesGroup schedules={inputs.activeSchedules} />
          )}
        </div>
      )}
    </Card>
  );
}
