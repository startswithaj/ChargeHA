import { Text } from "@radix-ui/themes";
import styles from "./TimePicker.module.css";

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 15, 30, 45];

interface TimePickerProps {
  value: string; // "HH:MM"
  onChange: (value: string) => void;
}

export function TimePicker({ value, onChange }: TimePickerProps) {
  const [h, m] = value.split(":").map(Number);

  const setHour = (hour: number) => {
    onChange(`${String(hour).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  };

  const setMinute = (minute: number) => {
    onChange(
      `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    );
  };

  return (
    <div className={styles.picker}>
      <select
        className={styles.select}
        value={h}
        onChange={(e) => setHour(Number(e.target.value))}
      >
        {HOURS.map((hr) => (
          <option key={hr} value={hr}>
            {String(hr).padStart(2, "0")}
          </option>
        ))}
      </select>
      <Text size="3" weight="bold" className={styles.colon}>:</Text>
      <select
        className={styles.select}
        value={m}
        onChange={(e) => setMinute(Number(e.target.value))}
      >
        {MINUTES.map((min) => (
          <option key={min} value={min}>
            {String(min).padStart(2, "0")}
          </option>
        ))}
      </select>
    </div>
  );
}
