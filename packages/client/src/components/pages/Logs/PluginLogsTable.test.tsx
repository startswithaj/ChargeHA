import { assertExists } from "@std/assert";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { PluginLogsTable } from "./PluginLogsTable.tsx";
import { expectPagination } from "./test-helpers/pagination.tsx";
import type { PluginLogEntry } from "../../../hooks/usePluginLogs.ts";

describe("PluginLogsTable", () => {
  const makeLog = (overrides: Partial<PluginLogEntry> = {}): PluginLogEntry => {
    return {
      id: 1,
      timestamp: "2026-03-20T10:30:00",
      pluginId: "tesla",
      level: "info",
      origin: "fronius",
      message: "Fetched energy data",
      payload: { durationMs: 250, status: 200 },
      traceId: null,
      ...overrides,
    };
  };

  const defaultProps = {
    logs: [] as PluginLogEntry[],
    loading: false,
    total: 0,
    page: 0,
    onPageChange: vi.fn(),
    pageSize: 50,
    onPageSizeChange: vi.fn(),
  };

  it("shows loading state when loading with no data", () => {
    renderWithProviders(
      <PluginLogsTable {...defaultProps} loading />,
    );
    expect(screen.getByText("Loading...")).toBeTruthy();
  });

  it("shows empty state when no logs", () => {
    renderWithProviders(<PluginLogsTable {...defaultProps} />);
    expect(screen.getByText("No plugin logs yet.")).toBeTruthy();
  });

  it("renders fixed table headers plus dynamic payload columns", () => {
    const log = makeLog();
    renderWithProviders(
      <PluginLogsTable {...defaultProps} logs={[log]} total={1} />,
    );
    // Fixed columns
    ["Time", "Level", "Plugin", "Origin", "Message"].forEach((header) => {
      expect(screen.getByText(header)).toBeTruthy();
    });
    // Dynamic columns derived from payload { durationMs, status }
    expect(screen.getByText("Duration Ms")).toBeTruthy();
    expect(screen.getByText("Status")).toBeTruthy();
  });

  it("renders log data correctly with dynamic columns", () => {
    const log = makeLog();
    renderWithProviders(
      <PluginLogsTable {...defaultProps} logs={[log]} total={1} />,
    );
    expect(screen.getByText("info")).toBeTruthy();
    expect(screen.getByText("tesla")).toBeTruthy();
    expect(screen.getByText("fronius")).toBeTruthy();
    expect(screen.getByText("Fetched energy data")).toBeTruthy();
    expect(screen.getByText("250ms")).toBeTruthy();
    expect(screen.getByText("200")).toBeTruthy();
  });

  it("renders dash for null origin", () => {
    const log = makeLog({ origin: null });
    renderWithProviders(
      <PluginLogsTable {...defaultProps} logs={[log]} total={1} />,
    );
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it("renders dash for null payload dynamic columns", () => {
    const log = makeLog({ payload: null });
    renderWithProviders(
      <PluginLogsTable {...defaultProps} logs={[log]} total={1} />,
    );
    // null payload → no dynamic columns rendered at all (no payload keys)
    expect(screen.queryByText("Duration Ms")).toBeNull();
  });

  it("derives dynamic columns from most common payload keys", () => {
    const logs = [
      makeLog({ id: 1, payload: { reason: "solar", retryIn: 30, extra: "x" } }),
      makeLog({ id: 2, payload: { reason: "grid", retryIn: 60 } }),
      makeLog({ id: 3, payload: { reason: "battery" } }),
    ];
    renderWithProviders(
      <PluginLogsTable {...defaultProps} logs={logs} total={3} />,
    );
    // "reason" appears in 3/3, "retryIn" in 2/3, "extra" in 1/3 → top 3
    expect(screen.getByText("Reason")).toBeTruthy();
    expect(screen.getByText("Retry In")).toBeTruthy();
    expect(screen.getByText("Extra")).toBeTruthy();
  });

  it("formats boolean values as yes/no", () => {
    const log = makeLog({
      id: 1,
      payload: { isOnline: true, isCharging: false },
    });
    renderWithProviders(
      <PluginLogsTable {...defaultProps} logs={[log]} total={1} />,
    );
    expect(screen.getByText("yes")).toBeTruthy();
    expect(screen.getByText("no")).toBeTruthy();
  });

  it("renders level badges with correct text", () => {
    const levels = ["info", "warn", "error", "debug"] as const;
    const logs = levels.map((level, i) =>
      makeLog({ id: i + 1, level, message: `msg-${level}` })
    );
    renderWithProviders(
      <PluginLogsTable {...defaultProps} logs={logs} total={4} />,
    );
    levels.forEach((level) => {
      expect(screen.getByText(level)).toBeTruthy();
    });
  });

  it("toggles payload JSON on row click", () => {
    const log = makeLog({ payload: { durationMs: 250, status: 200 } });
    renderWithProviders(
      <PluginLogsTable {...defaultProps} logs={[log]} total={1} />,
    );

    const row = screen.getByText("Fetched energy data").closest("tr");
    assertExists(row);

    // Expand
    fireEvent.click(row);
    expect(screen.getByText(/"durationMs": 250/)).toBeTruthy();

    // Collapse
    fireEvent.click(row);
    expect(screen.queryByText(/"durationMs": 250/)).toBeNull();
  });

  it("does not show payload row for null payload when expanded", () => {
    const log = makeLog({ payload: null });
    renderWithProviders(
      <PluginLogsTable {...defaultProps} logs={[log]} total={1} />,
    );

    const row = screen.getByText("Fetched energy data").closest("tr");
    assertExists(row);
    fireEvent.click(row);

    // No <pre> element should appear since payload is null
    const preElements = document.querySelectorAll("pre");
    expect(preElements.length).toBe(0);
  });

  it("pagination footer behaves correctly", () => {
    const log = makeLog();
    expectPagination(
      ({ total, page, onPageChange, pageSize }) => (
        <PluginLogsTable
          {...defaultProps}
          logs={[log]}
          total={total}
          page={page}
          onPageChange={onPageChange}
          pageSize={pageSize}
        />
      ),
      150,
      50,
      "Page 1 of 3 (150 entries)",
    );
  });
});
