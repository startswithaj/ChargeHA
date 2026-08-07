import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { ChargerEditForm } from "./ChargerEditForm.tsx";

const mocks = vi.hoisted(() => ({
  capturedChargerIds: [] as Array<string | null | undefined>,
}));

vi.mock("@chargeha/plugins/componentRegistry", () => ({
  pluginSettingsComponents: {
    "tapo-settings": (
      { chargerId }: { chargerId?: string | null },
    ) => {
      mocks.capturedChargerIds.push(chargerId);
      return <div data-testid="panel">panel</div>;
    },
  },
}));

describe("ChargerEditForm", () => {
  afterEach(() => {
    cleanup();
    mocks.capturedChargerIds.length = 0;
  });

  it("renders the panel with chargerId={null} in add mode", () => {
    renderWithProviders(
      <ChargerEditForm
        typeId="tapo"
        chargerId={null}
        submitLabel="Add"
        error={null}
        busy={false}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByTestId("panel")).toBeInTheDocument();
    expect(mocks.capturedChargerIds).toContain(null);
  });

  it("renders the panel with the row id in edit mode", () => {
    renderWithProviders(
      <ChargerEditForm
        typeId="tapo"
        chargerId="row-1"
        submitLabel="Save"
        error={null}
        busy={false}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(mocks.capturedChargerIds).toContain("row-1");
  });

  it("hands the host a commit function rather than saving itself", () => {
    const onSubmit = vi.fn();
    renderWithProviders(
      <ChargerEditForm
        typeId="tapo"
        chargerId={null}
        submitLabel="Add"
        error={null}
        busy={false}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    // The form itself never calls the panel's save — only the host does,
    // via the commit function it was handed.
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(expect.any(Function));
  });
});
