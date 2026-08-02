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

export class TapoApiError extends Error {
  constructor(readonly code: number, method: string) {
    super(`Tapo ${method} failed with error_code ${code}`);
    this.name = "TapoApiError";
  }
}
