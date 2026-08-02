/**
 * prompt-flow — the pure five-step machine behind screen `2a` (shell-redesign-v2, group D;
 * `prompt-flow` spec "The prompt flow is a five-step machine — compose, clarify, plan, build,
 * done").
 *
 * `compose → clarify → plan → build → done`. Forward moves are gated by the primary action and
 * carry a request; backward moves are immediate and lossless. This module holds the DECISIONS —
 * which step comes next, what a back press means, which label the primary action shows, what the
 * build screen's four steps read as — with no I/O and no React, so the machine is directly
 * Node-testable (the same split `back-policy.ts` and `history-logic.ts` already use).
 * `LauncherRoot.tsx` owns the requests and holds one of these screens as its state.
 *
 * `@whim/contract` is a TYPE-ONLY import: importing the zod schema VALUES would pull zod into the
 * Metro bundle graph (the discipline `generation-client.ts` documents).
 */

import type { Clarification, ClarifyQuestion, GenerationEvent, PlanRow, RewriteResponse } from '@whim/contract';
import type { InstalledApp } from './app-index';
import { COPY } from './copy';
import { GenerationClientError } from './transport-shared';

/** The `stage` event's `stage` field (`GenerationEvent` is a discriminated union). */
export type Stage = Extract<GenerationEvent, { type: 'stage' }>['stage'];

/** At most three questions reach the user — the wire caps this too, but a device that renders a
 *  fourth would be showing something the design never sized for. */
export const MAX_CLARIFY_QUESTIONS = 3;

export type FlowStep = 'compose' | 'clarify' | 'plan' | 'build' | 'done';

/** One clarifying question as the screen renders it: single-select pills over `options`. */
export interface FlowQuestion {
  id: string;
  question: string;
  options: readonly string[];
}

/** Answers by question id. A question the user skipped simply has no entry. */
export type FlowAnswers = Readonly<Record<string, string>>;

/** One labelled plan row. `label` is empty for the single-row fallback, which renders unlabelled
 *  (the wire carried a rewritten string and no structured breakdown). */
export interface FlowPlanRow {
  label: string;
  text: string;
}

export interface ComposeScreen {
  kind: 'compose';
  editing?: InstalledApp;
  /** The user's own words, verbatim — never live-lexed while it is being typed. */
  text: string;
}

export interface ClarifyScreen {
  kind: 'clarify';
  editing?: InstalledApp;
  text: string;
  questions: readonly FlowQuestion[];
  answers: FlowAnswers;
}

export interface PlanScreen {
  kind: 'plan';
  editing?: InstalledApp;
  text: string;
  /** Carried so a back press can rebuild the clarify step it came from, answers intact. Empty
   *  when the clarify step was skipped — a back press then lands on compose. */
  questions: readonly FlowQuestion[];
  answers: FlowAnswers;
  /** The rewrite endpoint's prompt — what generation is asked to build. Empty while loading. */
  rewritten: string;
  rows: readonly FlowPlanRow[];
  /** The rewrite request is still in flight: the rows are genuinely coming and their shape is
   *  known, which is the only state a skeleton may stand in for. */
  loading: boolean;
}

export interface BuildScreen {
  kind: 'build';
  editing?: InstalledApp;
  /** The user's verbatim prompt, tracked into the delivered snapshot's envelope. */
  text: string;
  /** The prompt generation is running against. */
  rewritten: string;
  answers: FlowAnswers;
  questions: readonly FlowQuestion[];
  stage: Stage | null;
  /** The stream produced its record and delivery is running — the last named step. */
  delivering: boolean;
}

export interface DoneScreen {
  kind: 'done';
  editing?: InstalledApp;
  /** The delivered app, whose own tile and colour this step shows. */
  app: InstalledApp;
}

export type FlowScreen = ComposeScreen | ClarifyScreen | PlanScreen | BuildScreen | DoneScreen;

