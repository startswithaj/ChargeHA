import { Fragment, useMemo, useState } from "react";
import { useStoredState } from "../../../lib/storage.ts";
import { Columns3, FileText } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  DropdownMenu,
  Select,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import type { PluginLogEntry } from "../../../hooks/usePluginLogs.ts";
import { useFreshRowIds } from "../../../hooks/useFreshRowIds.ts";
import { PAGE_SIZE_OPTIONS } from "./Logs.tsx";
import styles from "./Logs.module.css";

const DEFAULT_DYNAMIC_COLUMNS = 3;
const MAX_STRING_LENGTH = 40;

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

const LEVEL_COLORS: Record<string, "green" | "yellow" | "red" | "gray"> = {
  info: "green",
  warn: "yellow",
  error: "red",
  debug: "gray",
};

/** Derive all payload keys sorted by frequency (most common first).
 *  Flattens up to two levels deep: nested plain objects expand to
 *  "parent.child" / "parent.child.grandchild" columns; intermediate
 *  parents are omitted. */
function flattenKeys(obj: Record<string, unknown>, depth: number): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    if (depth > 0 && isPlainObject(value)) {
      return flattenKeys(value, depth - 1).map((child) => `${key}.${child}`);
    }
    return [key];
  });
}

function getAllPayloadKeys(
  logs: PluginLogEntry[],
): string[] {
  const allKeys = logs.flatMap((log) => {
    const payload = log.payload as Record<string, unknown> | null;
    if (!payload) return [];
    return flattenKeys(payload, 2);
  });
  const keyCounts = allKeys.reduce(
    (counts, key) => counts.set(key, (counts.get(key) ?? 0) + 1),
    new Map<string, number>(),
  );
  return [...keyCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Resolve a dot-path key (e.g. "response.body.error") from a payload object */
function getNestedValue(
  payload: Record<string, unknown>,
  key: string,
): unknown {
  return key.split(".").reduce<unknown>(
    (acc, part) => (isPlainObject(acc) ? acc[part] : undefined),
    payload,
  );
}

/** Toggleable columns beyond the fixed Time/Level/Plugin */
const OPTIONAL_FIXED_COLUMNS = ["origin", "message", "traceId"] as const;
type OptionalFixed = typeof OPTIONAL_FIXED_COLUMNS[number];

/** Format a dynamic column header from a camelCase or dot-path key.
 *  "durationMs" → "Duration Ms", "response.error" → "Response.Error" */
function formatColumnHeader(key: string): string {
  return key
    .split(".")
    .map((part) =>
      part
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/^./, (c) => c.toUpperCase())
    )
    .join(".");
}

/** Format a payload value with type-aware rendering */
function formatCellValue(value: unknown): { display: string; full?: string } {
  if (value === null || value === undefined) {
    return { display: "—" };
  }
  if (typeof value === "boolean") {
    return { display: value ? "yes" : "no" };
  }
  if (typeof value === "number") {
    return { display: String(value) };
  }
  if (isPlainObject(value) || Array.isArray(value)) {
    const json = JSON.stringify(value);
    if (json.length > MAX_STRING_LENGTH) {
      return { display: json.slice(0, MAX_STRING_LENGTH) + "…", full: json };
    }
    return { display: json };
  }
  const str = String(value);
  if (str.length > MAX_STRING_LENGTH) {
    return {
      display: str.slice(0, MAX_STRING_LENGTH) + "…",
      full: str,
    };
  }
  return { display: str };
}

/** Apply unit suffix for number values based on key name */
function formatNumberWithUnit(key: string, value: number): string {
  const lower = key.toLowerCase();
  if (lower.endsWith("ms")) return `${value}ms`;
  if (lower.endsWith("sec") || lower.endsWith("secs")) return `${value}s`;
  if (lower.endsWith("s") && !lower.endsWith("ss") && !lower.endsWith("us")) {
    // Ambiguous — only apply if the key looks time-related
    if (
      lower.includes("duration") || lower.includes("timeout") ||
      lower.includes("delay") || lower.includes("elapsed")
    ) {
      return `${value}s`;
    }
  }
  return String(value);
}

interface PluginLogsTableProps {
  logs: PluginLogEntry[];
  loading: boolean;
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
}

function ColumnsDropdown(
  { visibleColumns, allPayloadKeys, toggleColumn }: {
    visibleColumns: Set<string>;
    allPayloadKeys: string[];
    toggleColumn: (key: string) => void;
  },
) {
  return (
    <div
      style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}
    >
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <Button size="1" variant="soft">
            <Columns3 size={14} />
            Columns
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          <DropdownMenu.Label>Fixed</DropdownMenu.Label>
          {OPTIONAL_FIXED_COLUMNS.map((key) => (
            <DropdownMenu.CheckboxItem
              key={key}
              checked={visibleColumns.has(key)}
              onCheckedChange={() => toggleColumn(key)}
            >
              {formatColumnHeader(key)}
            </DropdownMenu.CheckboxItem>
          ))}
          {allPayloadKeys.length > 0 && (
            <>
              <DropdownMenu.Separator />
              <DropdownMenu.Label>Payload</DropdownMenu.Label>
              {allPayloadKeys.map((key) => (
                <DropdownMenu.CheckboxItem
                  key={key}
                  checked={visibleColumns.has(key)}
                  onCheckedChange={() => toggleColumn(key)}
                >
                  {formatColumnHeader(key)}
                </DropdownMenu.CheckboxItem>
              ))}
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  );
}

function TraceIdCell({ traceId }: { traceId: string | null }) {
  if (!traceId) return <>—</>;
  return (
    <Tooltip content={traceId}>
      <code style={{ fontSize: "0.75rem" }}>{traceId.slice(0, 8)}</code>
    </Tooltip>
  );
}

function PayloadCell(
  { keyName, raw }: { keyName: string; raw: unknown },
) {
  if (typeof raw === "number") {
    return <td>{formatNumberWithUnit(keyName, raw)}</td>;
  }
  const { display, full } = formatCellValue(raw);
  if (full) {
    return (
      <td>
        <Tooltip content={full}>
          <span>{display}</span>
        </Tooltip>
      </td>
    );
  }
  return <td>{display}</td>;
}

function LogRow(
  {
    log,
    isExpanded,
    fresh,
    totalColSpan,
    showOrigin,
    showMessage,
    showTraceId,
    visiblePayloadKeys,
    onClick,
  }: {
    log: PluginLogEntry;
    isExpanded: boolean;
    fresh: boolean;
    totalColSpan: number;
    showOrigin: boolean;
    showMessage: boolean;
    showTraceId: boolean;
    visiblePayloadKeys: string[];
    onClick: () => void;
  },
) {
  const payload = log.payload as Record<string, unknown> | null;
  return (
    <Fragment>
      <tr
        style={{ cursor: "pointer" }}
        className={fresh ? styles.freshRow : undefined}
        onClick={onClick}
      >
        <td className={styles.timestamp}>{formatTimestamp(log.timestamp)}</td>
        <td>
          <Badge size="1" color={LEVEL_COLORS[log.level] ?? "gray"}>
            {log.level}
          </Badge>
        </td>
        <td>{log.pluginId}</td>
        {showOrigin && <td>{log.origin ?? "—"}</td>}
        {showMessage && <td>{log.message}</td>}
        {showTraceId && (
          <td>
            <TraceIdCell traceId={log.traceId} />
          </td>
        )}
        {visiblePayloadKeys.map((key) => (
          <PayloadCell
            key={key}
            keyName={key}
            raw={payload ? getNestedValue(payload, key) : undefined}
          />
        ))}
      </tr>
      {isExpanded && payload && (
        <tr>
          <td colSpan={totalColSpan} style={{ padding: "8px 10px" }}>
            <pre
              style={{
                margin: 0,
                fontSize: "0.75rem",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {JSON.stringify(payload, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function PaginationBar(
  { page, totalPages, total, pageSize, onPageChange, onPageSizeChange }: {
    page: number;
    totalPages: number;
    total: number;
    pageSize: number;
    onPageChange: (p: number) => void;
    onPageSizeChange: (s: number) => void;
  },
) {
  return (
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
  );
}

export function PluginLogsTable({
  logs,
  loading,
  total,
  page,
  onPageChange,
  pageSize,
  onPageSizeChange,
}: PluginLogsTableProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const freshIds = useFreshRowIds(logs);

  const allPayloadKeys = useMemo(() => getAllPayloadKeys(logs), [logs]);

  // Default columns: origin, message, plus the top N payload keys.
  // Once the user toggles, their selection is persisted.
  const defaultColumns = useMemo(
    () => [
      ...OPTIONAL_FIXED_COLUMNS,
      ...allPayloadKeys.slice(0, DEFAULT_DYNAMIC_COLUMNS),
    ],
    [allPayloadKeys],
  );
  const [storedColumns, setStoredColumns] = useStoredState<string[] | null>(
    "plugin-log-columns",
    null,
  );
  const visibleColumns = new Set(storedColumns ?? defaultColumns);

  const toggleColumn = (key: string) => {
    const next = new Set(visibleColumns);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setStoredColumns([...next]);
  };

  const visiblePayloadKeys = allPayloadKeys.filter((k) =>
    visibleColumns.has(k)
  );
  const showOrigin = visibleColumns.has("origin");
  const showMessage = visibleColumns.has("message");
  const showTraceId = visibleColumns.has("traceId");
  const totalColSpan = 3 + (showOrigin ? 1 : 0) + (showMessage ? 1 : 0) +
    (showTraceId ? 1 : 0) + visiblePayloadKeys.length;

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
        <Text color="gray">No plugin logs yet.</Text>
      </Card>
    );
  }

  return (
    <>
      <div>
        <ColumnsDropdown
          visibleColumns={visibleColumns}
          allPayloadKeys={allPayloadKeys}
          toggleColumn={toggleColumn}
        />
        <div className={styles.dataTableWrapper}>
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Level</th>
                <th>Plugin</th>
                {showOrigin && <th>Origin</th>}
                {showMessage && <th>Message</th>}
                {showTraceId && <th>Trace</th>}
                {visiblePayloadKeys.map((key) => (
                  <th key={key}>{formatColumnHeader(key)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <LogRow
                  key={log.id}
                  log={log}
                  isExpanded={expandedId === log.id}
                  fresh={freshIds.has(log.id)}
                  totalColSpan={totalColSpan}
                  showOrigin={showOrigin}
                  showMessage={showMessage}
                  showTraceId={showTraceId}
                  visiblePayloadKeys={visiblePayloadKeys}
                  onClick={() =>
                    setExpandedId(expandedId === log.id ? null : log.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <PaginationBar
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={pageSize}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </>
  );
}
