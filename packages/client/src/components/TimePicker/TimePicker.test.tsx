import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithProviders } from "../../test-utils.tsx";
import { userEvent } from "@testing-library/user-event";
import { TimePicker } from "./TimePicker.tsx";

describe("TimePicker", () => {
  afterEach(cleanup);
  describe("rendering", () => {
    it("renders with initial value", () => {
      renderWithProviders(
        <TimePicker value="14:30" onChange={vi.fn()} />,
      );

      const selects = screen.getAllByRole("combobox");
      expect(selects).toHaveLength(2);

      // Hour select has value 14
      expect(selects[0]).toHaveValue("14");
      // Minute select has value 30
      expect(selects[1]).toHaveValue("30");
    });

    it("renders hour options 0-23", () => {
      renderWithProviders(
        <TimePicker value="00:00" onChange={vi.fn()} />,
      );

      const hourSelect = screen.getAllByRole("combobox")[0];
      const options = hourSelect.querySelectorAll("option");
      expect(options).toHaveLength(24);
      expect(options[0]).toHaveTextContent("00");
      expect(options[23]).toHaveTextContent("23");
    });

    it("renders minute options in 15-min intervals", () => {
      renderWithProviders(
        <TimePicker value="00:00" onChange={vi.fn()} />,
      );

      const minuteSelect = screen.getAllByRole("combobox")[1];
      const options = minuteSelect.querySelectorAll("option");
      expect(options).toHaveLength(4);
      expect(options[0]).toHaveTextContent("00");
      expect(options[1]).toHaveTextContent("15");
      expect(options[2]).toHaveTextContent("30");
      expect(options[3]).toHaveTextContent("45");
    });
  });

  describe("interactions", () => {
    it("calls onChange when hour changes", async () => {
      const onChange = vi.fn();
      renderWithProviders(
        <TimePicker value="09:30" onChange={onChange} />,
      );

      const hourSelect = screen.getAllByRole("combobox")[0];
      await userEvent.selectOptions(hourSelect, "15");

      expect(onChange).toHaveBeenCalledWith("15:30");
    });

    it("calls onChange when minute changes", async () => {
      const onChange = vi.fn();
      renderWithProviders(
        <TimePicker value="09:30" onChange={onChange} />,
      );

      const minuteSelect = screen.getAllByRole("combobox")[1];
      await userEvent.selectOptions(minuteSelect, "45");

      expect(onChange).toHaveBeenCalledWith("09:45");
    });
  });
});
