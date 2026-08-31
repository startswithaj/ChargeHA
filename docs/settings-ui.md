# Settings UI Style Guide

Every pattern below is rendered live at **`/components`** (Components in the
nav) — open it beside this document to compare a specimen with its spec.

Derived by reading every component under
`packages/client/src/components/pages/Settings/` plus
`components/ui/Section.tsx` and `Section.module.css`. This documents what the
code actually does today, not an aspiration.

## Hard rules

1. **Editing happens inline, expanding beneath the row.** The row stays visible
   with its live state; the editor opens under it inside the same grey band. A
   dialog confirms a destructive action; it never edits.
2. **Never launch the wizard from Settings** except for flows that genuinely
   need more than one page (Tesla onboarding). If a plugin has a settings
   component, configure it in place.
3. **Buttons in a group get `gap: 8`.** Never butted together.
4. **Cancel left, primary right, right-aligned.** Everywhere — inline forms,
   dialogs, confirm banners. No exceptions.
5. **Icon-only buttons carry an `aria-label`.**
6. **Never render a raw enum.** Map it to a label.
7. **Every setting sits in a `SettingsRow`.** Bare buttons and divs are not
   direct Section children — only sub-section blocks, status text and dialogs.

## Save / Cancel placement

One rule, no exceptions:

```tsx
<div
  style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}
>
  <Button size="2" variant="soft" color="gray" onClick={onCancel}>
    Cancel
  </Button>
  <Button size="2" disabled={!isValid} onClick={onSubmit}>{submitLabel}</Button>
</div>;
```

**The one exception: a branch choice.** When a step offers two ways forward and
neither cancels — the welcome step's `Full Setup` / `Demo Mode` — the buttons
are `size="3"`, left-aligned, `gap: 16`, in the order the copy below explains
them. The test is that no button backs out; if one does, it is a footer and the
rule above applies.

Cancel is `variant="soft" color="gray"`. Primary is solid (no `variant`), and
`color="red"` when the action is destructive. `ScheduleDialog.module.css`
`.footer` is the same spec (`flex-end`, `gap: 8px`) and is exported through
`hostUi` as `dialogStyles` — dialog components use the class, Settings panels
use the inline equivalent, because Settings does not otherwise carry CSS
Modules.

## The shell

Every panel is a `SettingsSection` (a re-export of `ui/Section.tsx`). Nothing
renders outside one.

```
Settings.tsx           flex column, gap 24, one <SettingsSection> per concern
  └─ Section           <Card> → .wrapper (flex column, gap 16)
       ├─ .header      icon · title · [badge] · [saved/saving badge] · .action
       ├─ description  Text size="2" color="gray"
       └─ .body        flex column, gap 12   ← all children land here
```

`SectionProps`: `icon`, `title`, `badge?`, `description`, `action?`,
`saveStatus?`, `isDirty?`, `onSave?`, `children`.

- **`action`** is the top-right slot (`.action` is `margin-left: auto`). The
  header Save button renders _after_ it in the same flex row.
- **Save is owned by the Section header.** When `isDirty && onSave`, Section
  renders `<Button size="1" variant="solid">` with `<Save size={12}/>`. Panels
  do not draw their own header Save.
- **Card state is visual feedback:** `.dirtyCard` = 2px amber ring, `.savedCard`
  = green flash animation, `.errorCard` = red ring. Free, driven entirely by
  `saveStatus`/`isDirty`.

## Rows

`SettingsRow` (`SettingsLayout.tsx`) is label-left / control-right: `flex`,
`justify-content: space-between`, `gap: 16`, `min-height: 36`. Label is
`Text size="2"`; `help` is `Text size="1" color="gray"` below it. Control sits
in a `flex-shrink: 0` box.

Use it for **every** setting. A bare `<Button>` or `<div>` as a direct Section
child breaks the rhythm — the only legitimate direct children are sub-section
blocks (below), status text, and dialogs.

## Sub-sections inside a panel

When a panel has more than one concern, it separates with a divider div, never a
nested Card:

```tsx
<div
  style={{
    marginTop: 4,
    paddingTop: 12,
    borderTop: "1px solid var(--gray-a4)",
  }}
>
  <Text size="2" weight="bold">Tariff Periods</Text>
  <Text size="1" color="gray" style={{ display: "block", marginTop: 2 }}>
    …
  </Text>
  …
</div>;
```

Seen in `TariffPeriodsSection`, `PresetTemplates`, `VehicleSettings`
(`SimulatedVehicleSection`, `UnconfiguredPluginCard`), `SolarTrackingSettings`
(Advanced). `marginTop` is 4 or 12, `paddingTop` 12 or 16 — not standardised.

## Lists of entities — the canonical pattern

`TariffPeriodsSection` is the reference implementation. Chargers, vehicles and
tariff periods are the same shape: a list you add to, edit and delete from.

