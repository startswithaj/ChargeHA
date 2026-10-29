import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  PowerwallGatewayAuthError,
  PowerwallGatewayConnectionError,
  PowerwallTelemetryError,
  safePowerwallError,
} from "./errors.ts";

describe("Powerwall public error boundary", () => {
  it("normalizes unknown failures without raw messages, causes or arbitrary properties", () => {
    const raw = Object.assign(
      new Error("PRIVATE_BODY", { cause: new Error("PRIVATE_CAUSE") }),
      { response: "PRIVATE_RESPONSE" },
    );
    const safe = safePowerwallError(raw);

    expect(safe.message).toContain("Powerwall connection failed");
    expect(safe.cause).toBeUndefined();
    expect(JSON.stringify(safe)).not.toContain("PRIVATE_");
  });

  it("retains trusted status/cooldown diagnostics without retaining their cause", () => {
    const safe = safePowerwallError(
      new PowerwallGatewayConnectionError(
        "Powerwall Gateway returned HTTP 503; cooling down",
        {
          status: 503,
          retryAfterMs: 300000,
          cause: new Error("PRIVATE_CAUSE"),
        },
      ),
    );

    expect(safe).toMatchObject({ status: 503, retryAfterMs: 300000 });
    expect(safe.message).toContain("503; cooling down");
    expect(safe.cause).toBeUndefined();
  });

  it("retains plugin-authored authentication and telemetry diagnoses", () => {
    const auth = safePowerwallError(
      new PowerwallGatewayAuthError(
        "Powerwall Gateway login returned no session token",
      ),
    );
    const telemetry = safePowerwallError(
      new PowerwallTelemetryError("Powerwall telemetry is stale"),
    );

    expect(auth).toBeInstanceOf(PowerwallGatewayAuthError);
    expect(telemetry.message).toBe("Powerwall telemetry is stale");
  });
});