/** The compose step, optionally scoped to an app being re-prompted and optionally prefilled. */
export function composeStep(editing?: InstalledApp, text = ''): ComposeScreen {
  return { kind: 'compose', ...(editing ? { editing } : {}), text };
}

/**
 * The questions the clarify step will render: capped at three, and with anything unpickable
 * dropped (a question with no options is not a question). A server that answers with none leaves
 * an empty list, which is what makes the step skippable rather than empty.
 */
export function acceptClarifyQuestions(questions: readonly ClarifyQuestion[] | undefined): FlowQuestion[] {
  if (!questions) return [];
  return questions
    .filter((q) => q.options.length > 0)
    .slice(0, MAX_CLARIFY_QUESTIONS)
    .map((q) => ({ id: q.id, question: q.question, options: q.options }));
}

/** Zero questions is the one "nothing to ask" signal: the flow goes straight to the plan step and
 *  the clarify step is never shown (`prompt-flow` "No questions skips the step"). */
export function stepAfterClarifyExchange(questions: readonly FlowQuestion[]): 'clarify' | 'plan' {
  return questions.length > 0 ? 'clarify' : 'plan';
}

/**
 * A clarify `502` means the clarifier is unconfigured or the model answered unusably — the wire
 * contract's own instruction is to treat it as "skip to the plan step", never a dead end. Every
 * other failure is a real failure.
 */
export function isClarifySkip(err: unknown): boolean {
  return err instanceof GenerationClientError && err.status === 502;
}

/** The clarify step, carrying the user's own words forward to echo. */
export function clarifyStep(prev: ComposeScreen, questions: readonly FlowQuestion[]): ClarifyScreen {
  return { kind: 'clarify', ...(prev.editing ? { editing: prev.editing } : {}), text: prev.text, questions, answers: {} };
}

/** Single-select: tapping an option only ever SETS that question's answer, never clears it. */
export function withAnswer(screen: ClarifyScreen, questionId: string, answer: string): ClarifyScreen {
  return { ...screen, answers: { ...screen.answers, [questionId]: answer } };
}

/** The answers as the wire carries them — by value, only for questions actually answered.
 *  An empty result and an absent field mean the same thing: the user answered nothing. */
export function clarificationsFrom(
  questions: readonly FlowQuestion[],
  answers: FlowAnswers,
): Clarification[] {
  const out: Clarification[] = [];
  for (const q of questions) {
    const answer = answers[q.id];
    if (typeof answer === 'string' && answer.length > 0) {
      out.push({ id: q.id, question: q.question, answer });
    }
  }
  return out;
}

/**
 * The plan's rows. Structured rows render one row per entry with its label; a response carrying
 * none renders the rewritten prompt as a single unlabelled row, still approvable.
 */
export function planRowsFrom(response: Pick<RewriteResponse, 'rewrittenPrompt' | 'plan'>): FlowPlanRow[] {
  const plan: readonly PlanRow[] | undefined = response.plan;
  if (plan && plan.length > 0) {
    return plan.map((row) => ({ label: row.label, text: row.text }));
  }
  return [{ label: '', text: response.rewrittenPrompt }];
}

/**
 * The plan step — the approval gate — while its rows are still being fetched. The step opens on
 * the primary action of the step before it and shows skeleton rows until `withPlan` fills them;
 * its own primary action stays busy meanwhile, so a forward move is still gated by plain words.
 */
export function planStep(prev: ComposeScreen | ClarifyScreen): PlanScreen {
  return {
    kind: 'plan',
    ...(prev.editing ? { editing: prev.editing } : {}),
    text: prev.text,
    questions: prev.kind === 'clarify' ? prev.questions : [],
    answers: prev.kind === 'clarify' ? prev.answers : {},
    rewritten: '',
    rows: [],
    loading: true,
  };
}

/** The rewrite response arrived: the rows replace the skeleton and `Build it` goes live. */
export function withPlan(
  screen: PlanScreen,
  response: Pick<RewriteResponse, 'rewrittenPrompt' | 'plan'>,
): PlanScreen {
  return { ...screen, rewritten: response.rewrittenPrompt, rows: planRowsFrom(response), loading: false };
}