**Header row for the list:**

```tsx
<div
  style={{
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  }}
>
  <Text size="2" weight="bold">Tariff Periods</Text>
  <Button size="1" variant="soft" onClick={onStartAdd}>
    <Plus size={14} /> Add Period
  </Button>
</div>;
```

**The row** (`PeriodRow`) — never a `SettingsRow`, it's its own shape:

```tsx
<div
  style={{
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 10px",
    borderRadius: 6,
    background: "var(--gray-a2)",
    opacity: enabled ? 1 : 0.5,
  }}
>
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      flex: 1,
      flexWrap: "wrap",
    }}
  >
    <Text size="2" weight="bold" style={{ minWidth: 90 }}>{label}</Text>
    <Badge variant="outline" size="1">
      <Clock size={10} /> …
    </Badge>
    <Badge variant="outline" size="1" color="gray">…</Badge>
    <Badge color="blue" variant="soft" size="1">…</Badge>
  </div>
  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
    <IconButton variant="ghost" size="1">
      <Pencil size={14} />
    </IconButton>
    <IconButton variant="ghost" color="red" size="1">
      <Trash2 size={14} />
    </IconButton>
  </div>
</div>;
```

Rows are stacked in `flex column, gap 6`. Disabled rows use `opacity: 0.5`.

**Editing expands beneath the row. There is no edit modal.**

Wrap the row and its editor in one grey band so an open entity reads as a single
expanded block rather than two stacked things — see
`ChargersSection.ChargerListItem`:

```tsx
<div style={{ borderRadius: 6, background: "var(--gray-a2)" }}>
  <ChargerRow … expanded={expanded} onEdit={toggle} />
  {expanded && <ChargerEditForm … submitLabel="Save" />}
</div>
```

The row itself carries no background when nested this way — the wrapper owns it
— and the edit action flips from `Pencil` to `X` with its `aria-label` changing
from `Edit {name}` to `Close {name}`.

`TariffPeriodsSection` still replaces the row rather than expanding
(`editingId === period.id` swaps `PeriodRow` for `PeriodForm`). That predates
this rule; new lists expand.

**The add form is the same component**, rendered below the list with
`submitLabel="Add …"`. One form component serves both.

**The form block** (`PeriodForm`):

```tsx
<div
  style={{
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 12,
    borderRadius: 6,
    background: "var(--gray-a2)",
    border: "1px solid var(--gray-a5)",
  }}
>
  … fields …
  {error && <Text size="2" color="red">{error}</Text>}
  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
    <Button size="2" disabled={!isValid}>Update</Button>
    <Button size="2" variant="soft">Cancel</Button>
  </div>
</div>;
```

Note the form has **its own Save/Cancel**, not the Section header Save. Submit
is disabled until locally valid.

## Row actions — Edit / Delete

**Buttons in a row action group are never butted together. `gap: 8`. Always.**
Both precedents use it: `TariffPeriodsSection` actions div (`gap: 8`) and
`ScheduleCard.module.css` `.actions` (`gap: 8px`). Anything tighter reads as one
control.

Three implementations exist and they disagree. Pick by context:

**1. Icon-only, soft — `ScheduleCard`** (the default for a card/row of an
entity, and what most closely matches current design):

```tsx
<div className={styles.actions}>
  {/* flex, align center, gap 8, flex-shrink 0 */}
  <IconButton
    variant="soft"
    size="1"
    aria-label="Edit schedule"
    onClick={() => onEdit(schedule)}
  >
    <Pencil size={14} />
  </IconButton>
  <IconButton
    variant="soft"
    color="red"
    size="1"
    aria-label="Delete schedule"
    onClick={() => onDelete(schedule.id)}
  >
    <Trash2 size={14} />
  </IconButton>
</div>;
```

`aria-label` is required — an icon-only button has no accessible name otherwise.
`ScheduleCard` has them; `TariffPeriodsSection` does not, which is a bug rather
than a style.

**2. Icon-only, ghost — `TariffPeriodsSection`.** Identical structure with
`variant="ghost"`. Lower emphasis, for rows inside an already-busy panel.

**3. Labelled toggle — `SimulatedVehicleSettings`.** For an editor that expands
in place rather than replacing the row:

```tsx
<Button variant="soft" size="1" onClick={() => toggleExpanded(v.id)}>
  <Pencil size={12} />
  {isExpanded ? "Close" : "Edit"}
</Button>;
```

Note the label flips to "Close" while open, and the icon drops to `size={12}`
because it sits beside text.

## Editing an entity — two shapes, both inline

**Never a modal.** See Dialogs below.

**A. Replace the row** — `TariffPeriodsSection`. `editingId === row.id` swaps
`PeriodRow` for `PeriodForm`. Best when the editor is roughly row-sized and only
one can be open.

