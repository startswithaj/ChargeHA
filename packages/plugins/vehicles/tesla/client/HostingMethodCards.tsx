import { Badge, Text } from "@radix-ui/themes";
import { Cloud, Github, Globe, Sparkles } from "lucide-react";
import styles from "../../../../client/src/components/Wizard/steps/steps.module.css";

export type HostingMethod = null | "self" | "github" | "ai" | "tunnel";

interface HostingMethodCardsProps {
  hostingMethod: HostingMethod;
  onSelect: (method: HostingMethod) => void;
}

export function HostingMethodCards(
  { hostingMethod, onSelect }: HostingMethodCardsProps,
) {
  return (
    <div className={styles.optionCards}>
      <div
        className={`${styles.optionCard} ${
          hostingMethod === "tunnel" ? styles.optionCardSelected : ""
        }`}
        onClick={() => onSelect("tunnel")}
        role="button"
        tabIndex={0}
        aria-label="Use Cloudflare Tunnel"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onSelect("tunnel");
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Text size="2" weight="medium">
            <Cloud
              size={14}
              style={{ verticalAlign: "middle", marginRight: 6 }}
            />
            Use Cloudflare Tunnel
          </Text>
          <Badge color="green" size="1">Recommended</Badge>
        </div>
        <Text size="1" color="gray">
          Temporary public URL — no account needed, torn down after setup.
        </Text>
      </div>

      <div
        className={`${styles.optionCard} ${
          hostingMethod === "self" ? styles.optionCardSelected : ""
        }`}
        onClick={() => onSelect("self")}
        role="button"
        tabIndex={0}
        aria-label="Host it myself"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onSelect("self");
        }}
      >
        <Text size="2" weight="medium">
          <Globe
            size={14}
            style={{ verticalAlign: "middle", marginRight: 6 }}
          />
          Host it myself
        </Text>
        <Text size="1" color="gray">
          Any static hosting service — Netlify, S3, Cloudflare, etc.
        </Text>
      </div>

      <div
        className={`${styles.optionCard} ${
          hostingMethod === "github" ? styles.optionCardSelected : ""
        }`}
        onClick={() => onSelect("github")}
        role="button"
        tabIndex={0}
        aria-label="Host on GitHub Pages"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onSelect("github");
        }}
      >
        <Text size="2" weight="medium">
          <Github
            size={14}
            style={{ verticalAlign: "middle", marginRight: 6 }}
          />
          Host on GitHub Pages
        </Text>
        <Text size="1" color="gray">
          Free static hosting — step-by-step instructions provided.
        </Text>
      </div>

      <div
        className={`${styles.optionCard} ${
          hostingMethod === "ai" ? styles.optionCardSelected : ""
        }`}
        onClick={() => onSelect("ai")}
        role="button"
        tabIndex={0}
        aria-label="Set it up with AI"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onSelect("ai");
        }}
      >
        <Text size="2" weight="medium">
          <Sparkles
            size={14}
            style={{ verticalAlign: "middle", marginRight: 6 }}
          />
          Set it up with AI
        </Text>
        <Text size="1" color="gray">
          Get an AI prompt that creates a GitHub Pages repo for you using the gh
          CLI.
        </Text>
      </div>
    </div>
  );
}
