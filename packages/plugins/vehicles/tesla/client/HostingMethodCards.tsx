import { Badge, Text } from "@radix-ui/themes";
import { Cloud, Github, Globe, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import styles from "../../../../client/src/components/Wizard/steps/steps.module.css";

export type HostingMethod = null | "self" | "github" | "ai" | "tunnel";

interface HostingMethodCardsProps {
  hostingMethod: HostingMethod;
  onSelect: (method: HostingMethod) => void;
  /** Disables the static-hosting cards (self/github/ai). Set when the browser
   *  origin can't be registered with Tesla for sign-in — the tunnel is then
   *  required for the OAuth redirect anyway and covers key hosting too. */
  staticDisabled?: boolean;
}

function MethodCard(
  {
    method,
    selected,
    disabled,
    onSelect,
    icon: Icon,
    label,
    description,
    badge,
  }: {
    method: HostingMethod;
    selected: boolean;
    disabled: boolean;
    onSelect: (method: HostingMethod) => void;
    icon: LucideIcon;
    label: string;
    description: string;
    badge?: string;
  },
) {
  const select = () => {
    if (!disabled) onSelect(method);
  };
  return (
    <div
      className={`${styles.optionCard} ${
        selected ? styles.optionCardSelected : ""
      }`}
      style={disabled ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
      onClick={select}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-disabled={disabled}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") select();
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Text size="2" weight="medium">
          <Icon
            size={14}
            style={{ verticalAlign: "middle", marginRight: 6 }}
          />
          {label}
        </Text>
        {badge && <Badge color="green" size="1">{badge}</Badge>}
      </div>
      <Text size="1" color="gray">
        {description}
      </Text>
    </div>
  );
}

export function HostingMethodCards(
  { hostingMethod, onSelect, staticDisabled = false }: HostingMethodCardsProps,
) {
  return (
    <>
      <div className={styles.optionCards}>
        <MethodCard
          method="tunnel"
          selected={hostingMethod === "tunnel"}
          disabled={false}
          onSelect={onSelect}
          icon={Cloud}
          label="Use Cloudflare Tunnel"
          badge="Recommended"
          description="Temporary public URL — no account needed, torn down after setup."
        />
        <MethodCard
          method="self"
          selected={hostingMethod === "self"}
          disabled={staticDisabled}
          onSelect={onSelect}
          icon={Globe}
          label="Host it myself"
          description="Any static hosting service — Netlify, S3, Cloudflare, etc."
        />
        <MethodCard
          method="github"
          selected={hostingMethod === "github"}
          disabled={staticDisabled}
          onSelect={onSelect}
          icon={Github}
          label="Host on GitHub Pages"
          description="Free static hosting — step-by-step instructions provided."
        />
        <MethodCard
          method="ai"
          selected={hostingMethod === "ai"}
          disabled={staticDisabled}
          onSelect={onSelect}
          icon={Sparkles}
          label="Set it up with AI"
          description="Get an AI prompt that creates a GitHub Pages repo for you using the gh CLI."
        />
      </div>
      {staticDisabled && (
        <Text as="p" size="1" color="gray">
          Static hosting is unavailable — your browser address can't be
          registered with Tesla for sign-in, so the tunnel is required anyway
          and covers key hosting too.
        </Text>
      )}
    </>
  );
}
