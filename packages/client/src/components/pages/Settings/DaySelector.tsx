import { Button } from "@radix-ui/themes";
import { ALL_DAYS, DAY_LABELS, WEEKDAYS, WEEKEND } from "./tariffUtils.ts";

export function DaySelector({
  days,
  onChange,
}: {
  days: string[];
  onChange: (days: string[]) => void;
}) {
  const isEveryDay = days.length === 7;
  const isWeekdays = days.length === 5 &&
    WEEKDAYS.every((d) => days.includes(d));
  const isWeekend = days.length === 2 &&
    WEEKEND.every((d) => days.includes(d));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 4 }}>
        <Button
          size="1"
          variant={isEveryDay ? "solid" : "outline"}
          onClick={() => onChange([...ALL_DAYS])}
        >
          Every day
        </Button>
        <Button
          size="1"
          variant={isWeekdays ? "solid" : "outline"}
          onClick={() => onChange([...WEEKDAYS])}
        >
          Weekdays
        </Button>
        <Button
          size="1"
          variant={isWeekend ? "solid" : "outline"}
          onClick={() => onChange([...WEEKEND])}
        >
          Weekends
        </Button>
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        {ALL_DAYS.map((d) => (
          <Button
            key={d}
            size="1"
            variant={days.includes(d) ? "solid" : "outline"}
            style={{ minWidth: 40, padding: "0 6px" }}
            onClick={() => {
              if (days.includes(d)) {
                // Don't allow removing last day
                if (days.length > 1) {
                  onChange(days.filter((x) => x !== d));
                }
              } else {
                onChange([...days, d]);
              }
            }}
          >
            {DAY_LABELS[d]}
          </Button>
        ))}
      </div>
    </div>
  );
}
