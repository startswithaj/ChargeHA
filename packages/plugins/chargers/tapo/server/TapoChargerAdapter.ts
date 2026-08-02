import type {
  CallContext,
  ChargerAdapter,
  ChargerInfo,
  ChargerState,
  ChargerStatus,
} from "@chargeha/shared";
import type { Logger } from "@chargeha/server/lib/Logger";
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
   *  faulted only after the stale timeout. */
  private staleState(error: unknown): ChargerState {
    const last = this.lastState;
    if (!last || this.lastGoodAt === null) {
      throw error instanceof Error
        ? error
        : new TapoConnectionError(String(error));
    }
    const staleMs = this.config.staleTimeoutSeconds * 1000;
    const isStale = Date.now() - this.lastGoodAt >= staleMs;
    this.logger.warn(
      `Poll failed (${error}); serving ${isStale ? "stale" : "last"} state`,
    );
    if (!isStale) return last;
    return { ...last, status: "faulted", statusDetail: "unreachable" };
  }

  private async setDeviceOn(on: boolean): Promise<boolean> {
    const info = await this.client.request<TapoDeviceInfo>("get_device_info");
    if (info.device_on === on) return true;
    await this.client.request("set_device_info", { device_on: on });
    this.logger.info(`Plug switched ${on ? "on" : "off"}`);
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
