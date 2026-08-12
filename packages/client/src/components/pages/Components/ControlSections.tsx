import { useState } from "react";
import {
  Badge,
  Button,
  IconButton,
  Select,
  Skeleton,
  Switch,
  Text,
  TextField,
} from "@radix-ui/themes";
import {
  Bell,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader,
  Menu,
  Pencil,
  Plus,
  Save,
  Shapes,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { DayOfWeek } from "@chargeha/shared";
import { Spinner } from "../../ui/Spinner.tsx";
import { WaitingBars } from "../../ui/WaitingBars.tsx";
import { DayPicker } from "../../DayPicker/DayPicker.tsx";
import { TimePicker } from "../../TimePicker/TimePicker.tsx";
import { NumberInput } from "../Settings/SettingsLayout.tsx";
import {
  GallerySection,
  Rule,
  Specimen,
  SpecimenRow,
  StackedSpecimen,
} from "./Specimen.tsx";
import styles from "./Components.module.css";

export function ButtonSection() {
  const [chip, setChip] = useState(true);
  const [advanced, setAdvanced] = useState(false);
  return (
    <GallerySection
      id="buttons"
      icon={<Shapes size={18} />}
      title="Buttons"
      description="The full vocabulary. Pick by job, not by looks — every row here is already load-bearing somewhere in the app."
    >
      <Rule>
        Cancel is always left and soft-gray; the primary is always right and
        solid. Groups get gap 8 — never butted together.
      </Rule>
      <SpecimenRow>
        <Specimen label='Add to a list — size="1" variant="soft" + Plus 14'>
          <Button size="1" variant="soft">
            <Plus size={14} /> Add Period
          </Button>
        </Specimen>
        <Specimen label='Form submit — size="2" solid, disabled until valid'>
          <Button size="2">Save</Button>
          <Button size="2" disabled>Save</Button>
        </Specimen>
        <Specimen label='Form cancel — size="2" variant="soft" color="gray"'>
          <Button size="2" variant="soft" color="gray">Cancel</Button>
        </Specimen>
      </SpecimenRow>
      <SpecimenRow>
        <Specimen label='Section header Save — size="1" solid + Save 12'>
          <Button size="1" variant="solid">
            <Save size={12} /> Save
          </Button>
        </Specimen>
        <Specimen label='Row edit in place — size="1" soft + Pencil 12'>
          <Button variant="soft" size="1">
            <Pencil size={12} /> Edit
          </Button>
          <Button variant="soft" size="1">
            <Pencil size={12} /> Close
          </Button>
        </Specimen>
        <Specimen label='Destructive confirm — size="1" color="red"'>
          <Button size="1" color="red">Remove Authentication</Button>
        </Specimen>
      </SpecimenRow>
      <SpecimenRow>
        <Specimen label="Selectable chip — solid when selected, outline when not (DaySelector)">
          <Button
            size="1"
            variant={chip ? "solid" : "outline"}
            onClick={() => setChip(!chip)}
          >
            Weekdays
          </Button>
          <Button size="1" variant="outline">Weekends</Button>
        </Specimen>
        <Specimen label="Selectable chip — solid / soft, the denser variant (SolarSimulation)">
          <Button size="1" variant="solid" style={{ minWidth: 38 }}>M</Button>
          <Button size="1" variant="soft" style={{ minWidth: 38 }}>T</Button>
          <Button size="1" variant="soft" style={{ minWidth: 38 }}>W</Button>
        </Specimen>
        <Specimen label='Inline clear — size="1" variant="ghost" color="red" + Trash2 12'>
          <Button size="1" variant="ghost" color="red">
            <Trash2 size={12} /> Clear
          </Button>
        </Specimen>
        <Specimen label='Section action toggle — variant={on ? "solid" : "soft"}'>
          <Button size="1" variant="solid">Simulate</Button>
          <Button size="1" variant="soft">Simulate</Button>
        </Specimen>
      </SpecimenRow>
      <SpecimenRow>
        <Specimen label='Standalone secondary — size="2" soft, alignSelf flex-start'>
          <Button size="2" variant="soft" style={{ alignSelf: "flex-start" }}>
            Change Password
          </Button>
        </Specimen>
        <Specimen label='Advanced disclosure — size="1" variant="ghost" + chevron 14'>
          <Button
            size="1"
            variant="ghost"
            onClick={() => setAdvanced((v) => !v)}
          >
            {advanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Advanced
          </Button>
        </Specimen>
      </SpecimenRow>
      <StackedSpecimen label="Footer — flex-end, gap 8. Cancel left, primary right.">
        <div className={styles.formFooter}>
          <Button size="2" variant="soft" color="gray">Cancel</Button>
          <Button size="2">Save</Button>
        </div>
      </StackedSpecimen>
    </GallerySection>
  );
}

export function IconButtonSection() {
  return (
    <GallerySection
      id="icon-buttons"
      icon={<Pencil size={18} />}
      title="Icon buttons"
      description="Icon-only controls for entity rows. An aria-label is mandatory — there is no other accessible name."
    >
      <Rule>
        Soft is the default for a card or entity row. Ghost is for rows inside
        an already-busy panel. Edit flips to X while its editor is open.
      </Rule>
      <SpecimenRow>
        <Specimen label='soft, size="1" — the default row pair (gap 8)'>
          <div className={styles.entityRowActions}>
            <IconButton variant="soft" size="1" aria-label="Edit schedule">
              <Pencil size={14} />
            </IconButton>
            <IconButton
              variant="soft"
              color="red"
              size="1"
              aria-label="Delete schedule"
            >
              <Trash2 size={14} />
            </IconButton>
          </div>
        </Specimen>
        <Specimen label='ghost, size="1" — lower emphasis'>
          <div className={styles.entityRowActions}>
            <IconButton variant="ghost" size="1" aria-label="Edit period">
              <Pencil size={14} />
            </IconButton>
            <IconButton
              variant="ghost"
              color="red"
              size="1"
              aria-label="Delete period"
            >
              <Trash2 size={14} />
            </IconButton>
          </div>
        </Specimen>
        <Specimen label="expanded — Pencil becomes X, label becomes Close">
          <IconButton variant="ghost" size="1" aria-label="Close Garage OCPP">
            <X size={14} />
          </IconButton>
        </Specimen>
      </SpecimenRow>
      <Specimen label='size="2" ghost — the only size-2 in the app, the mobile menu button'>
        <IconButton
          size="2"
          variant="ghost"
          color="gray"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </IconButton>
      </Specimen>
    </GallerySection>
  );
}

export function BadgeSection() {
  return (
    <GallerySection
      id="badges"
      icon={<Bell size={18} />}
      title="Badges"
      description="Colour is the meaning, not decoration. Never render a raw enum into one — map it to a label first."
    >
      <SpecimenRow>
        <Specimen label='Neutral metadata — variant="outline" size="1"'>
          <Badge variant="outline" size="1">Auto</Badge>
          <Badge variant="outline" size="1" color="gray">ocpp</Badge>
          <Badge variant="outline" size="1">
            <Clock size={10} /> 23:00 – 05:30
          </Badge>
        </Specimen>
        <Specimen label='Emphasised value — color="blue" variant="soft" size="1"'>
          <Badge color="blue" variant="soft" size="1">$0.28 / kWh</Badge>
        </Specimen>
      </SpecimenRow>
      <SpecimenRow>
        <Specimen label='Positive / detected — color="green" variant="soft"'>
          <Badge color="green" variant="soft" size="1">
            <CheckCircle size={12} /> Detected
          </Badge>
        </Specimen>
        <Specimen label='Negative / absent — color="gray" variant="soft"'>
          <Badge color="gray" variant="soft" size="1">Not configured</Badge>
        </Specimen>
        <Specimen label='Fault — color="red" variant="soft"'>
          <Badge color="red" variant="soft" size="1">Fault</Badge>
        </Specimen>
        <Specimen label='In progress — color="amber" variant="soft"'>
          <Badge color="amber" variant="soft" size="1">Preparing</Badge>
        </Specimen>
      </SpecimenRow>
      <Specimen label="Section-level flag — Section badge prop → outline / orange">
        <Badge variant="outline" color="orange" size="1">Setup needed</Badge>
      </Specimen>
    </GallerySection>
  );
}

const ICON_SIZES: { size: number; use: string }[] = [
  { size: 18, use: "section header" },
  { size: 16, use: "banner, mobile nav" },
  { size: 14, use: "button, icon button" },
  { size: 12, use: "header Save, inline edit" },
  { size: 11, use: "inline link" },
  { size: 10, use: "badge" },
];

export function IconSection() {
  return (
    <GallerySection
      id="icons"
      icon={<Sparkles size={18} />}
      title="Icons"
      description="lucide-react only. Sizes are positional — the context picks the number, not the meaning."
    >
      <div className={styles.scaleList}>
        {ICON_SIZES.map(({ size, use }) => (
          <div key={size} className={styles.scaleRow}>
            <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Pencil size={size} />
              <Trash2 size={size} />
              <Plus size={size} />
              <Save size={size} />
            </span>
            <div>
              <span className={styles.scaleSpec}>size={"{"}{size}{"}"}</span>
              <span className={styles.scaleUse}>{use}</span>
            </div>
          </div>
        ))}
      </div>
    </GallerySection>
  );
}

export function InputSection() {
  const [text, setText] = useState("Garage OCPP");
  const [amps, setAmps] = useState("16");
  const [mode, setMode] = useState("auto");
  const [on, setOn] = useState(true);
  const [time, setTime] = useState("23:00");
  const [days, setDays] = useState<DayOfWeek[]>(["mon", "tue", "wed"]);
  return (
    <GallerySection
      id="inputs"
      icon={<Pencil size={18} />}
      title="Inputs"
      description="Radix form controls at size 2 in settings rows and forms, size 1 wherever the control sits inside a row or a table filter. Plus the pickers the app owns."
    >
      <SpecimenRow>
        <Specimen label='TextField.Root size="2"'>
          <TextField.Root
            size="2"
            value={text}
            onChange={(e) => setText(e.target.value)}
            style={{ width: 180 }}
          />
        </Specimen>
        <Specimen label="NumberInput — value + unit suffix">
          <NumberInput value={amps} onChange={setAmps} suffix="A" min={5} />
        </Specimen>
        <Specimen label='Select.Root size="2" — a settings row or form field'>
          <Select.Root size="2" value={mode} onValueChange={setMode}>
            <Select.Trigger aria-label="Charging mode" />
            <Select.Content>
              <Select.Item value="auto">Auto</Select.Item>
              <Select.Item value="charge_now">Charge now</Select.Item>
              <Select.Item value="stop">Stop</Select.Item>
            </Select.Content>
          </Select.Root>
        </Specimen>
        <Specimen label='Select.Root size="1" — inside an entity row or a table filter'>
          <Select.Root size="1" value={mode} onValueChange={setMode}>
            <Select.Trigger aria-label="Charging mode, dense" />
            <Select.Content>
              <Select.Item value="auto">Auto</Select.Item>
              <Select.Item value="charge_now">Charge now</Select.Item>
              <Select.Item value="stop">Stop</Select.Item>
            </Select.Content>
          </Select.Root>
        </Specimen>
        <Specimen label="Switch — boolean setting, no Save needed">
          <Switch checked={on} onCheckedChange={setOn} />
        </Specimen>
      </SpecimenRow>
      <SpecimenRow>
        <Specimen label="TimePicker — HH:MM, 15-minute steps">
          <TimePicker value={time} onChange={setTime} />
        </Specimen>
      </SpecimenRow>
      <StackedSpecimen label="DayPicker — day toggles plus presets">
        <DayPicker value={days} onChange={setDays} />
      </StackedSpecimen>
    </GallerySection>
  );
}

export function LoaderSection() {
  return (
    <GallerySection
      id="loaders"
      icon={<Loader size={18} />}
      title="Loaders"
      description="Skeletons where the shape is known, a spinner where it is not, WaitingBars where the wait has no pace. Two spinner sizes: default inside controls, lg for a full-page wait."
    >
      <SpecimenRow>
        <Specimen label="Spinner — one size, no prop. A command is running and we expect it back.">
          <Spinner />
        </Specimen>
        <Specimen label="WaitingBars — a wait we do not control and cannot pace">
          <WaitingBars />
        </Specimen>
        <Specimen label='WaitingBars size="lg" — a wait that owns the screen'>
          <WaitingBars size="lg" />
        </Specimen>
      </SpecimenRow>

      <Rule>
        Three shapes cover every current use: appended after a button's label
        while its command runs, swapped in for the button's icon, or standing in
        for data that has not arrived.
      </Rule>

      <SpecimenRow>
        <Specimen label="Before the label — vehicle and charger mode buttons">
          <Button size="1" variant="solid" color="green">
            <Spinner /> CHARGE NOW
          </Button>
        </Specimen>
        <Specimen label="Replacing the icon — device search, plugin settings">
          <Button size="2" variant="soft">
            <Spinner /> Search
          </Button>
        </Specimen>
        <Specimen label="Standing in for absent data — a charger that has not reported yet">
          <WaitingBars />
        </Specimen>
      </SpecimenRow>

      <SpecimenRow>
        <Specimen label="Beside its explanation — OCPP waiting for a charger to call in">
          <WaitingBars />
          <Text size="1" color="gray">Waiting for a charger to connect</Text>
        </Specimen>
      </SpecimenRow>
      <Rule>
        A spinner means "working". WaitingBars means "waiting on something
        outside our control" — use it when there is nothing to count down.
      </Rule>

      <StackedSpecimen label="Skeleton — only where the final size is known">
        <Rule>
          Two in the whole app: the metric value, and the vehicle card's charge
          block. Both are fixed-size, so the skeleton does not resize when the
          data lands.
        </Rule>
        <Skeleton width="80px" height="32px" />
        <Skeleton width="100%" height="180px" />
      </StackedSpecimen>
    </GallerySection>
  );
}
