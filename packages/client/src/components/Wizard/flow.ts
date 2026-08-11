import type { ReactNode } from "react";
import type { WizardNavState } from "@chargeha/shared";

// One mover, not two: when the step and the shell both moved, the second
// recomputed the next step from state that predated the first and silently
// overwrote it.
export type WizardAdvance = (selection?: Partial<WizardNavState>) => void;

// Skip is not here: the shell owns that button and no step drives it.
export interface StepProps {
  // A selection can change which steps exist, so the destination is a fact
  // about the flow under the *new* selection. Called with no argument, this
  // is plain "next".
  onAdvance: WizardAdvance;
  onBack: () => void;
  // Steps are addressed by id everywhere — a position means something
  // different depending on which plugins are selected.
  onSkipTo: (id: string) => void;
  onSkipToEnd: () => void;
  // Not persisted — a reload between the setup step's save and a later step
  // in the same run loses it (see the wizard shell).
  chargerId: string | null;
  // So later steps in the same run (e.g. a verify step) can address the
  // same row.
  setChargerId: (id: string) => void;
}

// Resolve to advance; throw to stay on the step — the thrown message is
// shown to the user as the reason, so it must read as one, not as an
// internal error.
export type WizardNextHandler = () => Promise<Partial<WizardNavState> | void>;

export type WizardNext =
  // No Next button — the step completes via its own CTA (e.g. Done).
  | { kind: "hidden" }
  // A hint that flips to ready milliseconds after mount reads as a flash
  // in the nav, so steps say "loading" instead.
  | { kind: "loading" }
  | { kind: "blocked"; reason: string }
  // `hint` says what Next will do; null is a deliberate "nothing to say",
  // not an oversight.
  | { kind: "ready"; hint: string | null; onNext: WizardNextHandler };

// Says so out loud, rather than leaving it to be inferred from an absent
// handler.
export const advanceOnly: WizardNextHandler = () => Promise.resolve();

export interface StepBehaviour {
  next: WizardNext;
  view: ReactNode;
}

// The setup wizard persists to the DB; a plugin's own onboarding run
// persists to localStorage.
export interface WizardStore {
  state: WizardNavState;
  patch: (next: Partial<WizardNavState>) => void;
  isLoading: boolean;
}

export interface PluginStepDef {
  // Persisted to the database.
  id: string;
  label: string;
  useStep: (props: StepProps) => StepBehaviour;
}

// Order is this def's position in its flow array; presence is `owner`.
// Nothing here names another step, so adding, removing or reordering a
// step is an edit to one array and nothing else.
export interface StepDef extends PluginStepDef {
  // Injected from the registry key — plugin authors never set it. Absent
  // for core steps, which are always in the list. Also controls Skip:
  // it abandons every step sharing an owner as a block.
  owner?: string;
  // Core steps only: present when this returns true (default: always).
  presentWhen?: (state: WizardNavState) => boolean;
}

function isOwnerSelected(owner: string, state: WizardNavState): boolean {
  return state.vehicleType === owner ||
    state.energyType === owner ||
    state.chargerType === owner;
}

export function activeSteps(flow: StepDef[], state: WizardNavState): StepDef[] {
  return flow.filter((step) =>
    (!step.owner || isOwnerSelected(step.owner, state)) &&
    (step.presentWhen?.(state) ?? true)
  );
}

// A stored id can name a step the current selections don't include (resumed
// wizard, stale/hand-edited id). Falling back to 0 would silently restart
// setup, so land on the first included step at or after where it used to sit.
export function resolveStepIndex(
  flow: StepDef[],
  state: WizardNavState,
): number {
  const active = activeSteps(flow, state);
  const index = active.findIndex((step) => step.id === state.stepId);
  if (index >= 0) return index;

  const flowIndex = flow.findIndex((step) => step.id === state.stepId);
  if (flowIndex < 0) return 0;
  const recovered = active.findIndex((step) => flow.indexOf(step) >= flowIndex);
  return recovered >= 0 ? recovered : Math.max(0, active.length - 1);
}

// Pass the state a selection is moving to, not the current one: choosing a
// vehicle type both changes the list and decides what comes next, and both
// fall out of the same call.
export function nextStepId(
  flow: StepDef[],
  state: WizardNavState,
): string | null {
  const active = activeSteps(flow, state);
  const index = resolveStepIndex(flow, state);
  return active[index + 1]?.id ?? null;
}

// A plugin's steps are one block from the outside: stepping back from after
// it returns to the choice that led in, not to the last screen of a block
// the user just skipped past.
export function backTargetId(
  flow: StepDef[],
  state: WizardNavState,
): string | null {
  const active = activeSteps(flow, state);
  const index = resolveStepIndex(flow, state);
  if (index <= 0) return null;

  const previous = active[index - 1];
  if (!previous.owner || previous.owner === active[index]?.owner) {
    return previous.id;
  }

  // The previous step opens onto a block we are outside of. Land before it.
  const before = active
    .slice(0, index)
    .findLast((step) => step.owner !== previous.owner);
  return before?.id ?? active[0].id;
}

// A plugin's steps are a chain, so skipping any one abandons the whole
// block rather than dropping the user on a step that needs what was
// skipped. Null means the block ran to the end; the caller should exit.
export function skipTargetId(
  flow: StepDef[],
  state: WizardNavState,
): string | null {
  const active = activeSteps(flow, state);
  const index = resolveStepIndex(flow, state);
  const owner = active[index]?.owner;
  if (!owner) return active[index + 1]?.id ?? null;

  return active.find((step, i) => i > index && step.owner !== owner)?.id ??
    null;
}
