import { Button, TextField } from "@radix-ui/themes";
import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { SettingsRow } from "../Settings/SettingsLayout.tsx";
import { ErrorBanner } from "../../ui/ErrorBanner.tsx";
import { FormError } from "../../ui/FormError.tsx";
import { GallerySection, Rule, StackedSpecimen } from "./Specimen.tsx";
import styles from "./Components.module.css";

const noop = () => {};

const MESSAGE = "End time must be after start time.";

/** Wraps each specimen so it is judged at the density it ships at. */
function FormBlock({ children }: { children: ReactNode }) {
  return (
    <div className={styles.formBlock}>
      <SettingsRow label="Period name">
        <TextField.Root
          size="2"
          value="Off-peak"
          onChange={noop}
          style={{ width: 180 }}
        />
      </SettingsRow>
      {children}
      <div className={styles.formFooter}>
        <Button size="2" variant="soft" color="gray">Cancel</Button>
        <Button size="2" disabled>Add Period</Button>
      </div>
    </div>
  );
}

export function ErrorSection() {
  return (
    <GallerySection
      id="errors"
      icon={<TriangleAlert size={18} />}
      title="Errors"
      description="FormError is the one in-form error. Bare red text is not an option — it was 37 sites and is now 3, each a deliberate exception."
    >
      <StackedSpecimen label='<FormError message={error} /> — size="1", the default'>
        <Rule>
          For settings panels and inline row editors, where the surrounding rows
          are dense. A null or empty message renders nothing, so call sites pass
          the error straight in rather than guarding it. It replaced bare red
          text, where colour was the only thing marking an error — invisible to
          anyone who cannot see red, and silent to a screen reader.
        </Rule>
        <FormBlock>
          <FormError message={MESSAGE} />
        </FormBlock>
      </StackedSpecimen>

      <StackedSpecimen label='<FormError message={error} size="2" /> — wizard steps, login'>
        <Rule>
          Where the surrounding body copy is size 2, a size-1 error reads as a
          footnote. Radix scales Callout padding and text together, so the icon
          steps 14 → 16 with them.
        </Rule>
        <FormBlock>
          <FormError message={MESSAGE} size="2" />
        </FormBlock>
      </StackedSpecimen>

      <StackedSpecimen label="ErrorBanner — still the panel-level shape">
        <Rule>
          FormError is for errors inside a form. A failure that takes out a
          whole panel keeps using ErrorBanner, above the Section.
        </Rule>
        <ErrorBanner
          title="Inverter unreachable"
          description="Charging is paused until readings resume."
        />
      </StackedSpecimen>
    </GallerySection>
  );
}
