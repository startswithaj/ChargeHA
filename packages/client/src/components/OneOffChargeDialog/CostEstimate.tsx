import { Text } from "@radix-ui/themes";
import type { ChargeCostEstimate } from "@chargeha/shared/chargeCostEstimate";
import { formatDurationMinutes } from "@chargeha/shared/oneOffCharge";
import { formatRate } from "../../utils/Format.ts";
import styles from "./OneOffChargeDialog.module.css";

interface CostEstimateProps {
  estimate: ChargeCostEstimate | null;
  currencySymbol: string;
}

const money = (amount: number, symbol: string) =>
  `${symbol}${amount.toFixed(2)}`;

/** Tariff-based cost estimate for the proposed window.
 *
 *  Deliberately labelled "up to": the estimate assumes grid import for the
 *  whole window at a constant rate and no early stop at the charge limit, all
 *  of which can only make the real cost lower. */
export function CostEstimate(
  { estimate, currencySymbol }: CostEstimateProps,
) {
  if (!estimate) {
    return (
      <div className={styles.estimate}>
        <Text size="1" color="gray">Loading tariffs…</Text>
      </div>
    );
  }

  const multipleRates = estimate.segments.length > 1;

  return (
    <div className={styles.estimate}>
      <div className={styles.estimateTotal}>
        <Text size="2" weight="medium">Estimated cost</Text>
        <Text size="4" weight="bold">
          up to {money(estimate.cost, currencySymbol)}
        </Text>
      </div>
      <Text size="1" color="gray">
        {estimate.kwh.toFixed(1)} kWh at {estimate.powerKw.toFixed(1)} kW
      </Text>

      {multipleRates &&
        estimate.segments.map((s) => (
          <div key={`${s.label}-${s.ratePerKwh}`} className={styles.segmentRow}>
            <Text size="1" color="gray">
              {s.label} · {formatRate(s.ratePerKwh, currencySymbol)}/kWh ·{" "}
              {formatDurationMinutes(s.minutes)}
            </Text>
            <Text size="1" color="gray">{money(s.cost, currencySymbol)}</Text>
          </div>
        ))}

      <Text size="1" color="gray">
        Assumes grid import for the full window and no early stop at the charge
        limit — solar, tapering, or hitting the limit will cost less.
      </Text>
    </div>
  );
}
