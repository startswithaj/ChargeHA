export class PowerwallGatewayAuthError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name = "PowerwallGatewayAuthError";
  }
}

interface ConnectionErrorOptions {
  cause?: Error;
  status?: number;
  retryAfterMs?: number;
}

export class PowerwallGatewayConnectionError extends Error {
  readonly status?: number;
  readonly retryAfterMs?: number;
  constructor(
    message: string,
    options: ConnectionErrorOptions = {},
  ) {
    super(message, { cause: options.cause });
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
    this.name = "PowerwallGatewayConnectionError";
  }
}

// Only plugin-created diagnostic messages are trusted. Arbitrary dependencies,
// response errors and cleanup exceptions must not cross into core/public output.
export class PowerwallTelemetryError extends Error {}

export function safePowerwallError(error: unknown): Error {
  if (error instanceof PowerwallGatewayAuthError) {
    return new PowerwallGatewayAuthError(error.message);
  }
  if (error instanceof PowerwallGatewayConnectionError) {
    return new PowerwallGatewayConnectionError(error.message, {
      status: error.status,
      retryAfterMs: error.retryAfterMs,
    });
  }
  if (error instanceof PowerwallTelemetryError) {
    return new PowerwallTelemetryError(error.message);
  }
  return new PowerwallGatewayConnectionError(
    "Powerwall connection failed; check Gateway availability and credentials",
  );
}
