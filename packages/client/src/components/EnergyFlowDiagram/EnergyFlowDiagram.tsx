import { Battery, Car, Home, Sun, Zap } from "lucide-react";
import type { ReactNode } from "react";
import type { EnergyData } from "@chargeha/shared";
import { kwValue } from "../../utils/Format.ts";
import styles from "./EnergyFlowDiagram.module.css";

export interface ChargingVehicleFlow {
  id: string;
  name: string;
  chargePowerW: number;
  solarW: number;
  gridW: number;
}

interface EnergyFlowDiagramProps {
  data: EnergyData | null;
  loading?: boolean;
  chargingVehicles?: ChargingVehicleFlow[];
}

const DOT_COUNT = 2;

// Dot travel time shrinks as power grows so big flows visibly move faster
function flowDurationS(powerW: number): number {
  const kw = Math.abs(powerW) / 1000;
  return Math.min(3, Math.max(1.4, 3.2 - kw * 0.2));
}

function FlowConnector(
  { active, color, direction, powerW, className, gridRow }: {
    active: boolean;
    color: string;
    direction: "right" | "left" | "down";
    powerW: number;
    className?: string;
    gridRow?: number;
  },
) {
  const vertical = direction === "down";
  const durationS = flowDurationS(powerW);
  const orientationClass = vertical ? styles.connectorVertical : "";
  const dotClass = vertical ? styles.dotVertical : styles.dot;
  return (
    <div
      className={`${styles.connector} ${orientationClass} ${
        active ? styles.connectorActive : ""
      } ${className ?? ""}`}
      style={{ color, ...(gridRow ? { gridRow } : {}) }}
    >
      <div className={styles.track} />
      {active &&
        Array.from({ length: DOT_COUNT }, (_, i) => (
          <div
            key={i}
            className={dotClass}
            style={{
              animationDuration: `${durationS}s`,
              animationDelay: `${(-durationS / DOT_COUNT) * i}s`,
              animationDirection: direction === "left" ? "reverse" : "normal",
            }}
          />
        ))}
    </div>
  );
}

function FlowNode(
  { icon, label, value, className, active, children }: {
    icon: ReactNode;
    label: string;
    value: string;
    className?: string;
    active: boolean;
    children?: ReactNode;
  },
) {
  return (
    <div
      className={`${styles.node} ${className ?? ""} ${
        active ? styles.active : styles.idle
      }`}
    >
      <div className={styles.iconBadge}>{icon}</div>
      <div className={styles.nodeLabel}>{label}</div>
      <div className={styles.nodeValue}>{value}</div>
      {children}
    </div>
  );
}

function VehicleNode(
  { v, className, gridRow }: {
    v: ChargingVehicleFlow;
    className?: string;
    gridRow?: number;
  },
) {
  const solarPct = v.chargePowerW > 0
    ? Math.min(100, Math.round((v.solarW / v.chargePowerW) * 100))
    : 0;
  return (
    <div
      className={`${styles.node} ${styles.vehicle} ${styles.active} ${
        className ?? ""
      }`}
      style={gridRow ? { gridRow } : undefined}
      data-testid={`vehicle-node-${v.id}`}
    >
      <div className={styles.iconBadge}>
        <Car size={24} />
      </div>
      <div className={styles.vehicleName}>{v.name}</div>
      <div className={styles.nodeValue}>{kwValue(v.chargePowerW)}</div>
      <div className={styles.splitBar}>
        <div className={styles.splitSolar} style={{ width: `${solarPct}%` }} />
      </div>
      <div className={styles.splitLegend}>
        <span className={styles.legendSolar}>{kwValue(v.solarW)} solar</span>
        <span className={styles.legendGrid}>{kwValue(v.gridW)} grid</span>
      </div>
    </div>
  );
}

