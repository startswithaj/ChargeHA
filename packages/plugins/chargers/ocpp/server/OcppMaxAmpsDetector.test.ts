import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Logger } from "@chargeha/server/lib/Logger";
import { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import { OcppMaxAmpsDetector } from "./OcppMaxAmpsDetector.ts";

describe("OcppMaxAmpsDetector", () => {
  const CP = "MG-10407939";

  const detectorFor = (response: unknown) => {
    const calls: Array<{ action: string; payload: unknown }> = [];
    const persisted: Array<{ message: string; payload: string | null }> = [];
    const logger = new Logger("OcppTest", "error");
    const detector = new OcppMaxAmpsDetector(
      (_id, action, payload) => {
        calls.push({ action, payload });
        if (response instanceof Error) return Promise.reject(response);
        return Promise.resolve(response);
      },
      new PluginDbLogger((entry) => {
        persisted.push({ message: entry.message, payload: entry.payload });
        return Promise.resolve();
      }, logger),
    );
    return { detector, calls, persisted };
  };

  it("asks for the full configuration dump", async () => {
    const { detector, calls } = detectorFor({ configurationKey: [] });

    await detector.detect(CP);

    expect(calls).toEqual([{ action: "GetConfiguration", payload: {} }]);
  });

  it("detects from an exact known key", async () => {
    const { detector } = detectorFor({
      configurationKey: [
        { key: "HeartbeatInterval", readonly: false, value: "300" },
        { key: "MaxChargingCurrent", readonly: true, value: "16" },
      ],
    });

    await detector.detect(CP);

    expect(detector.detectedMaxAmps(CP)).toBe(16);
  });

  it("prefers a readonly known key over a settable one", async () => {
    const { detector } = detectorFor({
      configurationKey: [
        { key: "ChargingCurrentLimit", readonly: false, value: "20" },
        { key: "MaxChargingCurrent", readonly: true, value: "16" },
      ],
    });

    await detector.detect(CP);

    expect(detector.detectedMaxAmps(CP)).toBe(16);
  });

  it("logs but never trusts a substring-only match", async () => {
    const { detector, persisted } = detectorFor({
      configurationKey: [
        { key: "MaxCurrentOffset", readonly: true, value: "6" },
      ],
    });

    await detector.detect(CP);

    expect(detector.detectedMaxAmps(CP)).toBe(null);
    expect(persisted.some((p) => p.message.includes("none confident"))).toBe(
      true,
    );
  });

  it("ignores implausible and unparseable values", async () => {
    const { detector } = detectorFor({
      configurationKey: [
        { key: "MaxChargingCurrent", value: "0" },
        { key: "MaximumCurrent", value: "5000" },
        { key: "MaxCurrent", value: "not-a-number" },
      ],
    });

    await detector.detect(CP);

    expect(detector.detectedMaxAmps(CP)).toBe(null);
  });

  it("redacts sensitive values in the logged dump", async () => {
    const { detector, persisted } = detectorFor({
      configurationKey: [
        { key: "AuthorizationKey", readonly: false, value: "s3cret" },
        { key: "HeartbeatInterval", value: "300" },
      ],
    });

    await detector.detect(CP);

    const dump = persisted.find((p) =>
      p.message.startsWith("GetConfiguration")
    );
    expect(dump?.payload).toContain("[redacted]");
    expect(dump?.payload).not.toContain("s3cret");
    expect(dump?.payload).toContain("300");
  });

  it("rate-limits re-detection but reflects a changed limit after the window", async () => {
    const { detector, calls } = detectorFor({
      configurationKey: [{ key: "MaxChargingCurrent", value: "16" }],
    });

    await detector.detect(CP);
    await detector.detect(CP);

    expect(calls).toHaveLength(1);
    expect(detector.detectedMaxAmps(CP)).toBe(16);
  });

  it("survives a charger that rejects GetConfiguration", async () => {
    const { detector } = detectorFor(new Error("NotSupported"));

    await detector.detect(CP);

    expect(detector.detectedMaxAmps(CP)).toBe(null);
  });

  it("keeps detections separate per charge point", async () => {
    const { detector } = detectorFor({
      configurationKey: [{ key: "MaxChargingCurrent", value: "16" }],
    });

    await detector.detect(CP);

    expect(detector.detectedMaxAmps(CP)).toBe(16);
    expect(detector.detectedMaxAmps("other")).toBe(null);
  });
});
