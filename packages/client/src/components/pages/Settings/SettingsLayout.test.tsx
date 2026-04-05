import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import {
  NumberInput,
  SettingsRow,
  SettingsSection,
} from "./SettingsLayout.tsx";

// ---- Test suite ----

describe("SettingsSection", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders title, description, and children", () => {
    renderWithProviders(
      <SettingsSection
        icon={<span>icon</span>}
        title="Test Section"
        description="Section description text"
      >
        <div data-testid="child-content">Child content</div>
      </SettingsSection>,
    );

    expect(screen.getByText("Test Section")).toBeInTheDocument();
    expect(screen.getByText("Section description text")).toBeInTheDocument();
    expect(screen.getByTestId("child-content")).toBeInTheDocument();
  });
});

describe("SettingsRow", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the label", () => {
    renderWithProviders(
      <SettingsRow label="Row Label">
        <div />
      </SettingsRow>,
    );

    expect(screen.getByText("Row Label")).toBeInTheDocument();
  });

  it("renders children", () => {
    renderWithProviders(
      <SettingsRow label="Row Label">
        <div data-testid="row-child">Row child</div>
      </SettingsRow>,
    );

    expect(screen.getByTestId("row-child")).toBeInTheDocument();
  });

  it("renders help text", () => {
    renderWithProviders(
      <SettingsRow label="Row Label" help="Some help text">
        <div />
      </SettingsRow>,
    );

    expect(screen.getByText("Some help text")).toBeInTheDocument();
  });

  it("does not render help text when not provided", () => {
    renderWithProviders(
      <SettingsRow label="No Help">
        <div data-testid="no-help-child" />
      </SettingsRow>,
    );

    expect(screen.getByText("No Help")).toBeInTheDocument();
    expect(screen.queryByText("Some help text")).not.toBeInTheDocument();
  });
});

describe("NumberInput", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders with value and suffix", () => {
    const onChange = vi.fn();
    renderWithProviders(
      <NumberInput value="42" onChange={onChange} suffix="sec" />,
    );

    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("42");
    expect(screen.getByText("sec")).toBeInTheDocument();
  });

  it("calls onChange on every keystroke", () => {
    const onChange = vi.fn();
    renderWithProviders(
      <NumberInput value="10" onChange={onChange} suffix="sec" />,
    );

    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "20" } });
    expect(onChange).toHaveBeenCalledWith("20");
  });

  it("does not snap back to parent value while editing", () => {
    const onChange = vi.fn();
    renderWithProviders(
      <NumberInput value="10" onChange={onChange} suffix="sec" />,
    );

    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    // Input shows empty string (local state), not snapped back to "10"
    expect(input.value).toBe("");
  });

  it("reflects updated value prop", () => {
    const onChange = vi.fn();
    const { rerender } = renderWithProviders(
      <NumberInput value="10" onChange={onChange} suffix="sec" />,
    );

    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("10");

    rerender(
      <NumberInput value="50" onChange={onChange} suffix="sec" />,
    );
    expect(input.value).toBe("50");
  });

  it("passes step, min, max attributes", () => {
    const onChange = vi.fn();
    renderWithProviders(
      <NumberInput
        value="10"
        onChange={onChange}
        suffix="sec"
        step={5}
        min={0}
        max={100}
      />,
    );

    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.step).toBe("5");
    expect(input.min).toBe("0");
    expect(input.max).toBe("100");
  });

  it("passes placeholder attribute", () => {
    const onChange = vi.fn();
    renderWithProviders(
      <NumberInput
        value=""
        onChange={onChange}
        suffix="sec"
        placeholder="Enter value"
      />,
    );

    expect(screen.getByPlaceholderText("Enter value")).toBeInTheDocument();
  });
});
