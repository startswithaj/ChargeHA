import { Button } from "@radix-ui/themes";
import type { DayOfWeek } from "@chargeha/shared";
import styles from "./DayPicker.module.css";

const DAYS: { key: DayOfWeek; label: string }[] = [
  { key: "mon", label: "M" },
  { key: "tue", label: "T" },
  { key: "wed", label: "W" },
  { key: "thu", label: "T" },
  { key: "fri", label: "F" },
  { key: "sat", label: "S" },
  { key: "sun", label: "S" },
];

const ALL_DAYS: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WEEKDAYS: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri"];
const WEEKENDS: DayOfWeek[] = ["sat", "sun"];

interface DayPickerProps {
  value: DayOfWeek[];
  onChange: (days: DayOfWeek[]) => void;
}

export function DayPicker({ value, onChange }: DayPickerProps) {
  const toggle = (day: DayOfWeek) => {
    if (value.includes(day)) {
      onChange(value.filter((d) => d !== day));
    } else {
      onChange([...value, day]);
    }
  };

  const setPreset = (preset: DayOfWeek[]) => {
    // If already matches preset, deselect all
    const matches = preset.length === value.length &&
      preset.every((d) => value.includes(d));
    onChange(matches ? [] : preset);
  };

  const weekdaysSelected = value.length === 5 &&
    WEEKDAYS.every((d) => value.includes(d));
  const weekendsSelected = value.length === 2 &&
    WEEKENDS.every((d) => value.includes(d));

  return (
    <div className={styles.container}>
      <div className={styles.days}>
        {DAYS.map((day) => (
          <button
            key={day.key}
            type="button"
            className={styles.dayButton}
            data-selected={value.includes(day.key)}
            onClick={() => toggle(day.key)}
          >
            {day.label}
          </button>
        ))}
      </div>
      <div className={styles.quickSelects}>
        <Button
          type="button"
          variant={value.length === 7 ? "solid" : "soft"}
          size="1"
          onClick={() => setPreset(ALL_DAYS)}
        >
          Every Day
        </Button>
        <Button
          type="button"
          variant={weekdaysSelected ? "solid" : "soft"}
          size="1"
          onClick={() => setPreset(WEEKDAYS)}
        >
          Weekdays
        </Button>
        <Button
          type="button"
          variant={weekendsSelected ? "solid" : "soft"}
          size="1"
          onClick={() => setPreset(WEEKENDS)}
        >
          Weekends
        </Button>
      </div>
    </div>
  );
}
