import { useCallback, useEffect, useMemo, useState } from "react";
import { type RouterOutputs, trpc } from "../trpc.ts";

const DEFAULT_PAGE_SIZE = 50;
const AUTO_REFRESH_MS = 10_000;

export type PluginLogEntry = RouterOutputs["log"]["pluginLogs"]["logs"][number];

export function usePluginLogs(
  filter?: {
    from?: string;
    to?: string;
    level?: string[];
    pluginId?: string;
    search?: string;
  },
  pageSize: number = DEFAULT_PAGE_SIZE,
) {
  const [page, setPage] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const from = filter?.from;
  const to = filter?.to;
  const level = filter?.level;
  const pluginId = filter?.pluginId;
  const search = filter?.search;

  // Reset to page 0 when filter params change
  useEffect(() => {
    setPage(0);
  }, [from, to, level, pluginId, search, pageSize]);

  const input = useMemo(
    () => ({
      limit: pageSize,
      offset: page * pageSize,
      from,
      to,
      level,
      pluginId,
      search,
    }),
    [page, pageSize, from, to, level, pluginId, search],
  );

  const { data, isLoading, isFetching, error, refetch } = trpc.log.pluginLogs
    .useQuery(input, {
      placeholderData: (prev) => prev,
      refetchInterval: autoRefresh ? AUTO_REFRESH_MS : false,
    });

  const refresh = useCallback(() => {
    refetch();
  }, [refetch]);

  return {
    logs: data?.logs ?? [],
    total: data?.total ?? 0,
    loading: isLoading,
    isFetching,
    error: error?.message ?? null,
    page,
    setPage,
    pageSize,
    autoRefresh,
    setAutoRefresh,
    refresh,
  };
}
