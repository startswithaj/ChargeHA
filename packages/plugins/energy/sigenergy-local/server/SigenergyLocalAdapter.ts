import { Buffer } from "node:buffer";
import type {
  CumulativeEnergyData,
  DeviceInfo,
  EnergyData,
  EnergySourceAdapter,
} from "@chargeha/shared";
import type { Logger } from "@chargeha/server/lib/Logger";
import type { ModbusReader } from "./SigenergyModbusClient.ts";

// ── Register map (all input registers, function code 0x04) ──────────────────
// Addresses, data types, scales and sign conventions come from the Sigenergy
// Modbus protocol as documented in the Home Assistant integration:
// https://github.com/TypQxQ/Sigenergy-Home-Assistant-Integration
//
// Plant/EMS registers live on the plant unit id (default 247); per-device
// registers live on the device unit id (default 1).

const PLANT_GRID_POWER = 30005; // int32, kW ×0.001. <0 = export, >0 = import
const PLANT_ESS_SOC = 30014; // uint16, % ×0.1
const PLANT_PV_POWER = 30035; // int32, kW ×0.001
const PLANT_BATTERY_POWER = 30037; // int32, kW ×0.001. >0 = charging
const DEVICE_PHASE_A_VOLTAGE = 31011; // uint32, V ×0.01
const DEVICE_ACC_EXPORT_ENERGY = 30556; // uint64, kWh ×0.01
const DEVICE_ACC_IMPORT_ENERGY = 30562; // uint64, kWh ×0.01
const DEVICE_MODEL_TYPE = 30500; // string, 15 registers
const DEVICE_SERIAL = 30515; // string, 10 registers

// ── Pure register decoders ──────────────────────────────────────────────────

function readS32(buf: Buffer): number {
  return buf.readInt32BE(0);
}

function readU16(buf: Buffer): number {
  return buf.readUInt16BE(0);
}

function readU32(buf: Buffer): number {
  return buf.readUInt32BE(0);
}

function readU64(buf: Buffer): number {
  return Number(buf.readBigUInt64BE(0));
}

/** Decode NUL-padded ASCII packed two chars per register. */
function readAsciiString(buf: Buffer): string {
  return buf.toString("latin1").replace(/[^\x20-\x7e]/g, "").trim();
}

/** kW power register (scale 0.001) → whole watts. */
function powerToWatts(raw: number): number {
  return Math.round(raw * 0.001 * 1000);
}

/** SOC register (scale 0.1) → percent, rounded to 1 decimal. */
function socPercent(raw: number): number {
  return Math.round(raw) / 10;
}

/** Voltage register (scale 0.01) → volts. */
function voltageToVolts(raw: number): number {
  return raw * 0.01;
}

/** kWh counter (scale 0.01) → watt-hours. */
function energyToWh(raw: number): number {
  return raw * 0.01 * 1000;
}

/**
 * Reads a Sigenergy inverter/ESS over Modbus TCP and maps its registers to the
 * ChargeHA `EnergySourceAdapter` contract.
 *
 * Sign conventions are normalised to ChargeHA's:
 *  - `gridPowerW`: + import / − export. Sigenergy uses the same convention
 *    (register 30005: "< 0: power from system to grid"), so it passes through.
 *  - `batteryPowerW`: + discharge / − charge. Sigenergy is the opposite
 *    (register 30037: "> 0: charging"), so it is negated.
 *
 * Home consumption has no dedicated register; it is derived from the node
 * balance: PV + grid import + battery discharge.
 */
export class SigenergyLocalAdapter implements EnergySourceAdapter {
  constructor(
    private readonly reader: ModbusReader,
    private readonly plantUnitId: number,
    private readonly deviceUnitId: number,
    private readonly logger: Logger,
  ) {}

  pollIntervalSeconds(): number {
    return 10;
  }

  async connect(): Promise<void> {
    await this.reader.connect();
    // Probe the plant PV-power register: confirms the device speaks Modbus and
    // the plant unit id is correct, surfacing misconfiguration immediately.
    await this.reader.readInputRegisters(this.plantUnitId, PLANT_PV_POWER, 2);
  }

