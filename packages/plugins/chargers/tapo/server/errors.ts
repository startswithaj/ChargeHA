export class TapoConnectionError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name = "TapoConnectionError";
  }
}

/** Handshake hash mismatch — wrong Tapo account email/password. */
export class TapoAuthError extends Error {
  constructor() {
    super("Tapo rejected the credentials (handshake hash mismatch)");
    this.name = "TapoAuthError";
  }
}

/** Guidance shared by every surface that reports a locked plug. The setting
 *  takes effect immediately — the plug switches back to KLAP without a
 *  restart, confirmed against a P110(AU) on firmware 1.4.x. */
export const TAPO_THIRD_PARTY_HINT =
  "In the Tapo app open Me → Third-Party Services → Third-Party " +
  "Compatibility and turn it on.";

/**
 * The device answered but refused handshake1 outright (HTTP 403), so no
 * credentials were ever involved.
 *
 * Firmware 1.4.x ships with TP-Link's newer TPAP scheme preferred and KLAP —
 * the only protocol ChargeHA speaks — switched off until "Third-Party
 * Compatibility" is enabled in the Tapo app. Reported separately from a
 * credential failure because the fix is entirely different, and the raw 403
 * otherwise reads as "wrong password".
 */
export class TapoLockedError extends Error {
  constructor(readonly host: string) {
    super(
      `The Tapo device at ${host} is refusing local control. ` +
        TAPO_THIRD_PARTY_HINT,
    );
    this.name = "TapoLockedError";
  }
}

export class TapoApiError extends Error {
  constructor(readonly code: number, method: string) {
    super(`Tapo ${method} failed with error_code ${code}`);
    this.name = "TapoApiError";
  }
}
