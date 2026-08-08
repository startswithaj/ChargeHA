import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import { ChargerCard } from "./ChargerCard.tsx";
import type { ChargerState } from "@chargeha/shared";

vi.mock("../../../hooks/useChargers.ts", () => ({
  useChargerCommands: () => ({
    commandPending: false,
    changeMode: vi.fn(),
  }),
}));

describe("ChargerCard", () => {
  const STATE: ChargerState = {
    chargerId: "c1",
    isCharging: false,
    isPluggedIn: true,
    chargeAmps: 0,
    chargeAmpsMax: 32,
    chargeAmpsMin: 6,
    chargePowerKw: 0,
    chargerVoltage: 230,
    chargerPhases: 1,
    energyAddedKwh: 0,
    status: "available",
    statusDetail: null,
    lastUpdated: "2024-01-01T00:00:00.000Z",
  };

  const renderCard = (
    vehicleResolution: "linked" | "inferred" | "ambiguous" | "none",
  ) =>
    render(
      <Theme>
        <ChargerCard
          id="c1"
          name="Garage Plug"
          mode="auto"
          state={STATE}
          solarW={0}
          gridW={0}
          controllerDetail={null}
          vehicleResolution={vehicleResolution}
        />
      </Theme>,
    );

  afterEach(cleanup);

  it("warns when two cars are plugged in and none is assigned", () => {
    renderCard("ambiguous");

    expect(
      screen.getByText(/Two cars are plugged in/),
    ).toBeInTheDocument();
  });

  it("shows no warning once resolution is unambiguous", () => {
    renderCard("inferred");

    expect(screen.queryByText(/Two cars are plugged in/)).not
      .toBeInTheDocument();
  });

  it("shows no warning for an explicitly linked vehicle", () => {
    renderCard("linked");

    expect(screen.queryByText(/Two cars are plugged in/)).not
      .toBeInTheDocument();
  });
});
