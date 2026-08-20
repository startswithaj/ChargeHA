// Shared by the legacy portal client, the SEMS+ client, and the adapter, so
// neither backend has to import the other to classify a failure.

export class GoodweSemsAuthError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name = "GoodweSemsAuthError";
  }
}

export class GoodweSemsConnectionError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name = "GoodweSemsConnectionError";
  }
}

// Both backends use GY0429 today; the parameter keeps this file free of a
// third copy of a code the clients each define for themselves.
export class GoodweSemsRateLimitError extends Error {
  constructor(readonly retryAfterMs: number, code = "GY0429") {
    super(`SEMS rate limited (${code})`);
    this.name = "GoodweSemsRateLimitError";
  }
}