  disconnect(): Promise<void> {
    return this.reader.disconnect();
  }

  async getRealtimeData(): Promise<EnergyData> {
    const solarProductionW = powerToWatts(
      readS32(await this.read(this.plantUnitId, PLANT_PV_POWER, 2)),
    );
    const gridPowerW = powerToWatts(
      readS32(await this.read(this.plantUnitId, PLANT_GRID_POWER, 2)),
    );
    const batteryPowerW = await this.readBatteryPowerW();
    const batterySoc = await this.readBatterySoc();
    const gridVoltageV = await this.readGridVoltageV();

    const homeConsumptionW = Math.max(
      0,
      solarProductionW + gridPowerW + (batteryPowerW ?? 0),
    );

    return {
      solarProductionW,
      gridPowerW,
      homeConsumptionW,
      batteryPowerW,
      batterySoc,
      gridVoltageV,
      lastUpdated: new Date().toISOString(),
    };
  }

  async getCumulativeData(): Promise<CumulativeEnergyData> {
    const gridExportedWh = energyToWh(
      readU64(await this.read(this.deviceUnitId, DEVICE_ACC_EXPORT_ENERGY, 4)),
    );
    const gridImportedWh = energyToWh(
      readU64(await this.read(this.deviceUnitId, DEVICE_ACC_IMPORT_ENERGY, 4)),
    );

    // Sigenergy exposes no cumulative/daily PV-generation register (Home
    // Assistant integrates it from power). ChargeHA's EnergyPoller derives
    // daily solar and daily grid totals from DB recordings anyway, so the solar
    // and daily fields are left at 0 here.
    return {
      solarProducedWh: 0,
      gridImportedWh,
      gridExportedWh,
      dailySolarProducedWh: 0,
      dailyGridImportWh: 0,
      dailyGridExportWh: 0,
    };
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    const modelBuf = await this.tryRead(
      this.deviceUnitId,
      DEVICE_MODEL_TYPE,
      15,
    );
    const serialBuf = await this.tryRead(this.deviceUnitId, DEVICE_SERIAL, 10);
    const model = modelBuf ? readAsciiString(modelBuf) : "";
    const serial = serialBuf ? readAsciiString(serialBuf) : "";

    return {
      id: serial || "unknown",
      name: model || "Sigenergy",
      manufacturer: "Sigenergy",
      model: model || "Unknown",
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** + discharge / − charge (negated from Sigenergy's charge-positive sign). */
  private async readBatteryPowerW(): Promise<number | null> {
    const buf = await this.tryRead(this.plantUnitId, PLANT_BATTERY_POWER, 2);
    return buf ? -powerToWatts(readS32(buf)) : null;
  }

  private async readBatterySoc(): Promise<number | null> {
    const buf = await this.tryRead(this.plantUnitId, PLANT_ESS_SOC, 1);
    return buf ? socPercent(readU16(buf)) : null;
  }

  private async readGridVoltageV(): Promise<number | null> {
    const buf = await this.tryRead(
      this.deviceUnitId,
      DEVICE_PHASE_A_VOLTAGE,
      2,
    );
    return buf ? voltageToVolts(readU32(buf)) : null;
  }

  /** Required read — a failure propagates and fails the poll. */
  private read(
    unitId: number,
    address: number,
    count: number,
  ): Promise<Buffer> {
    return this.reader.readInputRegisters(unitId, address, count);
  }

  /** Optional read — logs and resolves null on failure so a missing register
   *  (e.g. voltage on a solar-only unit) never fails the whole poll. */
  private async tryRead(
    unitId: number,
    address: number,
    count: number,
  ): Promise<Buffer | null> {
    try {
      return await this.reader.readInputRegisters(unitId, address, count);
    } catch (err) {
      this.logger.warn(
        `Sigenergy optional read at ${address} (unit ${unitId}) failed: ${err}`,
      );
      return null;
    }
  }
}
