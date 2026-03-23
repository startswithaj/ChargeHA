import { useCallback, useEffect, useMemo, useState } from "react";
import { type RouterOutputs, trpc } from "../trpc.ts";

const DEFAULT_PAGE_SIZE = 50;
const AUTO_REFRESH_MS = 10_000;

export type VehicleUpdateEntry =
  RouterOutputs["log"]["vehicleUpdates"]["readings"][number];

export function useVehicleUpdates(
  vehicleId?: string,
  filter?: { from?: string; to?: string },
  pageSize: number = DEFAULT_PAGE_SIZE,
) {
  const [page, setPage] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const from = filter?.from;
  const to = filter?.to;

  // Reset to page 0 when filter params change
  useEffect(() => {
    setPage(0);
  }, [vehicleId, from, to, pageSize]);

  const input = useMemo(
    () => ({
      vehicleId,
      limit: pageSize,
      offset: page * pageSize,
      from,
      to,
    }),
    [vehicleId, page, pageSize, from, to],
  );

  const { data, isLoading, isFetching, error, refetch } = trpc.log
    .vehicleUpdates
    .useQuery(input, {
      placeholderData: (prev) => prev,
      refetchInterval: autoRefresh ? AUTO_REFRESH_MS : false,
    });

  const refresh = useCallback(() => {
    refetch();
  }, [refetch]);

  return {
    readings: data?.readings ?? [],
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
