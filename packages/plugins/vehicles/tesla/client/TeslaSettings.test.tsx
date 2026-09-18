import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../../client/src/test-utils.tsx";
import { PollingBlock } from "./TeslaSettings.tsx";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  config: {
    current: { teslaActivePollMinutes: 10, teslaIdlePollMinutes: 20 },
  },
}));

vi.mock("./useTeslaConfig.ts", () => ({
  useTeslaConfig: () => ({ data: mocks.config.current }),
  useTeslaConfigMutation: () => ({
    mutate: mocks.mutate,
    saveStatus: { state: "idle" },
  }),
}));

describe("PollingBlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.config.current = {
      teslaActivePollMinutes: 10,
      teslaIdlePollMinutes: 20,
    };
  });

  afterEach(() => cleanup());

  it("shows the advanced warning and both intervals", () => {
    renderWithProviders(<PollingBlock />);
    expect(screen.getByText(/Advanced\./)).toBeInTheDocument();
    expect(screen.getByLabelText("Active poll interval")).toHaveTextContent(
      "10 min (default)",
    );
    expect(screen.getByLabelText("Idle poll interval")).toHaveTextContent(
      "20 min (default)",
    );
  });

  it("reflects saved values", () => {
    mocks.config.current = {
      teslaActivePollMinutes: 15,
      teslaIdlePollMinutes: 60,
    };
    renderWithProviders(<PollingBlock />);
    expect(screen.getByLabelText("Active poll interval")).toHaveTextContent(
      "15 min",
    );
    expect(screen.getByLabelText("Idle poll interval")).toHaveTextContent(
      "60 min",
    );
  });

  it("saves the idle interval on change", () => {
    renderWithProviders(<PollingBlock />);
    fireEvent.click(screen.getByLabelText("Idle poll interval"));
    fireEvent.click(screen.getByRole("option", { name: "60 min" }));
    expect(mocks.mutate).toHaveBeenCalledWith({ teslaIdlePollMinutes: 60 });
  });
});
