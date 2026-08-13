import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  Dialog,
  Flex,
  IconButton,
  Switch,
  Text,
  TextField,
} from "@radix-ui/themes";
import {
  AlertTriangle,
  AlignRight,
  Clock,
  LayoutPanelTop,
  Pencil,
  Plug,
  Plus,
  Rows3,
  SquarePen,
  Sun,
  Trash2,
} from "lucide-react";
import type { SaveStatus } from "../../../hooks/useSectionConfig.ts";
import { Section } from "../../ui/Section.tsx";
import { ChargerRow } from "../Settings/ChargerRow.tsx";
import { NumberInput, SettingsRow } from "../Settings/SettingsLayout.tsx";
import {
  BareSection,
  GallerySection,
  Rule,
  Specimen,
  StackedSpecimen,
} from "./Specimen.tsx";
import {
  apiCharger,
  inactiveCharger,
  smartCharger,
  vehicles,
} from "./fixtures.ts";
import styles from "./Components.module.css";
import { FormError } from "../../ui/FormError.tsx";

const noop = () => {};

const status = (state: SaveStatus["state"], message?: string): SaveStatus => ({
  state,
  message,
  tick: 0,
});

export function PanelSection() {
  return (
    <BareSection
      id="panels"
      icon={<LayoutPanelTop size={18} />}
      title="Panels"
      description="Every setting lives in a Section. The card border is the save state — panels never draw their own."
    >
      <Rule>
        Save is owned by the Section header: pass isDirty + onSave and it
        appears. A panel that draws its own header Save is a bug.
      </Rule>
      <Section
        icon={<Sun size={18} />}
        title="Solar Tracking"
        description="Charge from surplus solar rather than the grid."
      >
        <SettingsRow
          label="Track solar surplus"
          help="Only charge when production exceeds household load."
        >
          <Switch checked onCheckedChange={noop} />
        </SettingsRow>
        <SettingsRow label="Minimum surplus">
          <NumberInput value="1400" onChange={noop} suffix="W" />
        </SettingsRow>
      </Section>

      <Section
        icon={<Sun size={18} />}
        title="Dirty — 2px amber ring, header Save appears"
        description="isDirty is true and onSave is supplied."
        isDirty
        onSave={noop}
      >
        <SettingsRow label="Minimum surplus">
          <NumberInput value="1600" onChange={noop} suffix="W" />
        </SettingsRow>
      </Section>

      <Section
        icon={<Sun size={18} />}
        title="Saving"
        description="saveStatus.state === 'saving' — Save disables, grey badge shows."
        isDirty
        onSave={noop}
        saveStatus={status("saving")}
      >
        <SettingsRow label="Minimum surplus">
          <NumberInput value="1600" onChange={noop} suffix="W" />
        </SettingsRow>
      </Section>

      <Section
        icon={<Sun size={18} />}
        title="Error — red ring, message under the description"
        description="saveStatus.state === 'error'."
        saveStatus={status("error", "Inverter rejected the value.")}
      >
        <SettingsRow label="Minimum surplus">
          <NumberInput value="1600" onChange={noop} suffix="W" />
        </SettingsRow>
      </Section>

      <Section
        icon={<Plug size={18} />}
        title="Badge and action slot"
        description="badge flags the panel; action is the top-right slot, drawn before the header Save."
        badge="Setup needed"
        action={<Button size="1" variant="soft">Simulate</Button>}
      >
        <SettingsRow label="Charging point" help="No adapter configured yet.">
          <Button size="1" variant="soft">
            <Plus size={14} /> Add charger
          </Button>
        </SettingsRow>
      </Section>
    </BareSection>
  );
}

export function SettingsRowSection() {
  return (
    <GallerySection
      id="rows"
      icon={<Rows3 size={18} />}
      title="Settings rows"
      description="Label left, control right, min-height 36. Every setting sits in one — a bare button breaks the rhythm."
    >
      <SettingsRow label="Enable notifications">
        <Switch checked onCheckedChange={noop} />
      </SettingsRow>
      <SettingsRow
        label="Minimum charge current"
        help="Below this the car will not start a session."
      >
        <NumberInput value="5" onChange={noop} suffix="A" />
      </SettingsRow>
      <SettingsRow label="Home radius">
        <TextField.Root
          size="2"
          value="150"
          onChange={noop}
          style={{ width: 80 }}
        />
      </SettingsRow>
    </GallerySection>
  );
}

