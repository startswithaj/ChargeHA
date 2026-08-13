import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { VehicleControlToggle } from "./VehicleControlToggle.tsx";

const { chargersRef, mutate } = vi.hoisted(() => ({
  chargersRef: { current: [] as unknown[] },
  mutate: vi.fn(),
}));

vi.mock("../../../hooks/useChargers.ts", () => ({
  useChargers: () => ({ chargers: chargersRef.current, isLoading: false }),
  isSmartCharger: (c: { kind: string }) => c.kind === "smart",
}));

vi.mock("../../../trpc.ts", () => ({
  trpc: {
    useUtils: () => ({ charger: { list: { invalidate: vi.fn() } } }),
    charger: {
      setVehicleControl: {
        useMutation: () => ({ mutate, isPending: false }),
      },
    },
  },
}));

describe("VehicleControlToggle", () => {
  const smart = { id: "wallbox", kind: "smart", vehicleId: null, active: true };
  const linked = {
    id: "cp-VIN1",
    kind: "vehicle_api",
    vehicleId: "VIN1",
    active: true,
  };

  beforeEach(() => {
    chargersRef.current = [];
    mutate.mockClear();
  });

  afterEach(cleanup);

  it("stays hidden when no smart charger offers an alternative", () => {
    chargersRef.current = [linked];
    renderWithProviders(<VehicleControlToggle vehicleId="VIN1" />);
    expect(screen.queryByText("API control")).not.toBeInTheDocument();
  });

  it("stays hidden when the vehicle has no charging point", () => {
    chargersRef.current = [smart];
    renderWithProviders(<VehicleControlToggle vehicleId="VIN1" />);
    expect(screen.queryByText("API control")).not.toBeInTheDocument();
  });

  it("shows once a smart charger exists alongside the vehicle point", () => {
    chargersRef.current = [smart, linked];
    renderWithProviders(<VehicleControlToggle vehicleId="VIN1" />);
    expect(screen.getByRole("switch")).toBeChecked();
  });

  it("reflects a deactivated point", () => {
    chargersRef.current = [smart, { ...linked, active: false }];
    renderWithProviders(<VehicleControlToggle vehicleId="VIN1" />);
    expect(screen.getByRole("switch")).not.toBeChecked();
  });

  it("hands control to the smart charger when switched off", () => {
    chargersRef.current = [smart, linked];
    renderWithProviders(<VehicleControlToggle vehicleId="VIN1" />);

    fireEvent.click(screen.getByRole("switch"));

    expect(mutate).toHaveBeenCalledWith({ vehicleId: "VIN1", active: false });
  });
});
