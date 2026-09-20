import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { Simulator } from "./Simulator.tsx";

describe("Simulator", () => {
  it("starts with two charging points and lets a new one be added", () => {
    renderWithProviders(<Simulator />);

    expect(screen.getAllByLabelText("Name")).toHaveLength(2);

    fireEvent.click(screen.getByText("+ Add Charging Point"));

    expect(screen.getAllByLabelText("Name")).toHaveLength(3);
  });

  it("runs the real engine and shows per-charging-point results", async () => {
    renderWithProviders(<Simulator />);

    fireEvent.click(screen.getByText("Run Simulation"));

    await waitFor(() => {
      expect(screen.getByText(/Done in \d+ms/)).toBeInTheDocument();
    });

    // The stats row reports starts/stops/battery per configured vehicle name.
    expect(screen.getAllByText(/EV 1/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/EV 2/).length).toBeGreaterThan(0);
  });

  it("charges less when a car only plugs in at noon", async () => {
    renderWithProviders(<Simulator />);
    const ev1Battery = () => {
      const stat = screen.getAllByText(/starts/).map((el) =>
        el.closest("div")?.textContent ?? ""
      ).find((t) => t.startsWith("EV 1"));
      return Number(stat?.match(/battery ([\d.]+)%/)?.[1]);
    };

    fireEvent.click(screen.getByText("Run Simulation"));
    await waitFor(() => {
      expect(screen.getByText(/Done in \d+ms/)).toBeInTheDocument();
    });
    const allDay = ev1Battery();

    fireEvent.change(screen.getByLabelText("EV 1 plug-in time"), {
      target: { value: String(12 * 60) },
    });
    fireEvent.click(screen.getByText("Run Simulation"));
    await waitFor(() => expect(ev1Battery()).toBeLessThan(allDay));
  });

  it("removes a charging point down to a minimum of one", () => {
    renderWithProviders(<Simulator />);

    fireEvent.click(screen.getByRole("button", { name: "Remove EV 2" }));
    expect(screen.getAllByLabelText("Name")).toHaveLength(1);

    // The last remaining charging point cannot be removed.
    expect(screen.getByRole("button", { name: "Remove EV 1" })).toBeDisabled();
  });
});
