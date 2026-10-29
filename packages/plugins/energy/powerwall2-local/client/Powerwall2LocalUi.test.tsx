import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../../client/src/test-utils.tsx";
import {
  PluginSettingsHostProvider,
  type PluginSettingsState,
} from "../../../../client/src/components/pages/Settings/pluginSettingsHost.ts";
import { Powerwall2LocalForm } from "./Powerwall2LocalForm.tsx";
import { Powerwall2LocalConfig } from "./Powerwall2LocalConfig.tsx";
import { powerwall2LocalSetupStep } from "./Powerwall2LocalSetupStep.tsx";

const mocks = vi.hoisted(() => ({
  config: {
    host: "192.0.2.10",
    email: "owner@example.com",
    password: "example",
    maxStalenessSeconds: "60",
    pollIntervalSeconds: "30",
  } as Record<string, string> | undefined,
  test: vi.fn(),
  reset: vi.fn(),
  save: vi.fn(),
  saveAsync: vi.fn(),
  invalidate: vi.fn(),
  state: {
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null as { message: string } | null,
    data: undefined as unknown,
    variables: undefined as unknown,
  },
}));

vi.mock("./trpc.ts", () => ({
  trpc: {
    useUtils: () => ({
      plugin: {
        energy: {
          powerwall2_local: { getConfig: { invalidate: mocks.invalidate } },
        },
      },
    }),
    plugin: {
      energy: {
        powerwall2_local: {
          getConfig: { useQuery: () => ({ data: mocks.config }) },
          setConfig: {
            useMutation: () => ({
              mutate: mocks.save,
              mutateAsync: mocks.saveAsync,
            }),
          },
          testConnection: {
            useMutation: () => ({
              ...mocks.state,
              mutate: mocks.test,
              reset: mocks.reset,
            }),
          },
        },
      },
    },
  },
}));

