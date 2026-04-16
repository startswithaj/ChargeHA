import { Button, Text } from "@radix-ui/themes";

const PRESETS = [
  { key: "flat", label: "Flat Rate" },
  { key: "tou", label: "Time of Use" },
  { key: "ev-tou", label: "EV Time of Use" },
];

export function PresetTemplates({
  hasPeriods,
  confirmPreset,
  onConfirmPreset,
  onLoadPreset,
  onCancelConfirm,
}: {
  hasPeriods: boolean;
  confirmPreset: string | null;
  onConfirmPreset: (key: string) => void;
  onLoadPreset: (key: string) => void;
  onCancelConfirm: () => void;
}) {
  return (
    <div
      style={{
        marginTop: 4,
        paddingTop: 12,
        borderTop: "1px solid var(--gray-a4)",
      }}
    >
      <Text size="2" weight="bold" style={{ display: "block" }}>
        Quick Setup
      </Text>
      <Text
        size="1"
        color="gray"
        style={{ display: "block", marginTop: 2, marginBottom: 8 }}
      >
        Load a preset tariff template. This replaces all existing periods.
      </Text>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {PRESETS.map(({ key, label }) => (
          <Button
            key={key}
            size="1"
            variant="outline"
            onClick={() => {
              if (hasPeriods) {
                onConfirmPreset(key);
              } else {
                onLoadPreset(key);
              }
            }}
          >
            {label}
          </Button>
        ))}
      </div>

      {confirmPreset && (
        <div
          style={{
            marginTop: 8,
            padding: "8px 12px",
            borderRadius: 6,
            background: "var(--orange-a2)",
            border: "1px solid var(--orange-a5)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Text size="2">
            This will replace all existing tariff periods. Continue?
          </Text>
          <Button
            size="1"
            color="red"
            onClick={() => onLoadPreset(confirmPreset)}
          >
            Replace
          </Button>
          <Button
            size="1"
            variant="soft"
            onClick={onCancelConfirm}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
