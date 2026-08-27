import { useState } from "react";
import { Button, Card, Text } from "@radix-ui/themes";
import {
  Activity,
  Bell,
  Calendar,
  Car,
  CreditCard,
  Home,
  Plug,
  Sun,
  Wand2,
  Zap,
} from "lucide-react";
import { MetricCard } from "../../MetricCard/MetricCard.tsx";
import { ScheduleCard } from "../../ScheduleCard/ScheduleCard.tsx";
import { VehicleCard } from "../../VehicleCard/VehicleCard.tsx";
import { ChargerCard } from "../Dashboard/ChargerCard.tsx";
import { EnergyFlowDiagram } from "../../EnergyFlowDiagram/EnergyFlowDiagram.tsx";
import { ConnectionBadge } from "../../ConnectionBadge/ConnectionBadge.tsx";
import { StepIndicator } from "../../Wizard/StepIndicator.tsx";
import { StepHost } from "../../Wizard/StepHost.tsx";
import { advanceOnly } from "../../Wizard/flow.ts";
import type { StepBehaviour, StepProps } from "../../Wizard/flow.ts";
import { OptionCard } from "../../Wizard/steps/OptionCard.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { ErrorBanner } from "../../ui/ErrorBanner.tsx";
import { useToast } from "../../../hooks/useToast.tsx";
import {
  GallerySection,
  Rule,
  Specimen,
  SpecimenRow,
  StackedSpecimen,
} from "./Specimen.tsx";
import {
  blockoutSchedule,
  chargerCardState,
  chargeSchedule,
  energy,
  idleVehicleState,
  vehicleState,
} from "./fixtures.ts";
import styles from "./Components.module.css";

const noop = () => {};

export function MetricCardSection() {
  return (
    <GallerySection
      id="metric-cards"
      icon={<CreditCard size={18} />}
      title="Metric cards"
      description="One number, one meaning. The accent comes from the energy token for that quantity — never a fresh colour."
    >
      <div className={styles.grid}>
        <MetricCard
          icon={<Sun size={20} />}
          label="Solar"
          value="6.42 kW"
          accentColor="var(--color-solar)"
          subtitle="Peak today 7.9 kW"
        />
        <MetricCard
          icon={<Home size={20} />}
          label="Home"
          value="1.24 kW"
          accentColor="var(--color-home)"
        />
        <MetricCard
          icon={<Zap size={20} />}
          label="Grid"
          value="Exporting"
          accentColor="var(--color-grid-export)"
          smallValue
          subtitle="1.18 kW"
        />
        <MetricCard
          icon={<Activity size={20} />}
          label="Loading"
          value=""
          accentColor="var(--color-charging)"
          loading
        />
      </div>
      <Rule>
        smallValue drops the value to size 3 — use it whenever the value is a
        word rather than a number, so text and figures do not fight.
      </Rule>
    </GallerySection>
  );
}

export function ScheduleCardSection() {
  return (
    <GallerySection
      id="schedule-cards"
      icon={<Calendar size={18} />}
      title="Schedule cards"
      description="Charge and blockout share one card; the accent stripe separates them. Disabled cards dim rather than disappear."
    >
      <StackedSpecimen label="charge · enabled">
        <ScheduleCard
          schedule={chargeSchedule}
          onToggle={noop}
          onEdit={noop}
          onDelete={noop}
        />
      </StackedSpecimen>
      <StackedSpecimen label="blockout · disabled">
        <ScheduleCard
          schedule={blockoutSchedule}
          onToggle={noop}
          onEdit={noop}
          onDelete={noop}
        />
      </StackedSpecimen>
    </GallerySection>
  );
}