/** Hand-built from the spec, so the shape sits next to the real ChargerRow. */
function PeriodRow({ enabled }: { enabled: boolean }) {
  return (
    <div className={styles.entityRow} style={{ opacity: enabled ? 1 : 0.5 }}>
      <div className={styles.entityRowMeta}>
        <Text size="2" weight="bold" style={{ minWidth: 90 }}>Off-peak</Text>
        <Badge variant="outline" size="1">
          <Clock size={10} /> 23:00 – 07:00
        </Badge>
        <Badge variant="outline" size="1" color="gray">Mon–Fri</Badge>
        <Badge color="blue" variant="soft" size="1">$0.18 / kWh</Badge>
      </div>
      <div className={styles.entityRowActions}>
        <IconButton variant="ghost" size="1" aria-label="Edit Off-peak">
          <Pencil size={14} />
        </IconButton>
        <IconButton
          variant="ghost"
          color="red"
          size="1"
          aria-label="Delete Off-peak"
        >
          <Trash2 size={14} />
        </IconButton>
      </div>
    </div>
  );
}

function ChargerListSpecimen() {
  return (
    <StackedSpecimen label="ChargerRow — smart charger, vehicle-API point, inactive">
      {[smartCharger, apiCharger, inactiveCharger].map((charger) => (
        <div
          key={charger.id}
          className={styles.entityRow}
          style={{ padding: 0 }}
        >
          <ChargerRow
            charger={charger}
            vehicles={vehicles}
            reorderable={charger.active}
            editable
            expanded={false}
            onEdit={noop}
            onRemove={noop}
            onMove={noop}
            onAssignVehicle={noop}
          />
        </div>
      ))}
    </StackedSpecimen>
  );
}

function ExpandingRowSpecimen() {
  const [expanded, setExpanded] = useState(false);
  return (
    <StackedSpecimen label="Editing expands beneath the row, inside one grey band">
      <Rule>
        The row keeps its live state while you edit. The wrapper owns the
        background so the pair reads as one block, and the edit icon flips to X.
      </Rule>
      <div className={styles.expandedBand}>
        <ChargerRow
          charger={smartCharger}
          vehicles={vehicles}
          reorderable={false}
          editable
          expanded={expanded}
          onEdit={() => setExpanded((v) => !v)}
          onRemove={noop}
          onMove={noop}
          onAssignVehicle={noop}
        />
        {expanded && (
          <div style={{ padding: "0 10px 10px" }}>
            <div className={styles.formBlock}>
              <SettingsRow label="Display name">
                <TextField.Root
                  size="2"
                  value="Garage OCPP"
                  onChange={noop}
                  style={{ width: 180 }}
                />
              </SettingsRow>
              <SettingsRow label="Maximum current">
                <NumberInput value="32" onChange={noop} suffix="A" />
              </SettingsRow>
              <div className={styles.formFooter}>
                <Button
                  size="2"
                  variant="soft"
                  color="gray"
                  onClick={() => setExpanded(false)}
                >
                  Cancel
                </Button>
                <Button size="2">Save</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </StackedSpecimen>
  );
}

export function EntityRowSection() {
  return (
    <GallerySection
      id="entity-rows"
      icon={<Plug size={18} />}
      title="Entity rows"
      description="A list you add to, edit and delete from. Padding 8px 10px, radius 6, gray-a2 background, disabled rows at 0.5 opacity."
    >
      <StackedSpecimen label="List header — bold label left, soft Add button right">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <Text size="2" weight="bold">Tariff Periods</Text>
          <Button size="1" variant="soft">
            <Plus size={14} /> Add Period
          </Button>
        </div>
        <PeriodRow enabled />
        <PeriodRow enabled={false} />
      </StackedSpecimen>
      <ChargerListSpecimen />
      <ExpandingRowSpecimen />
    </GallerySection>
  );
}

export function ActionAlignmentSection() {
  return (
    <GallerySection
      id="actions"
      icon={<AlignRight size={18} />}
      title="Action alignment"
      description="One rule, no exceptions: cancel left, primary right, the pair right-aligned with gap 8. It holds in inline forms, dialogs and confirm banners alike."
    >
      <Rule>
        Cancel is variant="soft" color="gray". The primary is solid with no
        variant, and color="red" when the action destroys something. Buttons in
        a group are never butted together — anything tighter than 8 reads as one
        control.
      </Rule>

      <StackedSpecimen label="Inline form — flex-end, gap 8, marginTop 4">
        <div className={styles.formBlock}>
          <SettingsRow label="Display name">
            <TextField.Root
              size="2"
              value="Garage OCPP"
              onChange={noop}
              style={{ width: 180 }}
            />
          </SettingsRow>
          <div className={styles.formFooter}>
            <Button size="2" variant="soft" color="gray">Cancel</Button>
            <Button size="2">Save</Button>
          </div>
        </div>
      </StackedSpecimen>

      <StackedSpecimen label="Dialog — the same spec, as ScheduleDialog.module.css .footer">
        <Card>
          <Text size="3" weight="bold" style={{ display: "block" }}>
            Remove Authentication?
          </Text>
          <Text size="2" color="gray">
            Anyone on your network will be able to control charging.
          </Text>
          <div className={styles.formFooter}>
            <Button size="2" variant="soft" color="gray">Cancel</Button>
            <Button size="2" color="red">Remove Authentication</Button>
          </div>
        </Card>
      </StackedSpecimen>

      <StackedSpecimen label="Confirm banner — same order, sized down to size 1">
        <div className={styles.confirmBanner}>
          <Text size="2">
            Loading a preset replaces your current tariff periods.
          </Text>
          <div className={styles.entityRowActions}>
            <Button size="1" variant="soft" color="gray">Cancel</Button>
            <Button size="1">Replace</Button>
          </div>
        </div>
      </StackedSpecimen>

      <StackedSpecimen label="Disabled until valid — the primary, never the cancel">
        <div className={styles.formFooter}>
          <Button size="2" variant="soft" color="gray">Cancel</Button>
          <Button size="2" disabled>Add Period</Button>
        </div>
      </StackedSpecimen>

      <StackedSpecimen label="Don't — butted together, or primary on the left">
        <Rule>
          Both of these appear nowhere in the app and should stay that way.
        </Rule>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 0 }}>
          <Button size="2" variant="soft" color="gray">Cancel</Button>
          <Button size="2">Save</Button>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button size="2">Save</Button>
          <Button size="2" variant="soft" color="gray">Cancel</Button>
        </div>
      </StackedSpecimen>
    </GallerySection>
  );
}