function VehicleNodes(
  { chargingVehicles, baseRow }: {
    chargingVehicles: ChargingVehicleFlow[];
    baseRow: number;
  },
) {
  const totalW = chargingVehicles.reduce((sum, v) => sum + v.chargePowerW, 0);
  if (chargingVehicles.length === 1) {
    return (
      <>
        <FlowConnector
          className={styles.toVehicles}
          active
          color="var(--color-charging)"
          direction="down"
          powerW={totalW}
          gridRow={baseRow}
        />
        <VehicleNode
          v={chargingVehicles[0]}
          className={styles.vehicleSingle}
          gridRow={baseRow + 1}
        />
      </>
    );
  }
  // T-branch: stem from Home, horizontal rail, then a drop into each vehicle.
  // Equal-width columns put the rail insets exactly on each vehicle's centre.
  const railInsetPct = 50 / chargingVehicles.length;
  return (
    <div className={styles.vehicleGroup} style={{ gridRow: baseRow }}>
      <FlowConnector
        className={styles.branchStem}
        active
        color="var(--color-charging)"
        direction="down"
        powerW={totalW}
      />
      <div
        className={styles.vehicleRow}
        style={{ maxWidth: `${chargingVehicles.length * 240}px` }}
      >
        <div
          className={styles.branchRail}
          style={{ left: `${railInsetPct}%`, right: `${railInsetPct}%` }}
        />
        {chargingVehicles.map((v) => (
          <div key={v.id} className={styles.vehicleColumn}>
            <FlowConnector
              className={styles.branchDrop}
              active
              color="var(--color-charging)"
              direction="down"
              powerW={v.chargePowerW}
            />
            <VehicleNode v={v} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function EnergyFlowDiagram(
  { data, loading, chargingVehicles = [] }: EnergyFlowDiagramProps,
) {
  const solarW = data?.solarProductionW ?? 0;
  const homeW = data?.homeConsumptionW ?? 0;
  const gridW = data?.gridPowerW ?? 0;
  const batteryW = data?.batteryPowerW ?? 0;
  const isExporting = gridW < 0;
  const hasBattery = data?.batteryPowerW !== null &&
    data?.batteryPowerW !== undefined;
  const solarActive = solarW > 10;
  const gridActive = Math.abs(gridW) > 10;
  const batteryActive = Math.abs(batteryW) > 10;
  const baseRow = hasBattery ? 3 : 2;
  const gridColor = isExporting
    ? "var(--color-grid-export)"
    : "var(--color-grid-import)";
  const gridColorClass = isExporting ? styles.gridExport : styles.gridImport;

  return (
    <div className={styles.container}>
      <FlowNode
        icon={<Sun size={24} />}
        label="Solar"
        value={loading ? "---" : kwValue(solarW)}
        className={styles.solar}
        active={solarActive}
      />

      <FlowConnector
        className={styles.solarToHome}
        active={solarActive}
        color="var(--color-solar)"
        direction="right"
        powerW={solarW}
      />

      <FlowNode
        icon={<Home size={24} />}
        label="Home"
        value={loading ? "---" : kwValue(homeW)}
        className={styles.home}
        active={homeW > 10}
      />

      <FlowConnector
        className={styles.homeToGrid}
        active={gridActive}
        color={gridColor}
        direction={isExporting ? "right" : "left"}
        powerW={gridW}
      />

      <FlowNode
        icon={<Zap size={24} />}
        label="Grid"
        value={loading ? "---" : kwValue(Math.abs(gridW))}
        className={`${styles.gridNode} ${gridColorClass}`}
        active={gridActive}
      >
        {!loading && gridActive && (
          <div className={styles.pill}>{isExporting ? "Export" : "Import"}</div>
        )}
      </FlowNode>

      {hasBattery && (
        <FlowNode
          icon={<Battery size={24} />}
          label="Battery"
          value={loading ? "---" : kwValue(Math.abs(batteryW))}
          className={styles.battery}
          active={batteryActive}
        >
          {!loading && data?.batterySoc !== null &&
            data?.batterySoc !== undefined && (
            <div className={styles.socText}>
              {Math.round(data.batterySoc)}%
            </div>
          )}
        </FlowNode>
      )}

      {/* Charging vehicles: connector(s) + vehicle node(s) */}
      {chargingVehicles.length > 0 && (
        <VehicleNodes
          chargingVehicles={chargingVehicles}
          baseRow={baseRow}
        />
      )}
    </div>
  );
}