export function ChargerCardSection() {
  return (
    <GallerySection
      id="charger-cards"
      icon={<Plug size={18} />}
      title="Charger cards"
      description="A charging point's own card. It sits beside the car it resolved to — a smart charger and its vehicle read as a pair, not as two unrelated cards."
    >
      <StackedSpecimen label="charging · smart charger with a linked vehicle">
        <ChargerCard
          id="chg-1"
          name="Garage OCPP"
          mode="auto"
          state={chargerCardState}
          solarW={3800}
          gridW={0}
          controllerDetail={null}
          vehicleResolution="linked"
          resolvedVehicleName="Model 3"
          allocationStatus="Charging on surplus solar"
        />
      </StackedSpecimen>
      <StackedSpecimen label="ambiguous — several cars plugged in, none assigned">
        <ChargerCard
          id="chg-2"
          name="Driveway"
          mode="charge_now"
          state={{
            ...chargerCardState,
            status: "preparing",
            isCharging: false,
          }}
          solarW={0}
          gridW={0}
          controllerDetail={null}
          vehicleResolution="ambiguous"
          resolvedVehicleName={null}
        />
      </StackedSpecimen>
      <StackedSpecimen label="passive — a self-driving car owns the session, so no mode buttons">
        <ChargerCard
          id="chg-3"
          name="Garage OCPP"
          mode="auto"
          state={chargerCardState}
          solarW={3800}
          gridW={0}
          controllerDetail={null}
          vehicleResolution="linked"
          resolvedVehicleName="Model 3"
          controlOwner="vehicle_api"
          passiveForVehicleName="Model 3"
        />
      </StackedSpecimen>
      <StackedSpecimen label="faulted">
        <ChargerCard
          id="chg-4"
          name="Driveway"
          mode="stop"
          state={{ ...chargerCardState, status: "faulted", isCharging: false }}
          solarW={0}
          gridW={0}
          controllerDetail="Adapter reported a fault"
          vehicleResolution="none"
          resolvedVehicleName={null}
        />
      </StackedSpecimen>
      <StackedSpecimen label="unreachable + recovery">
        <ChargerCard
          id="chg-5"
          name="Driveway"
          mode="auto"
          state={{
            ...chargerCardState,
            status: "unreachable",
            statusDetail: "disconnected",
            isCharging: false,
          }}
          solarW={0}
          gridW={0}
          controllerDetail={null}
          vehicleResolution="none"
          resolvedVehicleName={null}
          supportsRecovery
        />
      </StackedSpecimen>
    </GallerySection>
  );
}

export function VehicleCardSection() {
  return (
    <GallerySection
      id="vehicle-cards"
      icon={<Car size={18} />}
      title="Vehicle cards"
      description="The densest component in the app: header, status, controls and charge detail in one card."
    >
      <StackedSpecimen label="charging · full controls">
        <VehicleCard
          name="Model 3"
          state={vehicleState}
          priority={1}
          mode="auto"
          commandPending={false}
          onStartCharging={noop}
          onStopCharging={noop}
          onSetAmps={noop}
          onChangeMode={noop}
          solarPowerW={6420}
          gridPowerW={-1180}
          atHome
          allocationStatus="Charging on surplus solar"
        />
      </StackedSpecimen>
      <StackedSpecimen label="unplugged · away · commands disabled">
        <VehicleCard
          name="Ioniq 5"
          state={idleVehicleState}
          priority={2}
          mode="stop"
          commandPending={false}
          onStartCharging={noop}
          onStopCharging={noop}
          onSetAmps={noop}
          onChangeMode={noop}
          atHome={false}
          commandsDisabled
          commandsDisabledReason="Vehicle is away from home."
        />
      </StackedSpecimen>
      <StackedSpecimen label="read-only · paired with a smart charger">
        <VehicleCard
          name="Model 3"
          state={vehicleState}
          priority={1}
          mode="auto"
          commandPending={false}
          onStartCharging={noop}
          onStopCharging={noop}
          onSetAmps={noop}
          onChangeMode={noop}
          readOnly
          chargingPoint={{ name: "Garage OCPP" }}
        />
      </StackedSpecimen>
    </GallerySection>
  );
}

export function EnergyFlowSection() {
  return (
    <GallerySection
      id="energy-flow"
      icon={<Zap size={18} />}
      title="Energy flow"
      description="The dashboard centrepiece. Dot speed tracks power, so a big flow visibly moves faster."
    >
      <EnergyFlowDiagram
        data={energy}
        chargingVehicles={[
          {
            id: "5YJ3E1EA7KF000001",
            name: "Model 3",
            chargePowerW: 3800,
            solarW: 3800,
            gridW: 0,
          },
        ]}
      />
      <StackedSpecimen label="loading">
        <EnergyFlowDiagram data={null} loading />
      </StackedSpecimen>
    </GallerySection>
  );
}

const WIZARD_STEPS = [
  "Welcome",
  "Inverter",
  "Vehicle",
  "Charger",
  "Tariff",
  "Done",
];

/** Drives the real StepHost, so this footer cannot drift from the wizard. */
function useDemoStep(): StepBehaviour {
  return {
    next: { kind: "ready", hint: null, onNext: advanceOnly },
    view: (
      <Text size="2" color="gray">
        Pick the car you want ChargeHA to control. You can add more later.
      </Text>
    ),
  };
}

function useBlockedStep(): StepBehaviour {
  return {
    next: { kind: "blocked", reason: "Select a vehicle to continue." },
    view: (
      <Text size="2" color="gray">
        Pick the car you want ChargeHA to control. You can add more later.
      </Text>
    ),
  };
}

const DEMO_STEP_PROPS: StepProps = {
  onAdvance: noop,
  onBack: noop,
  onSkipTo: noop,
  onSkipToEnd: noop,
  chargerId: null,
  setChargerId: noop,
};

