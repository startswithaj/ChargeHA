import { FileText } from "lucide-react";
import { Button, Card, Select, Text } from "@radix-ui/themes";
import type { VehicleUpdateEntry } from "../../../hooks/useVehicleUpdates.ts";
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

interface VehicleUpdatesTableProps {
  readings: VehicleUpdateEntry[];
  loading: boolean;
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  vehicles: Array<{ id: string; name: string }>;
}

export function VehicleUpdatesTable({
  readings,
  loading,
  total,
  page,
  onPageChange,
  pageSize,
  onPageSizeChange,
}: VehicleUpdatesTableProps) {
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
        <Text color="gray">No vehicle updates yet.</Text>
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
              <th>Vehicle</th>
              <th>Online</th>
              <th>Home</th>
              <th>Plugged In</th>
              <th>Charging</th>
              <th>Battery</th>
              <th>Limit</th>
              <th>Power</th>
              <th>Amps</th>
              <th>Voltage</th>
              <th>Added</th>
              <th>ETA</th>
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
                <td>{r.vehicleName}</td>
                <td>{r.isOnline ? "Yes" : "No"}</td>
                <td>{r.isHome ? "Yes" : "No"}</td>
                <td>{r.isPluggedIn ? "Yes" : "No"}</td>
                <td>{r.isCharging ? "Yes" : "No"}</td>
                <td>{r.batteryLevel}%</td>
                <td>{r.chargeLimit}%</td>
                <td>{r.chargePowerKw.toFixed(1)} kW</td>
                <td>{r.chargeAmps}/{r.chargeAmpsMax}A</td>
                <td>{r.chargerVoltage}V</td>
                <td>{r.energyAddedKwh.toFixed(1)} kWh</td>
                <td>{r.minutesToFull > 0 ? `${r.minutesToFull}m` : "—"}</td>
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