export function FormSection() {
  return (
    <GallerySection
      id="forms"
      icon={<SquarePen size={18} />}
      title="Forms & confirmations"
      description="One form component serves add and edit — only submitLabel changes. Dialogs confirm destructive actions; they never edit."
    >
      <StackedSpecimen label="Form block — gray-a2 on gray-a5, padding 12, radius 6">
        <div className={styles.formBlock}>
          <SettingsRow label="Period name">
            <TextField.Root
              size="2"
              value="Off-peak"
              onChange={noop}
              style={{ width: 180 }}
            />
          </SettingsRow>
          <SettingsRow label="Rate">
            <NumberInput
              value="0.18"
              onChange={noop}
              suffix="/kWh"
              step={0.01}
            />
          </SettingsRow>
          <FormError message="End time must be after start time." />
          <div className={styles.formFooter}>
            <Button size="2" variant="soft" color="gray">Cancel</Button>
            <Button size="2" disabled>Add Period</Button>
          </div>
        </div>
      </StackedSpecimen>

      <StackedSpecimen label="Inline confirm — orange band, for non-destructive confirmation">
        <div className={styles.confirmBanner}>
          <Text size="2">
            Loading a preset replaces your current tariff periods.
          </Text>
          <div className={styles.entityRowActions}>
            <Button size="1" variant="soft" color="gray">Cancel</Button>
            <Button size="1">Replace</Button>
          </div>
        </div>
      </StackedSpecimen>

      <StackedSpecimen label="Panel-level error banner — Card with a 3px red left border">
        <Card style={{ borderLeft: "3px solid var(--red-9)" }}>
          <Flex align="center" gap="2">
            <AlertTriangle size={16} style={{ color: "var(--red-9)" }} />
            <Text size="2">
              Vehicle credentials expired. Reconnect to resume charging.
            </Text>
          </Flex>
        </Card>
      </StackedSpecimen>

      <Specimen label="Dialog — destructive confirmation only">
        <Dialog.Root>
          <Dialog.Trigger>
            <Button size="1" color="red">Remove Authentication</Button>
          </Dialog.Trigger>
          <Dialog.Content maxWidth="450px">
            <Dialog.Title>Remove Authentication?</Dialog.Title>
            <Dialog.Description size="2">
              Anyone on your network will be able to control charging.
            </Dialog.Description>
            <Flex gap="3" mt="4" justify="end">
              <Dialog.Close>
                <Button variant="soft" color="gray">Cancel</Button>
              </Dialog.Close>
              <Dialog.Close>
                <Button color="red">Remove Authentication</Button>
              </Dialog.Close>
            </Flex>
          </Dialog.Content>
        </Dialog.Root>
      </Specimen>

      <StackedSpecimen label="Sub-section — a divider div, never a nested Card">
        <div className={styles.subSection}>
          <Text size="2" weight="bold">Advanced</Text>
          <Text
            size="1"
            color="gray"
            style={{ display: "block", marginTop: 2 }}
          >
            Rarely needed. Defaults suit most installations.
          </Text>
          <div style={{ marginTop: 8 }}>
            <SettingsRow label="Poll interval">
              <NumberInput value="30" onChange={noop} suffix="s" />
            </SettingsRow>
          </div>
        </div>
      </StackedSpecimen>
    </GallerySection>
  );
}