describe("Powerwall setup and settings", () => {
  const initial = {
    host: "192.0.2.10",
    email: "owner@example.com",
    password: "example",
    maxStalenessSeconds: "60",
    pollIntervalSeconds: "30",
  };
  const success = {
    success: true,
    device: { name: "Gateway", model: "26.34.0" },
    realtime: {
      solarProductionW: 7500,
      homeConsumptionW: 4000,
      gridPowerW: -2000,
      batteryPowerW: 1500,
      batterySoc: 82,
    },
  };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.config = { ...initial };
    Object.assign(mocks.state, {
      isPending: false,
      isSuccess: false,
      isError: false,
      error: null,
      data: undefined,
      variables: undefined,
    });
  });
  afterEach(cleanup);

  it("requires host and password before testing, and masks the password", () => {
    renderWithProviders(
      <Powerwall2LocalForm
        initial={{ ...initial, password: "" }}
        onTestSuccess={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Test Connection" }))
      .toBeDisabled();

    const password = screen.getByLabelText("Gateway customer password");

    expect(password).toHaveAttribute("type", "password");

    fireEvent.change(password, { target: { value: "example" } });
    fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));

    expect(mocks.test).toHaveBeenCalledWith(
      initial,
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("only accepts a successful test for unchanged input", () => {
    const validated = vi.fn();

    renderWithProviders(
      <Powerwall2LocalForm initial={initial} onTestSuccess={validated} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));

    const callbacks = mocks.test.mock.calls[0][1];

    act(() => callbacks.onSuccess(success));

    expect(validated).toHaveBeenLastCalledWith(initial);

    fireEvent.change(screen.getByLabelText("Gateway IP address"), {
      target: { value: "192.0.2.11" },
    });

    expect(validated).toHaveBeenLastCalledWith(null);
    expect(mocks.reset).toHaveBeenCalled();

    act(() => callbacks.onSuccess(success));

    expect(validated).toHaveBeenLastCalledWith(null);
  });

  it("displays a connection failure without a success badge", () => {
    Object.assign(mocks.state, {
      isSuccess: true,
      data: { success: false, error: "Login failed" },
    });

    renderWithProviders(
      <Powerwall2LocalForm initial={initial} onTestSuccess={vi.fn()} />,
    );

    expect(screen.getByText("Login failed")).toBeInTheDocument();
    expect(screen.queryByText(/Connected —/)).not.toBeInTheDocument();
  });

  it("disables duplicate tests while a request is pending", () => {
    mocks.state.isPending = true;

    renderWithProviders(
      <Powerwall2LocalForm initial={initial} onTestSuccess={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: "Testing…" })).toBeDisabled();
  });

  it("saves settings only through the host Save action", () => {
    const host = { current: null as PluginSettingsState | null };
    const report = (state: PluginSettingsState | null) => {
      host.current = state;
    };

    renderWithProviders(
      <PluginSettingsHostProvider value={report}>
        <Powerwall2LocalConfig />
      </PluginSettingsHostProvider>,
    );

    fireEvent.change(screen.getByLabelText("Gateway IP address"), {
      target: { value: "192.0.2.20" },
    });

    expect(host.current?.isDirty).toBe(true);
    expect(mocks.save).not.toHaveBeenCalled();

    act(() => host.current?.save());

    expect(mocks.save).toHaveBeenCalledWith(
      { host: "192.0.2.20" },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });

  it("tests unsaved settings, not the old saved host", () => {
    renderWithProviders(<Powerwall2LocalConfig />);

    fireEvent.change(screen.getByLabelText("Gateway IP address"), {
      target: { value: "192.0.2.20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));

    expect(mocks.test).toHaveBeenCalledWith({ ...initial, host: "192.0.2.20" });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("hides old settings success when the connection details change", () => {
    Object.assign(mocks.state, {
      isSuccess: true,
      data: success,
      variables: initial,
    });

    renderWithProviders(<Powerwall2LocalConfig />);

    expect(screen.getByText(/Connected —/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Gateway IP address"), {
      target: { value: "192.0.2.20" },
    });

    expect(screen.queryByText(/Connected —/)).not.toBeInTheDocument();
  });

  function WizardHarness() {
    const step = powerwall2LocalSetupStep.useStep({
      onAdvance: vi.fn(),
      onBack: vi.fn(),
      onSkipTo: vi.fn(),
      onSkipToEnd: vi.fn(),
      chargerId: null,
      setChargerId: vi.fn(),
    });
    const next = step.next;
    return (
      <>
        {step.view}
        <button
          type="button"
          disabled={next.kind !== "ready"}
          onClick={() => {
            if (next.kind === "ready") void next.onNext();
          }}
        >
          Next
        </button>
      </>
    );
  }

  it("blocks wizard progress until tested, saves on Next, and invalidates after edits", async () => {
    renderWithProviders(<WizardHarness />);

    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));
    act(() => mocks.test.mock.calls[0][1].onSuccess(success));

    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();

    await act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    });

    expect(mocks.saveAsync).toHaveBeenCalledWith(initial);

    fireEvent.change(screen.getByLabelText("Gateway customer password"), {
      target: { value: "changed" },
    });

    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("shows getConfig defaults in a fresh wizard form", () => {
    mocks.config = {
      host: "",
      email: "",
      password: "",
      maxStalenessSeconds: "60",
      pollIntervalSeconds: "30",
    };

    renderWithProviders(<WizardHarness />);

    expect(screen.getByLabelText("Maximum telemetry age (seconds)"))
      .toHaveValue("60");
    expect(screen.getByLabelText("Polling interval (seconds)")).toHaveValue(
      "30",
    );
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("keeps missing numeric settings blank in the draft connection payload", () => {
    mocks.config = {
      host: initial.host,
      email: initial.email,
      password: initial.password,
    };

    renderWithProviders(<Powerwall2LocalConfig />);

    expect(screen.getByLabelText("Maximum telemetry age (seconds)"))
      .toHaveValue("");
    expect(screen.getByLabelText("Polling interval (seconds)")).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));

    expect(mocks.test).toHaveBeenCalledWith({
      ...initial,
      maxStalenessSeconds: "",
      pollIntervalSeconds: "",
    });
  });

  it("preserves a deliberately cleared wizard field and an edited interval", () => {
    renderWithProviders(<WizardHarness />);

    fireEvent.change(screen.getByLabelText("Maximum telemetry age (seconds)"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Polling interval (seconds)"), {
      target: { value: "20" },
    });

    expect(screen.getByLabelText("Maximum telemetry age (seconds)"))
      .toHaveValue("");
    expect(screen.getByLabelText("Polling interval (seconds)")).toHaveValue(
      "20",
    );

    fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));

    expect(mocks.test).toHaveBeenCalledWith({
      ...initial,
      maxStalenessSeconds: "",
      pollIntervalSeconds: "20",
    }, expect.any(Object));
  });

  it("waits for config before mounting the wizard fields", () => {
    mocks.config = undefined;

    const { rerender } = renderWithProviders(<WizardHarness />);

    expect(screen.queryByLabelText("Gateway IP address")).not
      .toBeInTheDocument();

    mocks.config = { ...initial };

    rerender(<WizardHarness />);

    expect(screen.getByLabelText("Gateway IP address")).toHaveValue(
      initial.host,
    );
  });
});
