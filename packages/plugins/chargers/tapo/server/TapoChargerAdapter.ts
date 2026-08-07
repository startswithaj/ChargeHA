import type {
  CallContext,
  ChargerAdapter,
  ChargerInfo,
  ChargerState,
  ChargerStatus,
} from "@chargeha/shared";
import type { Logger } from "@chargeha/server/lib/Logger";
import type { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import { KlapClient } from "./KlapClient.ts";
import { TapoConnectionError } from "./errors.ts";

export interface TapoDeviceInfo {
  device_on: boolean;
  model: string;
  fw_ver: string;
  mac: string;
  nickname: string; // base64
  overheated: boolean;
}

export interface TapoEnergyUsage {
  current_power: number; // mW
  today_energy: number; // Wh
  month_energy: number; // Wh
}

export interface TapoAdapterConfig {
  chargerId: string;
  fixedDrawAmps: number;
  detectionThresholdW: number;
  pollSeconds: number;
  staleTimeoutSeconds: number;
}

// Session end needs this many consecutive below-threshold polls.
const SESSION_END_POLLS = 2;

interface DrawSession {
  active: boolean;
  belowCount: number;
  prevTodayWh: number | null;
  addedKwh: number;
}

export class TapoChargerAdapter implements ChargerAdapter {
  private lastState: ChargerState | null = null;
  private lastGoodAt: number | null = null;
  // Starts the stale window when no poll ever succeeded (offline at boot).
  private firstAttemptAt: number | null = null;
  // Frozen for the outage: core emits charger_update on lastUpdated change.
  private unreachableAt: string | null = null;
  private session: DrawSession = {
    active: false,
    belowCount: 0,
    prevTodayWh: null,
    addedKwh: 0,
  };

  constructor(
    private readonly config: TapoAdapterConfig,
    private readonly client: KlapClient,
    private readonly logger: Logger,
    private readonly dbLog: PluginDbLogger,
  ) {}

  pollIntervalSeconds(): number {
    return this.config.pollSeconds;
  }

  // No connect(): the KLAP client handshakes lazily on the first request,
  // and the meterless (P100/P105) rejection happens at setup via the
  // wizard's testConnection — an offline plug can never block startup.

  disconnect(): Promise<void> {
    return Promise.resolve();
  }

  async startCharging(_ctx: CallContext): Promise<boolean> {
    return await this.setDeviceOn(true);
  }

  async stopCharging(_ctx: CallContext): Promise<boolean> {
    return await this.setDeviceOn(false);
  }

  /** Switch-only charger — the controller never calls this (controlMode). */
  setChargeAmps(_amps: number, _ctx: CallContext): Promise<boolean> {
    return Promise.resolve(false);
  }

  async getChargerState(_ctx: CallContext): Promise<ChargerState> {
    this.firstAttemptAt ??= Date.now();
    try {
      // Sequential on purpose: one in-flight request per plug — the KLAP
      // session is strictly sequenced and embedded servers handle
      // concurrent requests poorly.
      const info = await this.client.request<TapoDeviceInfo>("get_device_info");
      const energy = await this.client.request<TapoEnergyUsage>(
        "get_energy_usage",
      );
      const state = this.buildState(info, energy);
      this.lastState = state;
      this.lastGoodAt = Date.now();
      this.unreachableAt = null;
      return state;
    } catch (error) {
      return this.staleState(error);
    }
  }

  async getChargerInfo(_ctx: CallContext): Promise<ChargerInfo> {
    const info = await this.client.request<TapoDeviceInfo>("get_device_info");
    return {
      id: info.mac,
      name: decodeNickname(info.nickname, this.logger),
      vendor: "TP-Link",
      model: info.model,
      firmwareVersion: info.fw_ver,
      maxAmps: this.config.fixedDrawAmps,
      minAmps: this.config.fixedDrawAmps,
      phases: 1,
      connectorCount: 1,
      controlMode: "switch",
    };
  }

  // ── State mapping ────────────────────────────────────────────────────

  private buildState(
    info: TapoDeviceInfo,
    energy: TapoEnergyUsage,
  ): ChargerState {
    const powerW = energy.current_power / 1000;
    const aboveThreshold = powerW >= this.config.detectionThresholdW;
    // isCharging = deviceOn && power >= threshold — the switch
    // being off gates the session regardless of a stale power reading.
    const isCharging = this.updateSession(
      info.device_on && aboveThreshold,
      energy.today_energy,
      info.device_on,
    );
    const status = computeStatus(info, isCharging);

    return {
      chargerId: this.config.chargerId,
      isCharging,
      isPluggedIn: null,
      chargeAmps: null,
      chargeAmpsMax: this.config.fixedDrawAmps,
      chargeAmpsMin: this.config.fixedDrawAmps,
      chargePowerKw: powerW / 1000,
      chargerVoltage: null,
      chargerPhases: 1,
      energyAddedKwh: this.session.addedKwh,
      status,
      statusDetail: statusDetail(info, powerW, this.config.detectionThresholdW),
      lastUpdated: new Date().toISOString(),
    };
  }

  /** Draw-based session tracking: start on threshold crossing, end only after
   *  SESSION_END_POLLS consecutive below-threshold readings. Session energy
   *  accumulates today_energy deltas; a negative delta is the midnight reset,
   *  where the new today value is the since-midnight contribution. */
  private updateSession(
    aboveThreshold: boolean,
    todayWh: number,
    deviceOn: boolean,
  ): boolean {
    const s = this.session;

    if (!deviceOn && s.active) {
      // Off = definitely not charging: end now, don't wait out the
      // 2-poll grace that exists for measurement jitter.
      this.session = { ...s, active: false, belowCount: 0 };
      return false;
    }
    if (!s.active && aboveThreshold) {
      this.session = {
        active: true,
        belowCount: 0,
        prevTodayWh: todayWh,
        addedKwh: 0,
      };
      return true;
    }
    if (!s.active) return false;

    const delta = s.prevTodayWh === null ? 0 : todayWh - s.prevTodayWh;
    const addedKwh = s.addedKwh + (delta >= 0 ? delta : todayWh) / 1000;
    const belowCount = aboveThreshold ? 0 : s.belowCount + 1;
    const active = belowCount < SESSION_END_POLLS;
    this.session = { active, belowCount, prevTodayWh: todayWh, addedKwh };
    return active;
  }

  /** A failed poll is not "stopped drawing": retain the last state, flip to
   *  faulted only after the stale timeout. With no state to retain, the fault
   *  is built from config so the dashboard can still say "unreachable". */
  private staleState(error: unknown): ChargerState {
    const since = this.lastGoodAt ?? this.firstAttemptAt;
    const staleMs = this.config.staleTimeoutSeconds * 1000;
    const isStale = since !== null && Date.now() - since >= staleMs;
    this.logger.warn(
      `Poll failed (${error}); ${
        isStale ? "reporting the plug unreachable" : "serving last state"
      }`,
    );
    if (!isStale) {
      // Grace window, nothing cached: only a failure to report.
      if (!this.lastState) {
        throw error instanceof Error
          ? error
          : new TapoConnectionError(String(error));
      }
      return this.lastState;
    }
    // Log only the transition into "unreachable", not every subsequent poll
    // while it stays down — a dead plug would otherwise flood the table.
    if (this.unreachableAt === null) {
      this.dbLog.warn(`Plug unreachable (${this.config.chargerId})`, {
        payload: {
          chargerId: this.config.chargerId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
    this.unreachableAt ??= new Date().toISOString();
    return {
      ...(this.lastState ?? this.unknownDevice()),
      status: "faulted",
      statusDetail: "unreachable",
      lastUpdated: this.unreachableAt,
    };
  }

  /** A plug that never answered: observed fields null (no invented zeroes),
   *  amp limits from config. Status and timestamp are the caller's. */
  private unknownDevice(): Omit<
    ChargerState,
    "status" | "statusDetail" | "lastUpdated"
  > {
    return {
      chargerId: this.config.chargerId,
      isCharging: false,
      isPluggedIn: null,
      chargeAmps: null,
      chargeAmpsMax: this.config.fixedDrawAmps,
      chargeAmpsMin: this.config.fixedDrawAmps,
      chargePowerKw: null,
      chargerVoltage: null,
      chargerPhases: 1,
      energyAddedKwh: 0,
    };
  }

  private async setDeviceOn(on: boolean): Promise<boolean> {
    const info = await this.client.request<TapoDeviceInfo>("get_device_info");
    if (info.device_on === on) return true;
    await this.client.request("set_device_info", { device_on: on });
    this.logger.info(`Plug switched ${on ? "on" : "off"}`);
    // State change, not routine polling — worth an info row.
    this.dbLog.info(
      `Plug switched ${on ? "on" : "off"} (${this.config.chargerId})`,
      {
        payload: { chargerId: this.config.chargerId, on },
      },
    );
    return true;
  }
}

function computeStatus(
  info: TapoDeviceInfo,
  isCharging: boolean,
): ChargerStatus {
  if (info.overheated) return "faulted";
  if (!info.device_on) return "available";
  return isCharging ? "charging" : "no_draw";
}

function statusDetail(
  info: TapoDeviceInfo,
  powerW: number,
  thresholdW: number,
): string {
  if (info.overheated) return "overheated";
  if (!info.device_on) return "off";
  const watts = Math.round(powerW).toLocaleString("en-US");
  return powerW >= thresholdW
    ? `on, drawing ${watts} W`
    : `on, drawing ${watts} W (below ${thresholdW} W threshold)`;
}

function decodeNickname(base64: string, logger: Logger): string {
  try {
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
    );
    return decoded || "Tapo Plug";
  } catch (error) {
    // Nickname is cosmetic — fall back rather than fail the info call.
    logger.debug(`Could not decode plug nickname: ${error}`);
    return "Tapo Plug";
  }
}
