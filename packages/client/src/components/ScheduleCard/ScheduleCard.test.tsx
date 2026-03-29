import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithProviders } from "../../test-utils.tsx";
import { userEvent } from "@testing-library/user-event";
import type { BlockoutSchedule, ChargeSchedule } from "@chargeha/shared";
import { ScheduleCard } from "./ScheduleCard.tsx";

describe("ScheduleCard", () => {
  beforeEach(vi.clearAllMocks);
  afterEach(cleanup);

  const chargeSchedule: ChargeSchedule = {
    id: "sched-1",
    vehicleId: "v1",
    scheduleType: "charge",
    startTime: "22:00",
    endTime: "06:00",
    days: ["mon", "tue", "wed", "thu", "fri"],
    chargeAmps: 16,
    chargeLimitPct: 80,
    enabled: true,
  };

  const blockoutSchedule: BlockoutSchedule = {
    id: "sched-2",
    vehicleId: null,
    scheduleType: "blockout",
    startTime: "14:00",
    endTime: "18:00",
    days: ["sat", "sun"],
    enabled: true,
  };

  const defaultHandlers = {
    onToggle: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  };

  describe("rendering", () => {
    it("renders charge schedule with time and days", () => {
      renderWithProviders(
        <ScheduleCard schedule={chargeSchedule} {...defaultHandlers} />,
      );

      // Formatted times: 10:00 PM – 6:00 AM
      expect(screen.getByText(/10:00 PM/)).toBeInTheDocument();
      expect(screen.getByText(/6:00 AM/)).toBeInTheDocument();
      // Days should show "Weekdays"
      expect(screen.getByText("Weekdays")).toBeInTheDocument();
      // Detail text for charge schedule
      expect(screen.getByText(/Charge at 16A to 80%/)).toBeInTheDocument();
    });

    it("renders blockout schedule", () => {
      renderWithProviders(
        <ScheduleCard schedule={blockoutSchedule} {...defaultHandlers} />,
      );

      // Formatted times: 2:00 PM – 6:00 PM
      expect(screen.getByText(/2:00 PM/)).toBeInTheDocument();
      expect(screen.getByText(/6:00 PM/)).toBeInTheDocument();
      // Days should show "Weekends"
      expect(screen.getByText("Weekends")).toBeInTheDocument();
      // Blockout detail text
      expect(screen.getByText("Stop all charging")).toBeInTheDocument();
    });
  });

  describe("duration formatting", () => {
    it("shows hours and minutes for non-exact-hour durations", () => {
      const schedule = {
        ...chargeSchedule,
        startTime: "09:00",
        endTime: "10:30",
      };
      renderWithProviders(
        <ScheduleCard schedule={schedule} {...defaultHandlers} />,
      );
      expect(screen.getByText("(1h 30m)")).toBeInTheDocument();
    });

    it("shows minutes only for sub-hour durations", () => {
      const schedule = {
        ...chargeSchedule,
        startTime: "09:00",
        endTime: "09:45",
      };
      renderWithProviders(
        <ScheduleCard schedule={schedule} {...defaultHandlers} />,
      );
      expect(screen.getByText("(45m)")).toBeInTheDocument();
    });

    it("handles overnight schedule duration", () => {
      // 23:00 to 01:00 = 2h
      const schedule = {
        ...chargeSchedule,
        startTime: "23:00",
        endTime: "01:00",
      };
      renderWithProviders(
        <ScheduleCard schedule={schedule} {...defaultHandlers} />,
      );
      expect(screen.getByText("(2h)")).toBeInTheDocument();
    });
  });

  describe("interactions", () => {
    it("edit button calls onEdit", async () => {
      const onEdit = vi.fn();
      renderWithProviders(
        <ScheduleCard
          schedule={chargeSchedule}
          {...defaultHandlers}
          onEdit={onEdit}
        />,
      );

      await userEvent.click(
        screen.getByRole("button", { name: /edit schedule/i }),
      );

      expect(onEdit).toHaveBeenCalledWith(chargeSchedule);
    });

    it("delete button calls onDelete", async () => {
      const onDelete = vi.fn();
      renderWithProviders(
        <ScheduleCard
          schedule={chargeSchedule}
          {...defaultHandlers}
          onDelete={onDelete}
        />,
      );

      await userEvent.click(
        screen.getByRole("button", { name: /delete schedule/i }),
      );

      expect(onDelete).toHaveBeenCalledWith("sched-1");
    });

    it("toggle calls onToggle", async () => {
      const onToggle = vi.fn();
      renderWithProviders(
        <ScheduleCard
          schedule={chargeSchedule}
          {...defaultHandlers}
          onToggle={onToggle}
        />,
      );

      const toggle = screen.getByRole("switch");
      await userEvent.click(toggle);

      expect(onToggle).toHaveBeenCalledWith("sched-1", false);
    });
  });
});
