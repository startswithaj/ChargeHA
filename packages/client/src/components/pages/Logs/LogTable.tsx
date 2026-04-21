import { FileText } from "lucide-react";
import { Button, Card, Select, Text } from "@radix-ui/themes";
import type { ControllerLogEntry } from "../../../hooks/useControllerLogs.ts";
import { useFreshRowIds } from "../../../hooks/useFreshRowIds.ts";
import { LogEntryCard } from "./LogEntryCard.tsx";
import { PAGE_SIZE_OPTIONS } from "./Logs.tsx";
import styles from "./Logs.module.css";

interface LogTableProps {
  logs: ControllerLogEntry[];
  loading: boolean;
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
}

export function LogTable({
  logs,
  loading,
  total,
  page,
  onPageChange,
  pageSize,
  onPageSizeChange,
}: LogTableProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const freshIds = useFreshRowIds(logs);

  if (loading && logs.length === 0) {
    return (
      <Card className={styles.emptyState}>
        <Text color="gray">Loading...</Text>
      </Card>
    );
  }

  if (logs.length === 0) {
    return (
      <Card className={styles.emptyState}>
        <FileText size={20} style={{ marginRight: 8 }} />
        <Text color="gray">
          No controller log entries yet. Logs will appear as the charge
          controller runs.
        </Text>
      </Card>
    );
  }

  return (
    <>
      <div className={styles.logList}>
        {logs.map((entry) => (
          <div
            key={entry.id}
            className={freshIds.has(entry.id) ? styles.freshRow : undefined}
          >
            <LogEntryCard entry={entry} />
          </div>
        ))}
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
