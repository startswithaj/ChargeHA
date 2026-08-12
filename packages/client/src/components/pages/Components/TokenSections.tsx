import { Palette, Ruler, Type } from "lucide-react";
import { Text } from "@radix-ui/themes";
import { GallerySection, Rule } from "./Specimen.tsx";
import styles from "./Components.module.css";

const SURFACE_TOKENS: { token: string; use: string }[] = [
  { token: "--gray-a2", use: "row / form-block background" },
  { token: "--gray-a3", use: "row separator, hover" },
  { token: "--gray-a4", use: "sub-section divider" },
  { token: "--gray-a5", use: "form-block border" },
  { token: "--red-a2", use: "error block bg" },
  { token: "--red-a5", use: "error block border" },
  { token: "--orange-a2", use: "confirm block bg" },
  { token: "--orange-a5", use: "confirm block border" },
  { token: "--green-a3", use: "recently-added highlight" },
];

const DOMAIN_TOKENS: { token: string; use: string }[] = [
  { token: "--color-solar", use: "solar production" },
  { token: "--color-grid-import", use: "grid import" },
  { token: "--color-grid-export", use: "grid export" },
  { token: "--color-home", use: "home consumption" },
  { token: "--color-battery", use: "home battery" },
  { token: "--color-vehicle", use: "vehicle, plugged in" },
  { token: "--color-charging", use: "actively charging" },
  { token: "--color-consumption", use: "consumption series" },
  { token: "--color-connected", use: "live connection" },
  { token: "--color-connecting", use: "reconnecting" },
  { token: "--color-disconnected", use: "offline, unplugged" },
  { token: "--color-away", use: "vehicle not at home" },
];

function Swatches({ tokens }: { tokens: { token: string; use: string }[] }) {
  return (
    <div className={styles.swatches}>
      {tokens.map(({ token, use }) => (
        <div key={token} className={styles.swatch}>
          <span
            className={styles.swatchChip}
            style={{ background: `var(${token})` }}
          />
          <div>
            <Text
              size="1"
              style={{
                display: "block",
                fontFamily: "var(--code-font-family)",
              }}
            >
              {token}
            </Text>
            <Text size="1" color="gray">{use}</Text>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ColourSection() {
  return (
    <GallerySection
      id="colour"
      icon={<Palette size={18} />}
      title="Colour"
      description="Radix alpha scales for surfaces, ChargeHA tokens for energy meaning. Never hard-code a hex."
    >
      <Text size="2" weight="bold">Surfaces and states</Text>
      <Swatches tokens={SURFACE_TOKENS} />
      <div className={styles.subSection}>
        <Text size="2" weight="bold">Energy domain</Text>
        <Rule>
          These carry meaning — solar is always the same colour on a chart, a
          card and a flow diagram.
        </Rule>
        <div style={{ marginTop: 8 }}>
          <Swatches tokens={DOMAIN_TOKENS} />
        </div>
      </div>
    </GallerySection>
  );
}

const TYPE_SCALE: {
  spec: string;
  use: string;
  sample: () => React.JSX.Element;
}[] = [
  {
    spec: 'size="7" weight="bold"',
    use: "metric value — MetricCard only",
    sample: () => <Text size="7" weight="bold">6.42 kW</Text>,
  },
  {
    spec: 'size="5" weight="bold"',
    use: "wizard step title",
    sample: () => <Text size="5" weight="bold">Connect your inverter</Text>,
  },
  {
    spec: 'size="3" weight="bold"',
    use: "section title",
    sample: () => <Text size="3" weight="bold">Solar Tracking</Text>,
  },
  {
    spec: 'size="2" weight="bold"',
    use: "sub-section heading",
    sample: () => <Text size="2" weight="bold">Tariff Periods</Text>,
  },
  {
    spec: 'size="2"',
    use: "row label, body copy",
    sample: () => <Text size="2">Minimum charge current</Text>,
  },
  {
    spec: 'size="2" color="gray"',
    use: "description, empty state",
    sample: () => (
      <Text size="2" color="gray">No tariff periods configured.</Text>
    ),
  },
  {
    spec: 'size="1" color="gray"',
    use: "help text, metadata",
    sample: () => (
      <Text size="1" color="gray">Applies to every charging point.</Text>
    ),
  },
  {
    spec: 'size="1" color="orange"',
    use: "action needed",
    sample: () => (
      <Text size="1" color="orange">Select your inverter to start.</Text>
    ),
  },
];

export function TypographySection() {
  return (
    <GallerySection
      id="typography"
      icon={<Type size={18} />}
      title="Typography"
      description="Radix Text only, largest first. Four sizes carry the whole app — 7 belongs to a metric value and nothing else."
    >
      <div className={styles.scaleList}>
        {TYPE_SCALE.map(({ spec, use, sample }) => (
          <div key={spec + use} className={styles.scaleRow}>
            <div>{sample()}</div>
            <div>
              <span className={styles.scaleSpec}>{spec}</span>
              <span className={styles.scaleUse}>{use}</span>
            </div>
          </div>
        ))}
      </div>
      <Rule>
        Errors are the one thing not in this list. Never style them by hand —
        use FormError, which carries an icon and role="alert" as well as colour.
      </Rule>
    </GallerySection>
  );
}

const SPACING: { name: string; px: number; use: string }[] = [
  { name: "page", px: 24, use: "between sections" },
  { name: "section wrapper", px: 16, use: "header to body" },
  { name: "section body", px: 12, use: "between rows" },
  { name: "row group", px: 8, use: "stacked entity rows (6–10)" },
  { name: "inline controls", px: 8, use: "button groups — never tighter" },
];

export function SpacingSection() {
  return (
    <GallerySection
      id="spacing"
      icon={<Ruler size={18} />}
      title="Spacing & radius"
      description="Five gaps, one radius. Row padding is 8px 10px, form padding 12, radius 6 everywhere."
    >
      <div className={styles.scaleList}>
        {SPACING.map(({ name, px, use }) => (
          <div key={name} className={styles.scaleRow}>
            <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span
                style={{
                  width: px,
                  height: 14,
                  borderRadius: 2,
                  background: "var(--accent-9)",
                  flexShrink: 0,
                }}
              />
              <Text size="2">{name}</Text>
            </span>
            <div>
              <span className={styles.scaleSpec}>{px}px</span>
              <span className={styles.scaleUse}>{use}</span>
            </div>
          </div>
        ))}
      </div>
    </GallerySection>
  );
}