**B. Expand beneath the row** — `SimulatedVehicleSettings`. The row stays; the
editor renders under it in a `<div style={{ marginTop: 4 }}>`. Multiple can be
open at once (`expanded` is a `Set<string>`). Best when the row carries live
state you want to keep visible while editing.

Row shape for B:

```tsx
<div
  style={{
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 10px",
    borderBottom: "1px solid var(--gray-a3)",
    borderRadius: 6,
  }}
>
  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
    <Text size="2" weight="bold">{name}</Text>
    <Badge size="1" variant="soft" color="gray">…live state…</Badge>
  </div>
  <Button variant="soft" size="1">…</Button>
</div>;
```

The expanded editor is a `<Card>` with its own footer:

```tsx
<div className={styles.footer}>
  <Button type="button" variant="soft" color="gray" onClick={onCancel}>
    Cancel
  </Button>
  <Button type="submit" disabled={saving}>
    {saving ? "Saving..." : "Save"}
  </Button>
</div>;
```

Cancel first, submit second. Submit is `size="2"` default solid, no variant.

## Launching the wizard from Settings

**Only for flows that genuinely need more than one page** — Tesla onboarding
(key generation, hosting, credentials, partner registration, authorization,
vehicle selection, virtual key pairing). Anything that fits on one form is
configured **in place** in the settings panel.

`InverterSettings.needsOnboarding` encodes the test: a plugin needs the wizard
only when it is unconfigured, **has no inline settings component**, and has
wizard steps. If a plugin ships a settings component, use it inline.

## Dialogs

`Dialog` appears exactly twice in the whole Settings page, both **destructive
confirmations**, never for editing:

- `AuthSettings.NoneWarningDialog` — "Remove Authentication?" with
  `<Button variant="soft" color="gray">Cancel</Button>` and
  `<Button color="red">Remove Authentication</Button>`, in
  `<Flex gap="2" mt="4" justify="end">` (gap 8, like every other footer),
  `maxWidth="450px"`.

Non-destructive confirmation is done **inline**, not in a dialog —
`PresetTemplates` renders an orange banner (`background: var(--orange-a2)`,
`border: 1px solid var(--orange-a5)`, `padding: "8px 12px"`, `borderRadius: 6`)
with `Replace` / `Cancel` buttons in the flow.

**Rule: dialogs confirm, they never edit.**

## Button vocabulary

| Use                           | Spec                                                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Add to a list                 | `Button size="1" variant="soft"` + `<Plus size={14}/>`                                                                                  |
| Row edit / delete (icon only) | `IconButton variant="soft" size="1"` (+ `color="red"`) with `Pencil`/`Trash2` `size={14}`, `aria-label` required, `gap: 8` between them |
| Row edit (expands in place)   | `Button variant="soft" size="1"` + `<Pencil size={12}/>` + label toggling `Edit`/`Close`                                                |
| Form submit                   | `Button size="2"` (solid default), `disabled` until valid                                                                               |
| Form cancel                   | `Button size="2" variant="soft"` (or `variant="soft" color="gray"`)                                                                     |
| Section header Save           | drawn by `Section` — `size="1" variant="solid"` + `<Save size={12}/>`                                                                   |
| Section `action` toggle       | `Button size="1" variant={on ? "solid" : "soft"}` (SolarTracking "Simulate")                                                            |
| Selectable / toggle chips     | `Button size="1" variant={selected ? "solid" : "outline"}` (DaySelector, PresetTemplates)                                               |
| Destructive confirm           | `Button size="1" color="red"` inline, or `color="red"` in a dialog                                                                      |
| Inline clear                  | `Button size="1" variant="ghost" color="red"` + `<Trash2 size={12}/>`                                                                   |
| Standalone secondary action   | `Button size="2" variant="soft"` with `alignSelf: "flex-start"`                                                                         |
| Advanced disclosure           | `Button size="1" variant="ghost"` + `ChevronDown`/`ChevronRight size={14}`                                                              |

## Icons

All from `lucide-react`. Sizes are positional, not semantic:

| Context                  | Size                                          |
| ------------------------ | --------------------------------------------- |
| Section header icon      | `18` (`Bell` is `16` — the one inconsistency) |
| Button icon              | `14`                                          |
| Section-header Save icon | `12`                                          |
| IconButton (row action)  | `14`                                          |
| Badge icon               | `10`–`12`                                     |
| Inline link icon         | `11`                                          |

Section icons in use: `Zap` (Charging Control, My Equipment), `Car` (Vehicles),
`Plug` (Chargers), `Sun` (Solar Tracking), `DollarSign` (Tariffs), `Battery`,
`Server` (System), `MapPin` (Home Location), `Bell` (Notifications), `Shield`
(Authentication), `Key` (encryption warning).

## Badges

