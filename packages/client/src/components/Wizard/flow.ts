import type { ReactNode } from "react";
import type { WizardNavState } from "@chargeha/shared";

/** Navigation handed to every step by the wizard shell. Skip is not here: the
 *  shell owns that button and no step drives it. */
export interface StepProps {
  onNext: () => void;
  onBack: () => void;
  /** Jump to a step by id. Steps are addressed by id everywhere — a position
   *  means something different depending on which plugins are selected. */
  onSkipTo: (id: string) => void;
  onSkipToEnd: () => void;
}

/** Runs when Next is clicked. Resolve to advance; throw to stay on the step —
 *  the thrown message is shown to the user as the reason, so it must read as
 *  one ("Could not reach the inverter"), not as an internal error. */
export type WizardNextHandler = () => Promise<void>;

/** What a step's Next button is. */
export type WizardNext =
  /** No Next button — the step completes via its own CTA (e.g. Done). */
  | { kind: "hidden" }
  /** Disabled with no hint yet. A hint that flips to ready milliseconds after
   *  mount reads as a flash in the nav, so steps say "loading" instead. */
  | { kind: "loading" }
  /** Disabled, with the reason it isn't ready. */
  | { kind: "blocked"; reason: string }
  /** Enabled. onNext runs on click; the step advances if it resolves.
   *  `hint` says what Next will do; null is a deliberate "nothing to say", not
   *  an oversight — the step has to decide. */
  | { kind: "ready"; hint: string | null; onNext: WizardNextHandler };

/** For a step whose Next does nothing but move on — says so out loud, rather
 *  than leaving it to be inferred from an absent handler. */
export const advanceOnly: WizardNextHandler = () => Promise.resolve();

export interface StepBehaviour {
  next: WizardNext;
  view: ReactNode;
}

/** Where a shell's step state lives. The setup wizard persists to the DB; a
 *  plugin's own onboarding run persists to localStorage. */
export interface WizardStore {
  state: WizardNavState;
  patch: (next: Partial<WizardNavState>) => void;
  isLoading: boolean;
}

/**
 * A step, as its author writes it. `useStep` owns the step's state and
 * declares both what Next does and what to render, so a step cannot be
 * rendered without its Next behaviour coming along.
 */
export interface PluginStepDef {
  /** Unique string identifier for this step (persisted to the database). */
  id: string;
  label: string;
  useStep: (props: StepProps) => StepBehaviour;
}

/**
 * A step as the flow holds it. Order is this def's position in its flow array;
 * presence is `owner`. Nothing here names another step, so adding, removing or
 * reordering a step is an edit to one array and nothing else.
 */
export interface StepDef extends PluginStepDef {
  /** The plugin whose selection this step belongs to (e.g. "tesla"). Injected
   *  from the registry key — plugin authors never set it. Absent for core
   *  steps, which are always in the list.
   *
   *  One fact, two jobs: the step is in the list only while its owner is the
   *  selected type, and Skip abandons every step sharing an owner as a block
   *  rather than stepping through a plugin's setup one screen at a time. */
  owner?: string;
}

/** Whether a plugin's steps are in play, i.e. its type is the selected one. */
function isOwnerSelected(owner: string, state: WizardNavState): boolean {
  return state.vehicleType === owner || state.energyType === owner;
}

/** The steps the given selections put in the list, in flow order. */
export function activeSteps(flow: StepDef[], state: WizardNavState): StepDef[] {
  return flow.filter((step) =>
    !step.owner || isOwnerSelected(step.owner, state)
  );
}

/**
 * Resolve the current step's index within the active list.
 *
 * A stored id can name a step the current selections don't include — a resumed
 * wizard whose plugin steps are gone, or a stale/hand-edited id. Falling back
 * to 0 would silently restart setup, so land on the first step the selections
 * do include at or after where the id used to sit.
 */
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

/**
 * The id of the step following `state.stepId`, computed against the list the
 * given state produces. Returns null at the end of the flow.
 *
 * Pass the state a selection is moving to, not the current one: choosing a
 * vehicle type both changes the list and decides what comes next, and both
 * fall out of the same call.
 */
export function nextStepId(
  flow: StepDef[],
  state: WizardNavState,
): string | null {
  const active = activeSteps(flow, state);
  const index = resolveStepIndex(flow, state);
  return active[index + 1]?.id ?? null;
}

/**
 * The id of the step Back lands on, or null on the first step.
 *
 * A plugin's steps are one block from the outside and individual steps from
 * within: stepping back inside Tesla setup moves one screen, but stepping back
 * from after it returns to the choice that led in — not to the last screen of
 * a block the user just skipped past.
 */
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

/**
 * The id of the step Skip lands on, or null when there is nowhere left to go.
 *
 * A plugin's steps are a chain — credentials feed registration, which feeds
 * auth — so skipping any one of them abandons the whole block rather than
 * dropping the user on a later step that needs what was just skipped. Null
 * means the block ran to the end of the flow and the caller should leave the
 * wizard instead.
 */
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
