import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithProviders } from "../../test-utils.tsx";
import { userEvent } from "@testing-library/user-event";
import type { DayOfWeek } from "@chargeha/shared";
import { DayPicker } from "./DayPicker.tsx";

describe("DayPicker", () => {
  afterEach(cleanup);
  const ALL_DAYS: DayOfWeek[] = [
    "mon",
    "tue",
    "wed",
    "thu",
    "fri",
    "sat",
    "sun",
  ];
  const WEEKDAYS: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri"];
  const WEEKENDS: DayOfWeek[] = ["sat", "sun"];
  const defaultProps = {
    value: [] as DayOfWeek[],
    onChange: vi.fn(),
  };

  const getDayButtons = () =>
    screen.getAllByRole("button").filter(
      (btn) => btn.getAttribute("data-selected") !== null,
    );

  describe("rendering", () => {
    it("renders all 7 day buttons", () => {
      renderWithProviders(<DayPicker {...defaultProps} />);

      // M, T, W, T, F, S, S
      const buttons = screen.getAllByRole("button").filter(
        (btn) => ["M", "T", "W", "F", "S"].includes(btn.textContent ?? ""),
      );
      expect(buttons).toHaveLength(7);
    });

    it("shows selected days as active via data-selected attribute", () => {
      renderWithProviders(
        <DayPicker {...defaultProps} value={["mon", "wed"]} />,
      );

      const selected = getDayButtons().filter(
        (btn) => btn.getAttribute("data-selected") === "true",
      );
      expect(selected).toHaveLength(2);
    });
  });

  describe("toggling days", () => {
    it.each<[string, DayOfWeek[], DayOfWeek[]]>([
      ["adds Monday when not selected", [], ["mon"]],
      ["removes Monday when already selected", ["mon", "wed"], ["wed"]],
    ])("clicking first day button %s", async (_label, initial, expected) => {
      const onChange = vi.fn();
      renderWithProviders(<DayPicker value={initial} onChange={onChange} />);

      // First button is Monday ("M")
      await userEvent.click(getDayButtons()[0]);

      expect(onChange).toHaveBeenCalledWith(expected);
    });
  });

  describe("presets", () => {
    it.each<[string, DayOfWeek[], DayOfWeek[]]>([
      ["Every Day", [], ALL_DAYS],
      ["Weekdays", [], WEEKDAYS],
      ["Weekends", [], WEEKENDS],
      ["Every Day", ALL_DAYS, []],
      ["Weekdays", WEEKDAYS, []],
      ["Weekends", WEEKENDS, []],
    ])(
      "%s preset toggles correctly from %j",
      async (label, initial, expected) => {
        const onChange = vi.fn();
        renderWithProviders(
          <DayPicker value={initial} onChange={onChange} />,
        );

        await userEvent.click(screen.getByText(label));

        expect(onChange).toHaveBeenCalledWith(expected);
      },
    );
  });
});
