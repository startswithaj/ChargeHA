import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    resolvedVehicleName: string | null = null,
    identifier: string | null = null,
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
          resolvedVehicleName={resolvedVehicleName}
          identifier={identifier}
        />
      </Theme>,
    );

  afterEach(cleanup);

  it("warns when two cars are plugged in and none is assigned", () => {
    renderCard("ambiguous");

    expect(
      screen.getByText(/Two vehicles are plugged in/),
    ).toBeInTheDocument();
  });

  it("shows no warning once resolution is unambiguous", () => {
    renderCard("inferred");

    expect(screen.queryByText(/Two vehicles are plugged in/)).not
      .toBeInTheDocument();
  });

  it("shows no warning for an explicitly linked vehicle", () => {
    renderCard("linked");

    expect(screen.queryByText(/Two vehicles are plugged in/)).not
      .toBeInTheDocument();
  });

  it("names the car it detected", () => {
    renderCard("inferred", "Demo EV");
    expect(screen.getByText("Demo EV detected automatically"))
      .toBeInTheDocument();
  });

  it("says the car was assigned when it was", () => {
    renderCard("linked", "Demo EV");
    expect(screen.getByText("Demo EV assigned to this charger"))
      .toBeInTheDocument();
  });

  it("names no car when nothing resolved", () => {
    renderCard("none");
    expect(
      screen.queryByText(/detected automatically|assigned to this charger/),
    ).not.toBeInTheDocument();
  });

  it("names no car while two are plugged in", () => {
    renderCard("ambiguous");
    expect(
      screen.queryByText(/detected automatically|assigned to this charger/),
    ).not.toBeInTheDocument();
  });

  it("says nothing will charge while two cars are plugged in", () => {
    renderCard("ambiguous");
    expect(screen.getByText(/nothing will charge until you assign a vehicle/))
      .toBeInTheDocument();
  });

  // The warning has to be actionable, not a description of where to go.
  it("links the ambiguous warning to the chargers settings", () => {
    const onNavigateSettings = vi.fn();
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
          vehicleResolution="ambiguous"
          resolvedVehicleName={null}
          identifier={null}
          onNavigateSettings={onNavigateSettings}
        />
      </Theme>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Settings" }));
    expect(onNavigateSettings).toHaveBeenCalled();
  });

  it("keeps the warning readable when there is nowhere to navigate", () => {
    renderCard("ambiguous");

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText(/assign a vehicle to this charger in/))
      .toBeInTheDocument();
  });

  it("stays silent when the resolved vehicle is not in the list", () => {
    renderCard("inferred", null);
    expect(
      screen.queryByText(/detected automatically|assigned to this charger/),
    ).not.toBeInTheDocument();
  });

  // A charger that has sent no StatusNotification reports that absence as its
  // detail, which contradicts the badge, the status line and the amps row.
  it("drops the device's own status detail while it is charging", () => {
    render(
      <Theme>
        <ChargerCard
          id="c1"
          name="Garage Plug"
          mode="auto"
          state={{
            ...STATE,
            isCharging: true,
            status: "charging",
            statusDetail: "connected, no status yet",
          }}
          solarW={0}
          gridW={0}
          controllerDetail={null}
          vehicleResolution="none"
          resolvedVehicleName={null}
          identifier={null}
        />
      </Theme>,
    );

    expect(screen.queryByText(/no status yet/i)).not.toBeInTheDocument();
  });

  it("keeps the device's status detail when it is not charging", () => {
    render(
      <Theme>
        <ChargerCard
          id="c1"
          name="Garage Plug"
          mode="auto"
          state={{ ...STATE, statusDetail: "SuspendedEV" }}
          solarW={0}
          gridW={0}
          controllerDetail={null}
          vehicleResolution="none"
          resolvedVehicleName={null}
          identifier={null}
        />
      </Theme>,
    );

    expect(screen.getByText("SuspendedEV")).toBeInTheDocument();
  });

  // Amps are derived from power ÷ voltage ÷ phases when the charger reports no
  // current measurand, so the decimals are an artefact of that division.
  it("rounds derived amps to whole numbers", () => {
    render(
      <Theme>
        <ChargerCard
          id="c1"
          name="Garage Plug"
          mode="auto"
          state={{
            ...STATE,
            isCharging: true,
            status: "charging",
            chargeAmps: 16.13,
            chargeAmpsMax: 32,
          }}
          solarW={0}
          gridW={0}
          controllerDetail={null}
          vehicleResolution="none"
          resolvedVehicleName={null}
          identifier={null}
        />
      </Theme>,
    );

    expect(screen.getByText("16A / 32A max")).toBeInTheDocument();
    expect(screen.queryByText(/16\.13/)).not.toBeInTheDocument();
  });

  // The heading is often just the plugin's label, so the id is the only thing
  // on the card saying which physical charger it is.
  it("badges the charge point id", () => {
    renderCard("none", null, "vcp-dev-2");
    expect(screen.getByTitle("Charge point id")).toHaveTextContent("vcp-dev-2");
  });

  it("shows no id badge for an adapter without one", () => {
    renderCard("none");
    expect(screen.queryByTitle("Charge point id")).not.toBeInTheDocument();
  });

  // The same formatted row the vehicle card uses, rather than the raw
  // controller string.
  it("formats a controller reason it has phrasing for", () => {
    render(
      <Theme>
        <ChargerCard
          id="c1"
          name="Garage Plug"
          mode="auto"
          state={STATE}
          solarW={0}
          gridW={0}
          controllerDetail="schedule 22:00-06:00"
          controllerReason="schedule"
          vehicleResolution="none"
          resolvedVehicleName={null}
          identifier={null}
        />
      </Theme>,
    );

    expect(screen.getByText("Charging on schedule (22:00-06:00)"))
      .toBeInTheDocument();
    expect(screen.queryByText("schedule 22:00-06:00")).not.toBeInTheDocument();
  });

  it("falls back to the raw detail for a reason it has no phrasing for", () => {
    render(
      <Theme>
        <ChargerCard
          id="c1"
          name="Garage Plug"
          mode="auto"
          state={STATE}
          solarW={0}
          gridW={0}
          controllerDetail="tracking solar at 12A"
          controllerReason="solar_tracking"
          vehicleResolution="none"
          resolvedVehicleName={null}
          identifier={null}
        />
      </Theme>,
    );

    expect(screen.getByText("tracking solar at 12A")).toBeInTheDocument();
  });
});
