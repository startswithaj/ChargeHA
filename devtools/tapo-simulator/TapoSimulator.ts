// A fake Tapo P110: real KLAP crypto over HTTP (reusing the plugin's
// KlapCrypto), simulated switch + energy meter. No Tapo cloud concepts.
import {
  KlapCrypto,
  type KlapSessionKeys,
} from "../../packages/plugins/chargers/tapo/server/KlapCrypto.ts";

export interface SimulatedDevice {
  email: string;
  password: string;
  deviceOn: boolean;
  /** Watts drawn while on (the "car"). 0 simulates an absent/full car. */
  drawWhenOnW: number;
  overheated: boolean;
  /** When true, all device endpoints time out (connection refused-like). */
  unreachable: boolean;
  /** Simulate a P100/P105: get_energy_usage returns an error. */
  meterless: boolean;
  todayEnergyWh: number;
  model: string;
}

interface SimSession {
  keys: KlapSessionKeys;
  cookie: string;
  lastSeq: number;
}

const defaultDevice = (): SimulatedDevice => ({
  email: "user@example.com",
  password: "example-password",
  deviceOn: false,
  drawWhenOnW: 0,
  overheated: false,
  unreachable: false,
  meterless: false,
  todayEnergyWh: 0,
  model: "P110",
});

export class TapoSimulator {
  device: SimulatedDevice = defaultDevice();
  private session: SimSession | null = null;
  private lastEnergyTickMs = Date.now();
  private pendingHandshake: {
    localSeed: Uint8Array<ArrayBuffer>;
    remoteSeed: Uint8Array<ArrayBuffer>;
  } | null = null;

  /** Device-facing handler: /app/handshake1, /app/handshake2, /app/request. */
  async handle(req: Request): Promise<Response> {
    if (this.device.unreachable) {
      // Hang forever: the client's own AbortSignal.timeout (5 s) is the only
      // path a real unreachable device exercises — answering 504 after a
      // sleep would be dead code and just slows the suite down.
      await new Promise(() => {});
    }
    const url = new URL(req.url);
    const body = new Uint8Array(await req.arrayBuffer());
    if (url.pathname === "/app/handshake1") return this.handshake1(body);
    if (url.pathname === "/app/handshake2") return this.handshake2(body);
    if (url.pathname === "/app/request") return this.request(req, url, body);
    return new Response("Not found", { status: 404 });
  }

  expireSession(): void {
    this.session = null;
  }

  /** Control-API mutator — route() must not assign into the simulator
   *  directly (no-param-mutation lint rule). */
  applyPatch(patch: Partial<SimulatedDevice>): void {
    this.device = { ...this.device, ...patch };
  }

  forceMidnightReset(): void {
    this.device.todayEnergyWh = 0;
  }

  private async authHash(): Promise<Uint8Array<ArrayBuffer>> {
    return await KlapCrypto.computeAuthHash(
      this.device.email,
      this.device.password,
    );
  }

  private async handshake1(
    localSeed: Uint8Array<ArrayBuffer>,
  ): Promise<Response> {
    if (localSeed.length !== 16) {
      return new Response("Bad seed", { status: 400 });
    }
    const remoteSeed = crypto.getRandomValues(new Uint8Array(16));
    const authHash = await this.authHash();
    const hash = await KlapCrypto.serverHash(localSeed, remoteSeed, authHash);
    const keys = await KlapCrypto.deriveSessionKeys(
      localSeed,
      remoteSeed,
      authHash,
    );
    const cookie = `TP_SESSIONID=${crypto.randomUUID()}`;
    this.session = { keys, cookie, lastSeq: keys.initialSeq };
    // Stash the seeds for handshake2 verification.
    this.pendingHandshake = { localSeed, remoteSeed };
    return new Response(KlapCrypto.concatBytes(remoteSeed, hash), {
      status: 200,
      headers: { "Set-Cookie": `${cookie};TIMEOUT=1440` },
    });
  }

  private async handshake2(body: Uint8Array<ArrayBuffer>): Promise<Response> {
    const pending = this.pendingHandshake;
    if (!pending) return new Response("No handshake1", { status: 403 });
    const expected = await KlapCrypto.handshake2Hash(
      pending.localSeed,
      pending.remoteSeed,
      await this.authHash(),
    );
    if (!KlapCrypto.bytesEqual(body, expected)) {
      return new Response("Forbidden", { status: 403 });
    }
    return new Response(null, { status: 200 });
  }

  private async request(
    req: Request,
    url: URL,
    body: Uint8Array<ArrayBuffer>,
  ): Promise<Response> {
    const session = this.session;
    const seq = parseInt(url.searchParams.get("seq") ?? "", 10);
    if (
      !session ||
      req.headers.get("Cookie") !== session.cookie ||
      !Number.isFinite(seq) ||
      seq <= session.lastSeq
    ) {
      return new Response("Forbidden", { status: 403 });
    }
    // Verify the request signature before decrypting.
    const expectedSig = await KlapCrypto.sha256(
      KlapCrypto.concatBytes(
        session.keys.sigKey,
        KlapCrypto.seqBytes(seq),
        body.slice(32),
      ),
    );
    if (!KlapCrypto.bytesEqual(body.slice(0, 32), expectedSig)) {
      return new Response("Forbidden", { status: 403 });
    }
    session.lastSeq = seq;

    const plaintext = await KlapCrypto.decryptPayload(session.keys, seq, body);
    const { method, params } = JSON.parse(new TextDecoder().decode(plaintext));
    const result = this.execute(method, params);
    const responseBytes = new TextEncoder().encode(JSON.stringify(result));
    const encrypted = await KlapCrypto.encryptPayload(
      session.keys,
      seq,
      responseBytes,
    );
    return new Response(encrypted, { status: 200 });
  }

  private execute(
    method: string,
    params: Record<string, unknown> | undefined,
  ): { error_code: number; result?: unknown } {
    switch (method) {
      case "get_device_info":
        return {
          error_code: 0,
          result: {
            device_on: this.device.deviceOn,
            model: this.device.model,
            fw_ver: "1.3.0 Build 240523",
            mac: "AA-BB-CC-00-11-22",
            nickname: btoa("Sim Plug"),
            overheated: this.device.overheated,
          },
        };
      case "set_device_info": {
        this.device.deviceOn = Boolean(
          (params as { device_on?: boolean })?.device_on,
        );
        return { error_code: 0, result: {} };
      }
      case "get_energy_usage": {
        if (this.device.meterless) return { error_code: -1001 };
        this.tickEnergy();
        return {
          error_code: 0,
          result: {
            current_power: this.device.deviceOn
              ? Math.round(this.device.drawWhenOnW * 1000) // mW
              : 0,
            today_energy: Math.round(this.device.todayEnergyWh),
            month_energy: Math.round(this.device.todayEnergyWh),
          },
        };
      }
      default:
        // P100/P105 simulation: control API can set model + this returns
        // an error for get_energy_usage via the meterless flag if needed.
        return { error_code: -1001 };
    }
  }

  /** Advance the accumulating meter by elapsed wall-clock time. */
  private tickEnergy(): void {
    const now = Date.now();
    const hours = (now - this.lastEnergyTickMs) / 3_600_000;
    this.lastEnergyTickMs = now;
    if (this.device.deviceOn) {
      this.device.todayEnergyWh += this.device.drawWhenOnW * hours;
    }
  }
}