/** Tapping a plan row re-opens the composer prefilled with that row's text — nothing fancier. */
export function reopenCompose(screen: PlanScreen, row: FlowPlanRow): ComposeScreen {
  return composeStep(screen.editing, row.text);
}

/** The build step. Generation starts here and nowhere earlier. */
export function buildStep(prev: PlanScreen): BuildScreen {
  return {
    kind: 'build',
    ...(prev.editing ? { editing: prev.editing } : {}),
    text: prev.text,
    rewritten: prev.rewritten,
    answers: prev.answers,
    questions: prev.questions,
    stage: null,
    delivering: false,
  };
}

/** A `stage` event — the ONLY event that ever reaches this screen's state. */
export function withStage(screen: BuildScreen, stage: Stage): BuildScreen {
  return { ...screen, stage };
}

/** The stream produced its record; the last named step is now the live one. */
export function withDelivering(screen: BuildScreen): BuildScreen {
  return { ...screen, delivering: true };
}

/** The done step, showing the delivered app. */
export function doneStep(prev: BuildScreen, app: InstalledApp): DoneScreen {
  return { kind: 'done', ...(prev.editing ? { editing: prev.editing } : {}), app };
}

/**
 * Backward movement, immediate and lossless: plan → the clarify step it came from (or compose,
 * when clarify was skipped), clarify → compose with the text intact, compose → home. The build
 * and done steps have no back move of their own — the shell binds their own actions instead.
 */
export function backFrom(screen: FlowScreen): FlowScreen | 'home' | null {
  switch (screen.kind) {
    case 'compose':
      return 'home';
    case 'clarify':
      return composeStep(screen.editing, screen.text);
    case 'plan':
      return screen.questions.length > 0
        ? {
            kind: 'clarify',
            ...(screen.editing ? { editing: screen.editing } : {}),
            text: screen.text,
            questions: screen.questions,
            answers: screen.answers,
          }
        : composeStep(screen.editing, screen.text);
    default:
      return null;
  }
}

/** The primary action's label: plain words always, never a bare spinner. */
export function primaryActionLabel(step: FlowStep, busy: boolean): string {
  if (busy) return COPY.flowBusy;
  return step === 'plan' ? COPY.planBuild : COPY.flowContinue;
}

/** The four named build steps, in order — derived from `stage` events, never from raw tokens. */
export const BUILD_STEPS: readonly string[] = [
  COPY.buildStepReading,
  COPY.buildStepWriting,
  COPY.buildStepChecking,
  COPY.buildStepInstalling,
];

export type BuildStepStatus = 'passed' | 'active' | 'todo';

/** Which named step each generation stage belongs to. `check`, `run` and `repair` are all the one
 *  user-visible "checking it runs safely" step — the repair ladder is not exposed as its own. */
const STAGE_STEP_INDEX: Record<Stage, number> = {
  plan: 0,
  generate: 1,
  check: 2,
  run: 2,
  repair: 2,
};

/** The live index: delivery is the last step; an unstarted stream sits on the first. */
export function activeBuildStepIndex(stage: Stage | null, delivering: boolean): number {
  if (delivering) return BUILD_STEPS.length - 1;
  return stage == null ? 0 : STAGE_STEP_INDEX[stage];
}

/** Not-started / in-progress / passed for each named step. Passed steps stay passed. */
export function buildStepStatuses(stage: Stage | null, delivering = false): BuildStepStatus[] {
  const active = activeBuildStepIndex(stage, delivering);
  return BUILD_STEPS.map((_, i) => {
    if (i < active) return 'passed';
    return i === active ? 'active' : 'todo';
  });
}

/** The one plain-words sentence describing what is happening right now, in the user's terms. */
export function currentActionSentence(stage: Stage | null, delivering = false): string {
  return BUILD_STEPS[activeBuildStepIndex(stage, delivering)];
}
