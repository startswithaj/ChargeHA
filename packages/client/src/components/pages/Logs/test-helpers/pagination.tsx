import { assertExists } from "@std/assert";
import { expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderWithProviders } from "../../../../test-utils.tsx";

interface PaginationProps {
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  pageSize: number;
}

/**
 * Shared pagination footer assertions for the three Logs table tests
 * (EnergyReadsTable, PluginLogsTable, VehicleUpdatesTable). The footer is the
 * same component across all three tables so the disabled-button + onClick
 * semantics are tested once via this helper.
 */
export function expectPagination(
  renderTable: (props: PaginationProps) => ReactElement,
  total: number,
  pageSize: number,
  infoText: string,
): void {
  const lastPage = Math.ceil(total / pageSize) - 1;

  // shows pagination info
  const infoView = renderWithProviders(
    renderTable({ total, page: 0, pageSize, onPageChange: vi.fn() }),
  );
  expect(screen.getByText(infoText)).toBeTruthy();
  infoView.unmount();

  // disables Previous on first page
  const firstView = renderWithProviders(
    renderTable({ total, page: 0, pageSize, onPageChange: vi.fn() }),
  );
  const prev = screen.getByText("Previous").closest("button");
  assertExists(prev);
  expect(prev.hasAttribute("disabled")).toBe(true);
  firstView.unmount();

  // disables Next on last page
  const lastView = renderWithProviders(
    renderTable({ total, page: lastPage, pageSize, onPageChange: vi.fn() }),
  );
  const next = screen.getByText("Next").closest("button");
  assertExists(next);
  expect(next.hasAttribute("disabled")).toBe(true);
  lastView.unmount();

  // calls onPageChange for Previous
  const prevCb = vi.fn();
  const prevView = renderWithProviders(
    renderTable({ total, page: 1, pageSize, onPageChange: prevCb }),
  );
  fireEvent.click(screen.getByText("Previous"));
  expect(prevCb).toHaveBeenCalledWith(0);
  prevView.unmount();

  // calls onPageChange for Next
  const nextCb = vi.fn();
  const nextView = renderWithProviders(
    renderTable({ total, page: 0, pageSize, onPageChange: nextCb }),
  );
  fireEvent.click(screen.getByText("Next"));
  expect(nextCb).toHaveBeenCalledWith(1);
  nextView.unmount();
}
