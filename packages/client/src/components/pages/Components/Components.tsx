import { Text } from "@radix-ui/themes";
import {
  ColourSection,
  SpacingSection,
  TypographySection,
} from "./TokenSections.tsx";
import {
  BadgeSection,
  ButtonSection,
  IconButtonSection,
  IconSection,
  InputSection,
  LoaderSection,
} from "./ControlSections.tsx";
import {
  ActionAlignmentSection,
  EntityRowSection,
  FormSection,
  PanelSection,
  SettingsRowSection,
} from "./PatternSections.tsx";
import {
  ChargerCardSection,
  EnergyFlowSection,
  FeedbackSection,
  MetricCardSection,
  ScheduleCardSection,
  VehicleCardSection,
  WizardSection,
} from "./CardSections.tsx";
import { ErrorSection } from "./ErrorSection.tsx";
import { DiscoverySection } from "./DiscoverySection.tsx";
import styles from "./Components.module.css";

interface Entry {
  id: string;
  label: string;
  render: () => React.JSX.Element;
}

interface Group {
  id: string;
  title: string;
  blurb: string;
  entries: Entry[];
}

// Grouped by where a component is used. Drives both the index and the body.
const GROUPS: Group[] = [
  {
    id: "common",
    title: "Common",
    blurb:
      "Tokens and controls used on every screen. Anything new should be built from these before a new shape is invented.",
    entries: [
      { id: "colour", label: "Colour", render: () => <ColourSection /> },
      {
        id: "typography",
        label: "Typography",
        render: () => <TypographySection />,
      },
      { id: "spacing", label: "Spacing", render: () => <SpacingSection /> },
      { id: "buttons", label: "Buttons", render: () => <ButtonSection /> },
      {
        id: "icon-buttons",
        label: "Icon buttons",
        render: () => <IconButtonSection />,
      },
      { id: "badges", label: "Badges", render: () => <BadgeSection /> },
      { id: "icons", label: "Icons", render: () => <IconSection /> },
      { id: "inputs", label: "Inputs", render: () => <InputSection /> },
      { id: "loaders", label: "Loaders", render: () => <LoaderSection /> },
      { id: "feedback", label: "Feedback", render: () => <FeedbackSection /> },
      { id: "errors", label: "Errors", render: () => <ErrorSection /> },
      {
        id: "discovery",
        label: "Discovery results",
        render: () => <DiscoverySection />,
      },
    ],
  },
  {
    id: "wizard",
    title: "Wizard",
    blurb:
      "First-run and plugin setup. One decision per step, and the same footer rule as every form: back left, primary right.",
    entries: [
      { id: "wizard-steps", label: "Steps", render: () => <WizardSection /> },
    ],
  },
  {
    id: "dashboard",
    title: "Dashboard",
    blurb:
      "Live energy and vehicle state. Colour carries meaning here — solar is the same colour on a card, a chart and the flow diagram.",
    entries: [
      {
        id: "metric-cards",
        label: "Metric cards",
        render: () => <MetricCardSection />,
      },
      {
        id: "energy-flow",
        label: "Energy flow",
        render: () => <EnergyFlowSection />,
      },
      {
        id: "vehicle-cards",
        label: "Vehicle cards",
        render: () => <VehicleCardSection />,
      },
      {
        id: "charger-cards",
        label: "Charger cards",
        render: () => <ChargerCardSection />,
      },
      {
        id: "schedule-cards",
        label: "Schedule cards",
        render: () => <ScheduleCardSection />,
      },
    ],
  },
  {
    id: "settings",
    title: "Settings",
    blurb:
      "Panels, rows and inline editors. Editing always expands in place — a dialog confirms a destructive action, it never edits.",
    entries: [
      { id: "panels", label: "Panels", render: () => <PanelSection /> },
      { id: "rows", label: "Rows", render: () => <SettingsRowSection /> },
      {
        id: "entity-rows",
        label: "Entity rows",
        render: () => <EntityRowSection />,
      },
      {
        id: "actions",
        label: "Action alignment",
        render: () => <ActionAlignmentSection />,
      },
      { id: "forms", label: "Forms", render: () => <FormSection /> },
    ],
  },
];

function GroupIndex({ group }: { group: Group }) {
  return (
    <div className={styles.tocGroup}>
      <span className={styles.tocGroupTitle}>{group.title}</span>
      {group.entries.map(({ id, label }) => (
        <a key={id} href={`#${id}`} className={styles.tocLink}>{label}</a>
      ))}
    </div>
  );
}

/** Style guide. Renders from local fixtures only — no queries, no mutations.
 *  Rules quoted beside each specimen come from docs/settings-ui.md. */
export function Components() {
  return (
    <div className={styles.page}>
      <div>
        <Text size="5" weight="bold" style={{ display: "block" }}>
          Component library
        </Text>
        <Text size="2" color="gray" style={{ display: "block" }}>
          Every shipped component on one page, driven by static fixtures. Use it
          to pick an existing pattern before inventing a new one.
        </Text>
        <Text size="1" color="gray" style={{ display: "block", marginTop: 6 }}>
          Development tool — the Components nav item only appears under{" "}
          <code>vite dev</code>. The route still resolves in a production build,
          but nothing links to it.
        </Text>
      </div>

      <nav className={styles.toc} aria-label="Component sections">
        {GROUPS.map((group) => <GroupIndex key={group.id} group={group} />)}
      </nav>

      {GROUPS.map((group) => (
        <section key={group.id} id={group.id} className={styles.group}>
          <div className={styles.groupHeader}>
            <Text size="6" weight="bold" style={{ display: "block" }}>
              {group.title}
            </Text>
            <Text size="2" color="gray">{group.blurb}</Text>
          </div>
          {group.entries.map(({ id, render }) => <div key={id}>{render()}
          </div>)}
        </section>
      ))}
    </div>
  );
}
