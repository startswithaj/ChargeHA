import { useState } from "react";
import { Button, Card, Switch, Text } from "@radix-ui/themes";
import type { VehicleChargeState } from "@chargeha/shared";
import { LocationField } from "./LocationField.tsx";
import styles from "../../../../client/src/components/ScheduleDialog/ScheduleDialog.module.css";

export interface SimulatedVehicleDialogProps {
  vehicleState: VehicleChargeState | null;
  lastLocation: { latitude: number; longitude: number } | null;
  onSave: (data: {
    isPluggedIn?: boolean;
    latitude?: number;
    longitude?: number;
    chargeLimit?: number;
    socPercent?: number;
  }) => Promise<string | null>;
  onCancel: () => void;
}

/** Validate lat/lng strings and return parsed values or an error message. */
function parseLocation(
  lat: string,
  lng: string,
): { latitude: number; longitude: number } | string {
  const parsedLat = parseFloat(lat);
  const parsedLng = parseFloat(lng);
  if (isNaN(parsedLat) || isNaN(parsedLng)) {
    return "Latitude and longitude must be valid numbers.";
  }
  if (parsedLat < -90 || parsedLat > 90) {
    return "Latitude must be between -90 and 90.";
  }
  if (parsedLng < -180 || parsedLng > 180) {
    return "Longitude must be between -180 and 180.";
  }
  return { latitude: parsedLat, longitude: parsedLng };
}

function initialState(
  vehicleState: VehicleChargeState | null,
  lastLocation: { latitude: number; longitude: number } | null,
) {
  return {
    isPluggedIn: vehicleState?.isPluggedIn ?? true,
    lat: lastLocation?.latitude?.toString() ?? "",
    lng: lastLocation?.longitude?.toString() ?? "",
    chargeLimit: vehicleState?.chargeLimit ?? 80,
    batteryLevel: vehicleState?.batteryLevel != null
      ? Math.round(vehicleState.batteryLevel)
      : 50,
  };
}

function buildSubmitData(
  { isPluggedIn, lat, lng, chargeLimit, batteryLevel }: {
    isPluggedIn: boolean;
    lat: string;
    lng: string;
    chargeLimit: number;
    batteryLevel: number;
  },
) {
  const data: {
    isPluggedIn?: boolean;
    latitude?: number;
    longitude?: number;
    chargeLimit?: number;
    socPercent?: number;
  } = { isPluggedIn, chargeLimit, socPercent: batteryLevel };
  if (lat.trim() && lng.trim()) {
    const loc = parseLocation(lat, lng);
    if (typeof loc === "string") return loc;
    data.latitude = loc.latitude;
    data.longitude = loc.longitude;
  }
  return data;
}

function StepperField(
  { label, value, suffix, min, max, onStep, hint }: {
    label: string;
    value: number;
    suffix: string;
    min: number;
    max: number;
    onStep: (delta: number) => void;
    hint?: string;
  },
) {
  return (
    <div className={styles.field}>
      <Text size="2" weight="medium">{label}</Text>
      <div className={styles.stepperRow}>
        <Button
          type="button"
          variant="ghost"
          size="1"
          disabled={value <= min}
          onClick={() => onStep(-5)}
        >
          −
        </Button>
        <Text size="3" weight="bold" className={styles.stepperValue}>
          {value}
          {suffix}
        </Text>
        <Button
          type="button"
          variant="ghost"
          size="1"
          disabled={value >= max}
          onClick={() => onStep(5)}
        >
          +
        </Button>
      </div>
      {hint && <Text size="1" color="gray">{hint}</Text>}
    </div>
  );
}

export function SimulatedVehicleDialog({
  vehicleState,
  lastLocation,
  onSave,
  onCancel,
}: SimulatedVehicleDialogProps): JSX.Element {
  const initial = initialState(vehicleState, lastLocation);
  const [isPluggedIn, setIsPluggedIn] = useState(initial.isPluggedIn);
  const [lat, setLat] = useState(initial.lat);
  const [lng, setLng] = useState(initial.lng);
  const [chargeLimit, setChargeLimit] = useState(initial.chargeLimit);
  const [batteryLevel, setBatteryLevel] = useState(initial.batteryLevel);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const result = buildSubmitData({
      isPluggedIn,
      lat,
      lng,
      chargeLimit,
      batteryLevel,
    });
    if (typeof result === "string") {
      setError(result);
      setSaving(false);
      return;
    }
    const err = await onSave(result);
    setSaving(false);
    if (err) setError(err);
  };

  const stepLimit = (delta: number) =>
    setChargeLimit((prev) => Math.max(50, Math.min(100, prev + delta)));

  const stepBattery = (delta: number) =>
    setBatteryLevel((prev) => Math.max(0, Math.min(100, prev + delta)));

  return (
    <Card
      className={styles.formCard}
      style={{ "--accent": "var(--purple-9)" } as React.CSSProperties}
    >
      <form onSubmit={handleSubmit} className={styles.form}>
        <Text size="1" color="gray">
          Override runtime state for this simulated vehicle. Changes take effect
          immediately on the dashboard.
        </Text>

        {/* Plugged In */}
        <div className={styles.field}>
          <Text size="2" weight="medium">Plugged In</Text>
          <Switch
            size="2"
            checked={isPluggedIn}
            onCheckedChange={setIsPluggedIn}
          />
        </div>

        <StepperField
          label="Battery Level"
          value={batteryLevel}
          suffix="%"
          min={0}
          max={100}
          onStep={stepBattery}
          hint="Sets the battery state of charge. Step: 5%."
        />

        {/* Location */}
        <LocationField
          lat={lat}
          setLat={setLat}
          lng={lng}
          setLng={setLng}
          setError={setError}
        />

        <StepperField
          label="Charge Limit"
          value={chargeLimit}
          suffix="%"
          min={50}
          max={100}
          onStep={stepLimit}
        />

        {/* Validation error */}
        {error && (
          <div className={styles.error}>
            <Text size="2" color="red">{error}</Text>
          </div>
        )}

        {/* Actions */}
        <div className={styles.footer} style={{ marginTop: 0 }}>
          <Button type="button" variant="soft" color="gray" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
