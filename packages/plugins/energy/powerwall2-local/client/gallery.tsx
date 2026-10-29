import type { PluginGallery } from "../../../pluginOptions.ts";
import {
  Powerwall2LocalTestResult,
  Powerwall2LocalView,
} from "./Powerwall2LocalView.tsx";

const noop = () => {};
const values = {
  host: "192.0.2.10",
  email: "owner@example.com",
  password: "example-only",
  maxStalenessSeconds: "60",
  pollIntervalSeconds: "30",
};
const success = {
  success: true as const,
  device: {
    id: "example-gateway",
    manufacturer: "Tesla",
    name: "Tesla Powerwall 2 via Gateway (Local)",
    model: "26.34.0",
  },
  realtime: {
    solarProductionW: 7500,
    homeConsumptionW: 4000,
    gridPowerW: -2000,
    batteryPowerW: -1500,
    batterySoc: 82,
    gridVoltageV: 240,
    lastUpdated: "2026-10-13T01:00:00.000Z",
  },
};

export const powerwallGallery: PluginGallery = {
  id: "powerwall2-local",
  title: "Powerwall Gateway",
  description:
    "Local Gateway setup and connection feedback. Static examples never contact a device.",
  specimens: [
    {
      label: "Setup — tested local connection",
      Component: () => (
        <Powerwall2LocalView
          values={values}
          onChange={noop}
          onTest={noop}
          pending={false}
          disabled={false}
          result={success}
        />
      ),
    },
    {
      label: "Settings — connection pending",
      Component: () => (
        <Powerwall2LocalTestResult pending disabled onTest={noop} />
      ),
    },
    {
      label: "Settings — stale telemetry",
      Component: () => (
        <Powerwall2LocalTestResult
          pending={false}
          disabled={false}
          onTest={noop}
          result={{
            success: false,
            error: "Powerwall telemetry is stale (120s old; limit 60s)",
          }}
        />
      ),
    },
  ],
};
