import { describe, expect, it, vi } from "vitest";

// ChargerCard needs the tRPC context on mount; the gallery has it, tests do not.
vi.mock("../../../hooks/useChargers.ts", () => ({
  useChargerCommands: () => ({ commandPending: false, changeMode: vi.fn() }),
  useChargerRecovery: () => ({
    recover: vi.fn(),
    softReset: vi.fn(),
    recoverPending: false,
    softResetPending: false,
    recoverOutcome: undefined,
    softResetOutcome: undefined,
  }),
  isSmartCharger: (c: { kind: string }) => c.kind === "smart",
}));
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { Components } from "./Components.tsx";

describe("Components style guide", () => {
  it("renders every section from local fixtures", () => {
    renderWithProviders(<Components />);

    expect(screen.getByText("Component library")).toBeInTheDocument();

    ["common", "wizard", "dashboard", "settings"].forEach((id) => {
      expect(document.getElementById(id)).not.toBeNull();
    });

    // Titles appear twice: once in the index, once as the section heading.
    expect(screen.getAllByText("Buttons")).toHaveLength(2);
    expect(screen.getAllByText("Icon buttons")).toHaveLength(2);
    expect(screen.getAllByText("Badges")).toHaveLength(2);
    expect(screen.getAllByText("Entity rows")).toHaveLength(2);
    expect(screen.getAllByText("Vehicle cards")).toHaveLength(2);
    expect(document.getElementById("wizard-steps")).not.toBeNull();
  });

  // Must be safe to open with no server.
  it("makes no network calls", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderWithProviders(<Components />);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
