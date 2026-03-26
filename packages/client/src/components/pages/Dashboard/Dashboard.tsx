import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button, Card, Text } from "@radix-ui/themes";
import { useEnergyData } from "../../../hooks/useEnergyData.ts";
import { useToast } from "../../../hooks/useToast.tsx";
import { formatRelativeTime } from "../../../utils/Format.ts";
import { trpc } from "../../../trpc.ts";
import { EnergyOverview } from "./EnergyOverview.tsx";
import { VehicleList } from "./VehicleList.tsx";
import styles from "./Dashboard.module.css";

interface SystemAlert {
  message: string;
  timestamp: string;
  vehicleId: string;
  vehicleName: string;
}

interface DashboardProps {
  onNavigateSettings?: () => void;
}

export function Dashboard({ onNavigateSettings }: DashboardProps) {
  const { addToast } = useToast();
  const { data: energyData } = useEnergyData();
  const lastUpdated = energyData?.lastUpdated ?? null;
  const utils = trpc.useUtils();

  // Re-render every 10s to keep relative time fresh when SSE stops
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1_000);
    return () => clearInterval(id);
  }, []);

  // Derive system alert from config query
  const { data: systemAlertRaw } = trpc.config.systemAlert.useQuery(
    undefined,
    { refetchInterval: 30_000 },
  );

  const systemAlert = useMemo((): SystemAlert | null => {
    if (!systemAlertRaw) return null;
    try {
      return JSON.parse(systemAlertRaw);
    } catch {
      return null;
    }
  }, [systemAlertRaw]);

  const dismissAlertMutation = trpc.config.dismissSystemAlert.useMutation({
    onSuccess: () => {
      utils.config.systemAlert.invalidate();
    },
    onError: (err) => {
      addToast(
        err instanceof Error ? err.message : "Failed to dismiss alert",
        "error",
      );
    },
  });

  // Collect plugin warnings (e.g. proxy unreachable) for display
  const { data: pluginWarnings } = trpc.health.pluginWarnings.useQuery();

  return (
    <div className={styles.dashboard}>
      {systemAlert && (
        <Card style={{ borderLeft: "3px solid var(--red-9)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <AlertTriangle
              size={20}
              style={{ color: "var(--red-9)", flexShrink: 0 }}
            />
            <div style={{ flex: 1 }}>
              <Text size="2" weight="bold" style={{ display: "block" }}>
                Safety Alert
              </Text>
              <Text size="2" color="gray">
                {systemAlert.message}
              </Text>
            </div>
            <Button
              variant="soft"
              color="red"
              size="2"
              onClick={() => dismissAlertMutation.mutate()}
            >
              Dismiss
            </Button>
          </div>
        </Card>
      )}

      <EnergyOverview pluginWarnings={pluginWarnings ?? []} />

      <VehicleList
        onNavigateSettings={onNavigateSettings}
      />

      {lastUpdated && (
        <Text size="1" color="gray" className={styles.lastUpdated}>
          Updated {formatRelativeTime(lastUpdated)}
        </Text>
      )}
    </div>
  );
}
