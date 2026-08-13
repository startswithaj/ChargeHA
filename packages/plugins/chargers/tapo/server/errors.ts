export class TapoConnectionError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name = "TapoConnectionError";
  }
}

// Handshake hash mismatch — wrong Tapo account email/password.
export class TapoAuthError extends Error {
  constructor() {
    super("Tapo rejected the credentials (handshake hash mismatch)");
    this.name = "TapoAuthError";
  }
}

// Guidance shared by every surface that reports a locked plug. The setting
// takes effect immediately — the plug switches back to KLAP without a
// restart, confirmed against a P110(AU) on firmware 1.4.x.
export const TAPO_THIRD_PARTY_HINT =
  "In the Tapo app open Me → Third-Party Services → Third-Party " +
  "Compatibility and turn it on.";

// The device refused handshake1 outright (HTTP 403), no credentials involved.
// Firmware 1.4.x ships with TPAP preferred and KLAP switched off until
// "Third-Party Compatibility" is enabled — the raw 403 otherwise reads as "wrong password".
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
