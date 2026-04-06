import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { DaySelector } from "./DaySelector.tsx";
import { ALL_DAYS, WEEKDAYS, WEEKEND } from "./tariffUtils.ts";

describe("DaySelector", () => {
  afterEach(() => {
    cleanup();
  });

  it.each(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])(
    "renders %s button",
    (label) => {
      renderWithProviders(
        <DaySelector days={[...ALL_DAYS]} onChange={vi.fn()} />,
      );
      expect(screen.getByText(label)).toBeInTheDocument();
    },
  );

  it("renders quick select buttons", () => {
    renderWithProviders(
      <DaySelector days={[...ALL_DAYS]} onChange={vi.fn()} />,
    );
    expect(screen.getByText("Every day")).toBeInTheDocument();
    expect(screen.getByText("Weekdays")).toBeInTheDocument();
    expect(screen.getByText("Weekends")).toBeInTheDocument();
  });

  it.each<[string, readonly string[]]>([
    ["Every day", [...ALL_DAYS]],
    ["Weekdays", [...WEEKDAYS]],
    ["Weekends", [...WEEKEND]],
  ])(
    "calls onChange with preset payload when %s is clicked",
    (label, expected) => {
      const onChange = vi.fn();
      renderWithProviders(
        <DaySelector days={["mon"]} onChange={onChange} />,
      );
      fireEvent.click(screen.getByText(label));
      expect(onChange).toHaveBeenCalledWith(expected);
    },
  );

  it("removes a day when clicking a selected day", () => {
    const onChange = vi.fn();
    renderWithProviders(
      <DaySelector days={["mon", "tue", "wed"]} onChange={onChange} />,
    );
    fireEvent.click(screen.getByText("Tue"));
    expect(onChange).toHaveBeenCalledWith(["mon", "wed"]);
  });

  it("adds a day when clicking an unselected day", () => {
    const onChange = vi.fn();
    renderWithProviders(
      <DaySelector days={["mon"]} onChange={onChange} />,
    );
    fireEvent.click(screen.getByText("Wed"));
    expect(onChange).toHaveBeenCalledWith(["mon", "wed"]);
  });

  it("does not remove the last remaining day", () => {
    const onChange = vi.fn();
    renderWithProviders(
      <DaySelector days={["mon"]} onChange={onChange} />,
    );
    fireEvent.click(screen.getByText("Mon"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
