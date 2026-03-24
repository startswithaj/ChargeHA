import { Battery, Car, Home, Sun, Zap } from "lucide-react";
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

function VehicleNodes(
  { chargingVehicles, baseRow }: {
    chargingVehicles: ChargingVehicleFlow[];
    baseRow: number;
  },
) {
  if (chargingVehicles.length === 1) {
    const v = chargingVehicles[0];
    return (
      <div
        className={`${styles.node} ${styles.vehicleSingle}`}
        style={{ gridRow: baseRow + 1 }}
        data-testid={`vehicle-node-${v.id}`}
      >
        <div className={styles.nodeIcon}>
          <Car size={28} />
        </div>
        <div className={styles.vehicleLabel}>{v.name}</div>
        <div className={styles.nodeValue}>{kwValue(v.chargePowerW)}</div>
        <div className={styles.vehicleSplit}>
          {kwValue(v.solarW)} solar / {kwValue(v.gridW)} grid
        </div>
      </div>
    );
  }
  return (
    <div className={styles.vehicleRow} style={{ gridRow: baseRow + 1 }}>
      {chargingVehicles.map((v) => (
        <div
          key={v.id}
          className={`${styles.node} ${styles.vehicle}`}
          data-testid={`vehicle-node-${v.id}`}
        >
          <div className={styles.nodeIcon}>
            <Car size={28} />
          </div>
          <div className={styles.vehicleLabel}>{v.name}</div>
          <div className={styles.nodeValue}>{kwValue(v.chargePowerW)}</div>
          <div className={styles.vehicleSplit}>
            {kwValue(v.solarW)} solar / {kwValue(v.gridW)} grid
          </div>
        </div>
      ))}
    </div>
  );
}

function TopRow(
  { data, loading, solarActive, gridActiveClass, isExporting, gridLabel }: {
    data: EnergyData | null;
    loading: boolean | undefined;
    solarActive: boolean;
    gridActiveClass: string;
    isExporting: boolean;
    gridLabel: string;
  },
) {
  const gridColor = isExporting
    ? "var(--color-grid-export)"
    : "var(--color-grid-import)";
  return (
    <>
      <div className={`${styles.node} ${styles.solar}`}>
        <div className={styles.nodeIcon}>
          <Sun size={28} />
        </div>
        <div className={styles.nodeLabel}>Solar</div>
        <div className={styles.nodeValue}>
          {loading ? "---" : kwValue(data?.solarProductionW ?? 0)}
        </div>
      </div>

      <div className={`${styles.arrow} ${styles.solarToHome}`}>
        <div
          className={`${styles.arrowDots} ${
            solarActive ? styles.flowRight : ""
          }`}
          style={{ color: "var(--color-solar)" }}
        >
          ›››
        </div>
      </div>

      <div className={`${styles.node} ${styles.home}`}>
        <div className={styles.nodeIcon}>
          <Home size={28} />
        </div>
        <div className={styles.nodeLabel}>Home</div>
        <div className={styles.nodeValue}>
          {loading ? "---" : kwValue(data?.homeConsumptionW ?? 0)}
        </div>
      </div>

      <div className={`${styles.arrow} ${styles.homeToGrid}`}>
        <div
          className={`${styles.arrowDots} ${gridActiveClass}`}
          style={{ color: gridColor }}
        >
          {isExporting ? "›››" : "‹‹‹"}
        </div>
      </div>

      <div className={`${styles.node} ${styles.grid}`}>
        <div className={styles.nodeIcon}>
          <Zap size={28} />
        </div>
        <div className={styles.nodeLabel}>Grid</div>
        <div className={styles.nodeValue} style={{ color: gridColor }}>
          {loading ? "---" : gridLabel}
        </div>
      </div>
    </>
  );
}

export function EnergyFlowDiagram(
  { data, loading, chargingVehicles = [] }: EnergyFlowDiagramProps,
) {
  const isExporting = (data?.gridPowerW ?? 0) < 0;
  const hasBattery = data?.batteryPowerW !== null &&
    data?.batteryPowerW !== undefined;
  const solarActive = (data?.solarProductionW ?? 0) > 10;
  const gridActive = Math.abs(data?.gridPowerW ?? 0) > 10;
  const baseRow = hasBattery ? 3 : 2;
  const batterySocSuffix =
    data?.batterySoc !== null && data?.batterySoc !== undefined
      ? ` (${Math.round(data.batterySoc)}%)`
      : "";
  const batteryLabel = `${
    kwValue(Math.abs(data?.batteryPowerW ?? 0))
  }${batterySocSuffix}`;
  const gridPrefix = isExporting ? "Export " : "Import ";
  const gridLabel = `${gridPrefix}${kwValue(Math.abs(data?.gridPowerW ?? 0))}`;
  const exportFlowClass = isExporting ? styles.flowRight : styles.flowLeft;
  const gridActiveClass = gridActive ? exportFlowClass : "";

  return (
    <div className={styles.container}>
      <TopRow
        data={data}
        loading={loading}
        solarActive={solarActive}
        gridActiveClass={gridActiveClass}
        isExporting={isExporting}
        gridLabel={gridLabel}
      />

      {hasBattery && (
        <div className={`${styles.node} ${styles.battery}`}>
          <div className={styles.nodeIcon}>
            <Battery size={28} />
          </div>
          <div className={styles.nodeLabel}>Battery</div>
          <div className={styles.nodeValue}>
            {loading ? "---" : batteryLabel}
          </div>
        </div>
      )}

      {/* Charging vehicles: single arrow + vehicle(s) */}
      {chargingVehicles.length > 0 && (
        <>
          <div
            className={styles.verticalArrow}
            style={{ gridRow: baseRow }}
          >
            <div
              className={`${styles.arrowDotsVertical} ${styles.flowDown}`}
              style={{ color: "var(--color-charging)" }}
            >
              ▾▾▾
            </div>
          </div>

          <VehicleNodes
            chargingVehicles={chargingVehicles}
            baseRow={baseRow}
          />
        </>
      )}
    </div>
  );
}
