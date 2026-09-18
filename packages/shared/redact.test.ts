import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { redactForStdout, shortId } from "./redact.ts";

describe("shortId", () => {
  const VIN = "5YJ3E1EA7KF317000";

  it("keeps only the last 6 chars of a VIN", () => {
    expect(shortId(VIN)).toBe("…317000");
  });

  it("shortens a VIN embedded in a longer id", () => {
    expect(shortId(`cp-${VIN}`)).toBe("cp-…317000");
  });

  it("shortens a VIN inside an API path", () => {
    expect(shortId(`/api/1/vehicles/${VIN}/vehicle_data`)).toBe(
      "/api/1/vehicles/…317000/vehicle_data",
    );
  });

  it("leaves non-VIN ids alone", () => {
    expect(shortId("ocpp-charger-1")).toBe("ocpp-charger-1");
    expect(shortId("3f1c2b4a-0000-4000-8000-000000000000")).toBe(
      "3f1c2b4a-0000-4000-8000-000000000000",
    );
  });
});

describe("redactForStdout", () => {
  const VIN = "5YJ3E1EA7KF317000";

  it("redacts location keys at any depth", () => {
    const out = redactForStdout({
      response: {
        drive_state: { latitude: -33.8, longitude: 151.2, heading: 90 },
        charge_state: { battery_level: 50 },
      },
    }) as { response: Record<string, Record<string, unknown>> };
    expect(out.response.drive_state).toEqual({
      latitude: "[redacted]",
      longitude: "[redacted]",
      heading: "[redacted]",
    });
    expect(out.response.charge_state).toEqual({ battery_level: 50 });
  });

  it("shortens VINs in strings, including inside arrays", () => {
    expect(redactForStdout({ vin: VIN, ids: [VIN, "other"] })).toEqual({
      vin: "…317000",
      ids: ["…317000", "other"],
    });
  });

  it("passes primitives through", () => {
    expect(redactForStdout(42)).toBe(42);
    expect(redactForStdout(null)).toBe(null);
    expect(redactForStdout(true)).toBe(true);
  });
});
