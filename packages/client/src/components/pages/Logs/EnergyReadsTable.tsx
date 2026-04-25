import { FileText } from "lucide-react";
import { Button, Card, Select, Text } from "@radix-ui/themes";
import type { EnergyReadingEntry } from "../../../hooks/useEnergyReadings.ts";
import { useFreshRowIds } from "../../../hooks/useFreshRowIds.ts";
import { PAGE_SIZE_OPTIONS } from "./Logs.tsx";
import styles from "./Logs.module.css";

function formatTimestamp(ts: string): string {
  const d = new Date(ts + "Z");
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmt(w: number): string {
  return `${Math.round(w).toLocaleString()}W`;
}

interface EnergyReadsTableProps {
  readings: EnergyReadingEntry[];
  loading: boolean;
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
}

export function EnergyReadsTable({
  readings,
  loading,
  total,
  page,
  onPageChange,
  pageSize,
  onPageSizeChange,
}: EnergyReadsTableProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const freshIds = useFreshRowIds(readings);

  if (loading && readings.length === 0) {
    return (
      <Card className={styles.emptyState}>
        <Text color="gray">Loading...</Text>
      </Card>
    );
  }

  if (readings.length === 0) {
    return (
      <Card className={styles.emptyState}>
        <FileText size={20} style={{ marginRight: 8 }} />
        <Text color="gray">No energy readings yet.</Text>
      </Card>
    );
  }

  return (
    <>
      <div className={styles.dataTableWrapper}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>Time</th>
              <th>Solar</th>
              <th>Grid</th>
              <th>Home</th>
              <th>Battery (W)</th>
              <th>SoC</th>
              <th>Rate</th>
            </tr>
          </thead>
          <tbody>
            {readings.map((r) => (
              <tr
                key={r.id}
                className={freshIds.has(r.id) ? styles.freshRow : undefined}
              >
                <td className={styles.timestamp}>
                  {formatTimestamp(r.timestamp)}
                </td>
                <td>{fmt(r.solarProductionW)}</td>
                <td>{fmt(r.gridPowerW)}</td>
                <td>{fmt(r.homeConsumptionW)}</td>
                <td>{r.batteryPowerW !== null ? fmt(r.batteryPowerW) : "—"}</td>
                <td>{r.batterySoc !== null ? `${r.batterySoc}%` : "—"}</td>
                <td>
                  {r.ratePerKwh !== null ? `${r.ratePerKwh}¢` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.pagination}>
        <Button
          size="1"
          variant="soft"
          disabled={page === 0}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <Text size="2" color="gray">
          Page {page + 1} of {totalPages} ({total} entries)
        </Text>
        <Button
          size="1"
          variant="soft"
          disabled={page >= totalPages - 1}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
        <Select.Root
          size="1"
          value={String(pageSize)}
          onValueChange={(v) => onPageSizeChange(Number(v))}
        >
          <Select.Trigger />
          <Select.Content>
            {PAGE_SIZE_OPTIONS.map((opt) => (
              <Select.Item key={opt} value={String(opt)}>
                {opt} / page
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </div>
    </>
  );
}
