import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { ExportSettingsButton } from "./ExportSettingsButton.tsx";

const { SECTIONS } = vi.hoisted(() => ({
  SECTIONS: {
    charging: { chargingEnabled: true },
    solar: { consumptionExcludesCharging: false },
    battery: { batteryEnabled: false },
    equipment: { threePhaseCharger: false },
    system: { timezone: "UTC" },
    vehicles: {
      vehicles: [{
        id: "v1",
        name: "Car",
        adapterType: "tesla",
        priority: 1,
        mode: "auto",
        config: '{"vin":"SECRETVIN"}',
        lastLocation: { latitude: -33.1, longitude: 151.2 },
      }],
    },
    chargers: [{
      id: "cp-1",
      name: "Charger",
      chargerAdapterType: "tesla",
      mode: "auto",
      priority: 1,
      vehicleId: "v1",
      kind: "vehicle_api",
      active: true,
      state: { isCharging: false },
    }],
    schedules: { schedules: [{ id: "s1", type: "charge" }] },
    tariffs: { periods: [], defaultRate: 0.3 },
    notification: {
      notificationProvider: "telegram",
      notificationEnabledEvents: "",
      notificationTelegramBotToken: "123:secret",
      notificationTelegramChatId: "999",
      notificationTelegramTopicId: "",
      notificationTelegramSilent: false,
    },
  },
}));

vi.mock("../../../trpc.ts", () => {
  const query = (data: unknown) => ({
    useQuery: vi.fn(() => ({ data, isLoading: false, error: null })),
  });
  return {
    trpc: {
      config: {
        charging: { get: query(SECTIONS.charging) },
        solar: { get: query(SECTIONS.solar) },
        battery: { get: query(SECTIONS.battery) },
        equipment: { get: query(SECTIONS.equipment) },
        system: { get: query(SECTIONS.system) },
        notification: { get: query(SECTIONS.notification) },
      },
      vehicle: { list: query(SECTIONS.vehicles) },
      charger: { list: query(SECTIONS.chargers) },
      schedule: { list: query(SECTIONS.schedules) },
      tariff: { list: query(SECTIONS.tariffs) },
    },
  };
});

vi.mock("../../../lib/version.ts", () => ({
  version: { sha: "testsha", commitUrl: null },
}));

describe("ExportSettingsButton", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const openDialog = () => {
    renderWithProviders(<ExportSettingsButton />);
    fireEvent.click(screen.getByRole("button", { name: "Export settings" }));
  };

  it("shows JSON with every section and the version", async () => {
    openDialog();
    const pre = await screen.findByText(/"exportedAt"/);
    const json = JSON.parse(pre.textContent ?? "");
    [
      "charging",
      "solar",
      "battery",
      "equipment",
      "system",
      "notification",
      "vehicles",
      "chargers",
      "schedules",
      "tariffs",
    ].forEach((key) => expect(json[key]).toBeDefined());
    expect(json.version).toBe("testsha");
    expect(json.solar.consumptionExcludesCharging).toBe(false);
    expect(json.home).toBeUndefined();
  });

  it("strips config blobs, location and state from vehicles and chargers", async () => {
    openDialog();
    const pre = await screen.findByText(/"exportedAt"/);
    const json = JSON.parse(pre.textContent ?? "");
    expect(json.vehicles[0].name).toBe("Car");
    expect(json.vehicles[0].config).toBeUndefined();
    expect(json.vehicles[0].lastLocation).toBeUndefined();
    expect(json.chargers[0].kind).toBe("vehicle_api");
    expect(json.chargers[0].state).toBeUndefined();
    expect(pre.textContent).not.toContain("SECRETVIN");
  });

  it("redacts notification secrets but keeps empty fields empty", async () => {
    openDialog();
    const pre = await screen.findByText(/"exportedAt"/);
    const json = JSON.parse(pre.textContent ?? "");
    expect(json.notification.notificationTelegramBotToken).toBe(
      "***redacted***",
    );
    expect(json.notification.notificationTelegramChatId).toBe(
      "***redacted***",
    );
    expect(json.notification.notificationTelegramTopicId).toBe("");
    expect(json.notification.notificationProvider).toBe("telegram");
  });

  it("copies the JSON to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    openDialog();
    await screen.findByText(/"exportedAt"/);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain("***redacted***");
    expect(copied).not.toContain("123:secret");
    expect(
      await screen.findByRole("button", { name: "Copied" }),
    ).toBeInTheDocument();
  });
});
