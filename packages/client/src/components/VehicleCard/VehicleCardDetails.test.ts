import { describe, expect, it } from "vitest";
import { formatReasonLabel } from "./VehicleCardDetails.tsx";

describe("formatReasonLabel", () => {
  it("keeps full battery percentages for battery_priority", () => {
    expect(
      formatReasonLabel(
        "battery_priority",
        "Waiting for home battery (57% < 75%)",
      ),
    ).toBe("Home battery priority (57% < 75%)");
  });

  it("falls back when battery_priority detail has no percentages", () => {
    expect(formatReasonLabel("battery_priority", "hold"))
      .toBe("Waiting for home battery");
  });
});