function DemoStepHost(
  { useStep, isFirstStep = false, isLastStep = false }: {
    useStep: () => StepBehaviour;
    isFirstStep?: boolean;
    isLastStep?: boolean;
  },
) {
  return (
    <Card>
      <StepHost
        def={{ id: "demo", label: "Vehicle", useStep }}
        stepProps={DEMO_STEP_PROPS}
        nav={{
          isFirstStep,
          isLastStep,
          canBack: !isFirstStep,
          onBack: noop,
          onSkip: noop,
        }}
        onAdvance={noop}
      />
    </Card>
  );
}

export function WizardSection() {
  const [step, setStep] = useState(2);
  const [picked, setPicked] = useState("solar");
  return (
    <GallerySection
      id="wizard-steps"
      icon={<Wand2 size={18} />}
      title="Wizard"
      description="Dots for progress, then the step body, then a footer the shell owns. A step never draws its own navigation — it declares what Next is and StepHost renders it."
    >
      <StackedSpecimen label="StepIndicator — completed · active · pending">
        <StepIndicator
          total={WIZARD_STEPS.length}
          current={step}
          labels={WIZARD_STEPS}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            size="1"
            variant="soft"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            Previous dot
          </Button>
          <Button
            size="1"
            variant="soft"
            onClick={() =>
              setStep((s) => Math.min(WIZARD_STEPS.length - 1, s + 1))}
          >
            Next dot
          </Button>
        </div>
      </StackedSpecimen>

      <StackedSpecimen label="OptionCard — the large icon + title + description choice">
        <Rule>
          The only big rectangular button in the app, and only on a wizard
          selection step. Selected draws the accent border; disabled drops to
          0.5 opacity and stops taking focus.
        </Rule>
        <div className={styles.grid}>
          <OptionCard
            icon={<Sun size={20} />}
            title="Solar inverter"
            description="Read production directly from the inverter on your network."
            selected={picked === "solar"}
            onSelect={() => setPicked("solar")}
          />
          <OptionCard
            icon={<Zap size={20} />}
            title="Smart meter"
            description="Read whole-home import and export from the meter."
            selected={picked === "meter"}
            onSelect={() => setPicked("meter")}
          />
          <OptionCard
            icon={<Car size={20} />}
            title="Not available yet"
            description="Disabled cards stay visible so the option is discoverable."
            disabled
            onSelect={noop}
          />
        </div>
      </StackedSpecimen>

      <StackedSpecimen label="StepHost footer — Back · Skip · Next, rendered by the real component">
        <Rule>
          Back is soft with ArrowLeft, and reads "Cancel" on the first step.
          Skip is ghost, and is not rendered on the last step. Next is solid
          with ArrowRight, reads "Finish" on the last step and "Saving..." while
          its handler runs.
        </Rule>
        <DemoStepHost useStep={useDemoStep} />
      </StackedSpecimen>

      <StackedSpecimen label="First step — Back becomes Cancel">
        <DemoStepHost useStep={useDemoStep} isFirstStep />
      </StackedSpecimen>

      <StackedSpecimen label="Last step — Next becomes Finish, Skip disappears">
        <DemoStepHost useStep={useDemoStep} isLastStep />
      </StackedSpecimen>

      <StackedSpecimen label="Blocked — Next disabled, the reason sits above the nav">
        <Rule>
          The hint row is right-aligned above the buttons. A step says why Next
          cannot be pressed rather than leaving a dead button unexplained.
        </Rule>
        <DemoStepHost useStep={useBlockedStep} />
      </StackedSpecimen>
    </GallerySection>
  );
}

export function FeedbackSection() {
  const { addToast } = useToast();
  return (
    <GallerySection
      id="feedback"
      icon={<Bell size={18} />}
      title="Empty, error & transient states"
      description="Empty states offer the next action. Toasts report what already happened — they never ask a question."
    >
      <StackedSpecimen label="EmptyState — icon 20, message. The action slot exists but no caller uses it.">
        <EmptyState
          icon={<Car size={28} />}
          message="No vehicles configured yet."
          action={<Button size="2" variant="soft">Add a vehicle</Button>}
        />
      </StackedSpecimen>
      <StackedSpecimen label="ErrorBanner — title, description. The children slot carries an instruction list where one is needed.">
        <ErrorBanner
          title="Inverter unreachable"
          description="Last successful poll was 14 minutes ago. Charging is paused until readings resume."
        />
      </StackedSpecimen>
      <SpecimenRow>
        <Specimen label="Toasts — success 3s · info 4s · error 6s">
          <Button
            size="1"
            variant="soft"
            onClick={() => addToast("Settings saved", "success")}
          >
            Success
          </Button>
          <Button
            size="1"
            variant="soft"
            onClick={() => addToast("Reconnecting to the inverter", "info")}
          >
            Info
          </Button>
          <Button
            size="1"
            variant="soft"
            color="red"
            onClick={() => addToast("Could not reach the charger", "error")}
          >
            Error
          </Button>
        </Specimen>
        <Specimen label="ConnectionBadge — reflects the live SSE store">
          <ConnectionBadge />
        </Specimen>
      </SpecimenRow>
    </GallerySection>
  );
}
