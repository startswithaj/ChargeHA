import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { useState } from "react";
import { PluginConfigForm } from "./PluginConfigForm.tsx";
import {
  PluginSettingsHostProvider,
  type PluginSettingsState,
} from "./pluginSettingsHost.ts";

vi.mock("./SettingsLayout.tsx", () => ({
  SettingsRow: (
    { children, label }: { children: React.ReactNode; label: string },
  ) => (
    <div>
      <label>{label}</label>
      {children}
    </div>
  ),
}));

describe("PluginConfigForm", () => {
  const FIELDS = [{ key: "host", label: "Host" }];
  const DATA = { host: "10.0.0.1" };

  afterEach(cleanup);

  // A host stores the reported state, which re-renders the panel and hands
  // down a fresh inline `onSave`. If that changed `save`'s identity the report
  // effect would re-fire forever, so the suite would hang rather than fail —
  // assert the invariant directly instead.
  it("reports a stable save callback across re-renders", () => {
    const reports: PluginSettingsState[] = [];
    const report = (state: PluginSettingsState | null) => {
      if (state) reports.push(state);
    };

    const tree = (
      <PluginSettingsHostProvider value={report}>
        <PluginConfigForm
          data={DATA}
          fields={FIELDS}
          onSave={(_draft, opts) => opts.onSuccess()}
        />
      </PluginSettingsHostProvider>
    );

    const { rerender } = render(tree);
    // Re-rendering mints a new inline onSave, exactly as a host re-render does.
    rerender(
      <PluginSettingsHostProvider value={report}>
        <PluginConfigForm
          data={DATA}
          fields={FIELDS}
          onSave={(_draft, opts) => opts.onSuccess()}
        />
      </PluginSettingsHostProvider>,
    );

    expect(reports.length).toBeGreaterThan(0);
    expect(reports.every((r) => r.save === reports[0].save)).toBe(true);
  });

  it("saves the edited draft rather than the value captured at mount", () => {
    const saved: Array<Record<string, string>> = [];

    function Harness() {
      const [panel, setPanel] = useState<PluginSettingsState | null>(null);
      return (
        <>
          <PluginSettingsHostProvider value={setPanel}>
            <PluginConfigForm
              data={DATA}
              fields={FIELDS}
              onSave={(draft, opts) => {
                saved.push(draft);
                opts.onSuccess();
              }}
            />
          </PluginSettingsHostProvider>
          <button type="button" onClick={() => panel?.save()}>save</button>
        </>
      );
    }

    render(<Harness />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "10.0.0.9" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    expect(saved).toEqual([{ host: "10.0.0.9" }]);
  });

  it("renders a select for fields that declare options", () => {
    renderWithProviders(
      <PluginConfigForm
        data={{ phases: "1" }}
        fields={[{
          key: "phases",
          label: "Phases",
          options: [
            { value: "1", label: "Single phase" },
            { value: "3", label: "Three phase" },
          ],
        }]}
        onSave={() => {}}
      />,
    );

    expect(screen.getByText("Single phase")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
