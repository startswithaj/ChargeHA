import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { ChargersSection } from "./ChargersSection.tsx";
import type { ChargerWithState } from "../../../hooks/useChargers.ts";

const { makeHookReturn, hookRef } = vi.hoisted(() => {
  const make = (overrides: Record<string, unknown> = {}) => ({
    chargers: [] as unknown[],
    reorderable: false,
    error: null as string | null,
    confirm: null as unknown,
    panels: {
      reporterFor: () => () => {},
      isDirty: false,
      save: vi.fn(),
      saveStatus: { state: "idle", tick: 0 },
    },
    editing: null as unknown,
    busy: false,
    choose: vi.fn(),
    edit: vi.fn(),
    submitDialog: vi.fn(),
    closeDialog: vi.fn(),
    requestRemove: vi.fn(),
    acceptConfirm: vi.fn(),
    cancelConfirm: vi.fn(),
    move: vi.fn(),
    ...overrides,
  });
  return { makeHookReturn: make, hookRef: { current: make() } };
});

vi.mock("./useChargersSettings.ts", () => ({
  useChargersSettings: () => hookRef.current,
  hasSettingsPanel: () => true,
}));

vi.mock("./SettingsLayout.tsx", () => ({
  SettingsSection: (
    { children, title, action }: {
      children: React.ReactNode;
      title: string;
      action?: React.ReactNode;
    },
  ) => (
    <div data-testid="settings-section">
      <h3>{title}</h3>
      {action && <div data-testid="section-action">{action}</div>}
      {children}
    </div>
  ),
  SettingsRow: (
    { children, label }: { children: React.ReactNode; label: string },
  ) => (
    <div>
      <label>{label}</label>
      {children}
    </div>
  ),
}));

vi.mock("../../../hooks/useSectionConfig.ts", () => ({
  useChargingConfig: vi.fn(() => ({ data: null })),
  useChargingConfigMutation: vi.fn(() => ({ mutate: vi.fn() })),
}));

vi.mock("@chargeha/plugins/componentRegistry", () => ({
  pluginSettingsComponents: {
    "tapo-settings": () => <div data-testid="plugin-panel" />,
  } as Record<string, React.FC>,
  chargerPluginOptions: [
    { id: "tapo", label: "Tapo Smart Plug" },
    { id: "ocpp", label: "OCPP Charger" },
  ],
}));

vi.mock("../../../lib/featureFlags.ts", () => ({
  demoMode: { blockedPlugins: () => new Set<string>() },
}));