| Meaning             | Spec                                                                       |
| ------------------- | -------------------------------------------------------------------------- |
| Neutral metadata    | `Badge variant="outline" size="1"` (+ `color="gray"`)                      |
| Emphasised value    | `Badge color="blue" variant="soft" size="1"`                               |
| Positive / detected | `Badge color="green" variant="soft" size="1"` + `<CheckCircle size={12}/>` |
| Negative / absent   | `Badge color="gray" variant="soft" size="1"`                               |
| Section-level flag  | Section `badge` prop → `variant="outline" color="orange" size="1"`         |

## Save models

Three, in descending frequency:

1. **`useDraftConfig` + Section header Save** — the default. Buffers edits
   locally, `isDirty`/`save`/`saveStatus` go straight to the Section. Used by
   Solar Tracking, Battery, System, Notifications, My Equipment, Charging
   Control.
2. **Local state + own scoped Save** — for a sub-block with its own lifecycle.
   `CurrencyConfig` renders `Button size="2" variant="soft"` _only when dirty_.
   Auth forms use `FormButtons` (submit + cancel).
3. **Immediate mutation, no Save** — for discrete actions: delete a vehicle,
   add/update/delete a tariff period, set home location. Feedback comes from
   `saveStatus` on the Section (Home Location passes `saveStatus` with no
   `onSave`).

**Plugin settings compose into model 1** via `PluginSettingsHostProvider`.
`PluginConfigForm` renders fields but **no Save button** — it reports
`{isDirty, save, saveStatus}` up through the context and the host panel merges
it (`InverterSettings.useCombinedSaveState`). A plugin panel rendered without a
provider cannot be saved.

## Empty, error and hint states

- Empty list: `Text size="2" color="gray"` — "No tariff periods configured. Add
  one or load a preset above."
- Load failure: `Text size="2" color="gray"` with a recovery hint.
- Mutation or validation error inside a form:
  **`<FormError message={error} />`** (`components/ui/FormError.tsx`). Never a
  bare `Text color="red"` — colour alone is not a state, and it announces
  nothing. `size="1"` by default; `size="2"` on a wizard step or the login form,
  where the surrounding copy is size 2. A null message renders nothing, so call
  sites drop `{error && …}`.
- Action-needed hint: `Text size="1" color="orange"` — "Select your inverter or
  smart meter to start monitoring energy."
- Panel-level error banner:
  `<Card style={{ borderLeft: "3px solid var(--red-9)" }}>` above the Section
  (`VehicleSettings`), orange for warnings (`Settings.EncryptionWarning`).

## Advanced disclosure

One implementation, in `SolarTrackingSettings`:

```tsx
<div style={{ marginTop:16, paddingTop:16, borderTop:"1px solid var(--gray-a4)" }}>
  <Button size="1" variant="ghost" onClick={() => setShowAdvanced(v => !v)}>
    {showAdvanced ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
    Advanced
  </Button>
</div>
{showAdvanced && <AdvancedRows … />}
```

Rows appear _after_ the toggle, not nested inside it.

## Colour and spacing tokens

| Token                                   | Use                                          |
| --------------------------------------- | -------------------------------------------- |
| `var(--gray-a2)`                        | row / form-block background                  |
| `var(--gray-a3)`                        | row separator border, hover background       |
| `var(--gray-a4)`                        | sub-section divider border                   |
| `var(--gray-a5)`                        | form-block border                            |
| `var(--red-a2)` / `var(--red-a5)`       | error block bg / border                      |
| `var(--orange-a2)` / `var(--orange-a5)` | confirm block bg / border                    |
| `var(--green-a3)`                       | recently-added row highlight (fades over 1s) |

Spacing: page 24 · section wrapper 16 · section body 12 · row group 6–10 ·
inline controls 6–8 · row padding `8px 10px` · form padding 12 · radius 6.

## Styling mechanics

Inline `style={{}}` is the house pattern throughout — `SettingsLayout` itself
uses it. CSS Modules are used **only** for the `Section` shell
(`Section.module.css`) because it needs keyframe animations. Do not introduce a
`.module.css` per panel; it would be the only one.

## Composition conventions

- Panels over ~150 lines split into named sub-components in the _same file_
  (`SolarMainRows`, `SolarThresholdRows`, `SolarHardwareRows`, `AdvancedRows`).
- Heavy state extracts to a hook: `useVehicleSettings`, `useTariffState`,
  `useTariffMutations`, `useTariffHandlers`, `useDraftConfig`.
- Types derive from the router, never hand-copied:
  `type TariffPeriod = RouterOutputs["tariff"]["list"]["periods"][number]`.
- Enum values are never rendered raw — map to labels (`MODE_LABELS` in
  `AuthSettings`, `PROVIDER_DISPLAY_NAMES` in `NotificationSettings`,
  `formatDays` in `tariffUtils`).
- Plugin components render through `<ErrorBoundary label="Plugin Settings">`.
