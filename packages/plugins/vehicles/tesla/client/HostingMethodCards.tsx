import { Badge, Text } from "@radix-ui/themes";
import { Cloud, Github, Globe, KeyRound, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { stepStyles as styles } from "../../../hostUi.ts";
import { isStableOrigin } from "./oauthOrigin.ts";

export type HostingMethod =
  | null
  | "self"
  | "github"
  | "fleetkey"
  | "ai"
  | "tunnel";

interface HostingMethodCardsProps {
  hostingMethod: HostingMethod;
  onSelect: (method: HostingMethod) => void;
  /** Disables the static-hosting cards (self/github/ai). Set when the browser
   *  origin can't be registered with Tesla for sign-in — the tunnel is then
   *  required for the OAuth redirect anyway and covers key hosting too. */
  staticDisabled?: boolean;
  browserOrigin: string;
}

/** ssh port-forward command that makes this server reachable at
 *  localhost:8000 on the machine the user is browsing from. */
function forwardCommand(browserOrigin: string): string {
  try {
    const url = new URL(browserOrigin);
    return `ssh -L 8000:localhost:${url.port || "80"} ${url.hostname}`;
  } catch {
    return "ssh -L 8000:localhost:<port> <server>";
  }
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
  { hostingMethod, onSelect, staticDisabled = false, browserOrigin }:
    HostingMethodCardsProps,
) {
  return (
    <>
      <Text as="p" size="1" color="gray">
        The tunnel is the easiest option but Tesla can block tunnel domains. The
        safest path is to run setup from localhost and host the key on
        FleetKey.net or GitHub Pages.
        {!isStableOrigin(browserOrigin) && (
          <>
            {" "}To get to localhost from here, run{" "}
            <code>{forwardCommand(browserOrigin)}</code>{" "}
            in a terminal on this computer (add <code>user@</code>{" "}
            before the address if your username differs on the server), then
            continue setup at <code>http://localhost:8000</code>.
          </>
        )}
      </Text>
      <div className={styles.optionCards}>
        <MethodCard
          method="tunnel"
          selected={hostingMethod === "tunnel"}
          disabled={false}
          onSelect={onSelect}
          icon={Cloud}
          label="Use a temporary tunnel"
          badge="Easiest"
          description="One click, no account — but Tesla can block tunnel domains, and free tunnels last 60 minutes."
        />
        <MethodCard
          method="fleetkey"
          selected={hostingMethod === "fleetkey"}
          disabled={staticDisabled}
          onSelect={onSelect}
          icon={KeyRound}
          label="Host on FleetKey.net"
          badge="Safest"
          description="Free key hosting by Teslemetry — paste your key, get a domain instantly."
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
          Static hosting is unavailable from this address — Tesla sign-in can't
          use a plain http address, so the tunnel is required anyway and covers
          key hosting too. Alternatively, open ChargeHA via localhost (forward a
          port from your machine:{" "}
          <code>
            ssh -L 8000:&lt;this host&gt;:&lt;port&gt; user@&lt;this host&gt;
          </code>) and these options unlock.
        </Text>
      )}
    </>
  );
}