describe("ChargersSection", () => {
  const makeCharger = (overrides: Record<string, unknown> = {}) =>
    ({
      id: "c1",
      name: "Garage Plug",
      chargerAdapterType: "tapo",
      mode: "auto",
      priority: 1,
      vehicleId: null,
      kind: "smart",
      active: true,
      state: { status: "charging" },
      ...overrides,
    }) as unknown as ChargerWithState;

  beforeEach(() => {
    hookRef.current = makeHookReturn();
  });

  afterEach(cleanup);

  it("shows an empty state when no chargers exist", () => {
    renderWithProviders(<ChargersSection />);
    expect(screen.getByText(/No chargers configured yet/))
      .toBeInTheDocument();
  });

  it("renders friendly labels rather than raw enum values", () => {
    hookRef.current = makeHookReturn({
      chargers: [
        makeCharger({ mode: "charge_now", state: { status: "no_draw" } }),
      ],
    });
    renderWithProviders(<ChargersSection />);

    expect(screen.getByText("Charge now")).toBeInTheDocument();
    expect(screen.getByText("No draw")).toBeInTheDocument();
    expect(screen.queryByText("charge_now")).not.toBeInTheDocument();
    expect(screen.queryByText("no_draw")).not.toBeInTheDocument();
  });

  it("hides reorder controls and priority for a single charger", () => {
    hookRef.current = makeHookReturn({ chargers: [makeCharger()] });
    renderWithProviders(<ChargersSection />);

    expect(screen.queryByText(/^Priority \d/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Move .* up/)).not.toBeInTheDocument();
  });

  it("shows reorder controls when more than one charger exists", () => {
    hookRef.current = makeHookReturn({
      reorderable: true,
      chargers: [makeCharger(), makeCharger({ id: "c2", name: "Wallbox" })],
    });
    renderWithProviders(<ChargersSection />);

    fireEvent.click(screen.getByLabelText("Move Wallbox up"));
    expect(hookRef.current.move).toHaveBeenCalledWith("c2", "up");
  });

  it("marks vehicle-API charging points and does not offer deletion", () => {
    hookRef.current = makeHookReturn({
      chargers: [
        makeCharger({
          id: "t1",
          name: "Model 3",
          vehicleId: "VIN1",
          kind: "vehicle_api",
        }),
      ],
    });
    renderWithProviders(<ChargersSection />);

    expect(screen.getByText("Model 3")).toBeInTheDocument();
    expect(screen.getByText("via vehicle API")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Delete /)).not.toBeInTheDocument();
  });

  it("offers deletion for smart chargers", () => {
    hookRef.current = makeHookReturn({ chargers: [makeCharger()] });
    renderWithProviders(<ChargersSection />);

    fireEvent.click(screen.getByLabelText("Delete Garage Plug"));
    expect(hookRef.current.requestRemove).toHaveBeenCalledWith("c1");
  });

  it("puts the add control in the section action slot", () => {
    renderWithProviders(<ChargersSection />);
    expect(screen.getByTestId("section-action")).toBeInTheDocument();
  });

  it("keeps plugin fields out of the list until a charger is opened", () => {
    hookRef.current = makeHookReturn({ chargers: [makeCharger()] });
    renderWithProviders(<ChargersSection />);
    expect(screen.queryByTestId("plugin-panel")).not.toBeInTheDocument();
  });

  it("opens an edit dialog for a charger", () => {
    hookRef.current = makeHookReturn({ chargers: [makeCharger()] });
    renderWithProviders(<ChargersSection />);

    fireEvent.click(screen.getByRole("button", { name: /Edit/ }));
    expect(hookRef.current.edit).toHaveBeenCalled();
  });

  it("shows the plugin panel inside the dialog, with save and cancel", () => {
    hookRef.current = makeHookReturn({
      editing: { mode: "edit", typeId: "tapo", name: "Garage Plug" },
    });
    renderWithProviders(<ChargersSection />);

    expect(screen.getByTestId("plugin-panel")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(hookRef.current.submitDialog).toHaveBeenCalled();
  });

  it("labels the dialog as an add when creating a charger", () => {
    hookRef.current = makeHookReturn({
      editing: { mode: "add", typeId: "tapo" },
    });
    renderWithProviders(<ChargersSection />);

    expect(screen.getByText("Add Tapo Smart Plug")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add charger" }))
      .toBeInTheDocument();
  });

  it("confirms before switching control to a smart charger", () => {
    hookRef.current = makeHookReturn({
      confirm: { kind: "add", typeId: "tapo" },
    });
    renderWithProviders(<ChargersSection />);

    expect(screen.getByText("Switch to smart charger control?"))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(hookRef.current.acceptConfirm).toHaveBeenCalled();
  });

  it("confirms before removing the last smart charger", () => {
    hookRef.current = makeHookReturn({
      confirm: { kind: "removeLast", chargerId: "c1" },
    });
    renderWithProviders(<ChargersSection />);

    expect(screen.getByText("Switch back to vehicle control?"))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(hookRef.current.cancelConfirm).toHaveBeenCalled();
  });

  it("surfaces mutation errors", () => {
    hookRef.current = makeHookReturn({ error: "Charger unreachable" });
    renderWithProviders(<ChargersSection />);
    expect(screen.getByText("Charger unreachable")).toBeInTheDocument();
  });
});
