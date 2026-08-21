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
import type { RunAggregates, RunJournalEntry } from './run-journal';
import { COPY } from './copy';
import { GenerationClientError } from './transport-shared';
import { appColor } from '../../sdk/theme';

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
  /** The rewrite endpoint's prompt — what generation is asked to build, UNLESS `edited` is true
   *  (`promptForBuild` is the one place that decides between this and the rows). Empty while
   *  loading. */
  rewritten: string;
  rows: readonly FlowPlanRow[];
  /** The rewrite request is still in flight: the rows are genuinely coming and their shape is
   *  known, which is the only state a skeleton may stand in for. */
  loading: boolean;
  /** Set the moment any row is edited inline on this step, and never cleared. Flips
   *  `promptForBuild` from trusting `rewritten` to assembling the prompt from `rows` instead —
   *  the two are independent strings the rewrite endpoint returns together, so once a row has
   *  been hand-edited only the rows still reflect what the user approved
   *  (`prompt-flow` spec "Editing a plan piece"). */
  edited: boolean;
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
    edited: false,
  };
}

/** The rewrite response arrived: the rows replace the skeleton and `Build it` goes live. */
export function withPlan(
  screen: PlanScreen,
  response: Pick<RewriteResponse, 'rewrittenPrompt' | 'plan'>,
): PlanScreen {
  return { ...screen, rewritten: response.rewrittenPrompt, rows: planRowsFrom(response), loading: false };
}

/** Inline-editing one plan row, in place on the plan step: every other row, the original prompt
 *  and the clarify answers are carried through untouched. `index` is the row's position — rows
 *  are a stable, never-reordered array, so an index survives duplicate row text where the
 *  `label:text` string the UI otherwise keys off of would collide. */
export function updatePlanRow(screen: PlanScreen, index: number, text: string): PlanScreen {
  const rows = screen.rows.map((row, i) => (i === index ? { ...row, text } : row));
  return { ...screen, rows, edited: true };
}

/**
 * The prompt generation is actually asked to build. `rewritten` and `rows` are two independent
 * strings the rewrite endpoint returns together — not one derived from the other — so once the
 * user has hand-edited a row inline, only the rows still reflect what they approved and
 * `rewritten` is stale. Unedited, this is byte-identical to `screen.rewritten` (the common case,
 * and the only case before this function existed). Edited, it assembles one line per row —
 * `label: text` when the row has a label, the bare text otherwise — joined with newlines; the
 * single-row fallback (`planRowsFrom`) collapses to exactly that row's text, which is the
 * lossless case.
 */
export function promptForBuild(screen: PlanScreen): string {
  if (!screen.edited) return screen.rewritten;
  return screen.rows.map((row) => (row.label.length > 0 ? `${row.label}: ${row.text}` : row.text)).join('\n');
}

/** The build step. Generation starts here and nowhere earlier. */
export function buildStep(prev: PlanScreen): BuildScreen {
  return {
    kind: 'build',
    ...(prev.editing ? { editing: prev.editing } : {}),
    text: prev.text,
    rewritten: promptForBuild(prev),
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

const ACTIVE_STEP_CREDIT = 0.5;

/**
 * How full the build screen's progress bar reads, 0..1. Each passed step is a full quarter and the
 * live one a half quarter, so the bar reads 12.5 / 37.5 / 62.5 / 87.5 and NEVER fabricates 100%
 * before the done screen replaces it. It is derived from the same stage events the named steps are,
 * with no timer smoothing it to look busier — a bar that moves on its own would be reporting
 * progress that did not happen (ruling R21).
 *
 * There is always exactly one live step — `activeBuildStepIndex` returns an index inside the list
 * for every input, delivery included — so the half-quarter is unconditional and 1.0 is unreachable
 * by construction, not by a check that could be dropped.
 */
export function buildProgressFraction(stage: Stage | null, delivering = false): number {
  const passed = buildStepStatuses(stage, delivering).filter((s) => s === 'passed').length;
  return (passed + ACTIVE_STEP_CREDIT) / BUILD_STEPS.length;
}

/** The one plain-words sentence describing what is happening right now, in the user's terms. */
export function currentActionSentence(stage: Stage | null, delivering = false): string {
  return BUILD_STEPS[activeBuildStepIndex(stage, delivering)];
}

/** A pending-build ghost tile's working title (`pending-builds` design D2): the first ~28 chars
 *  of the prompt, truncated at the nearest word boundary at or before the limit so a word is
 *  never cut mid-way. Internal whitespace runs collapse to a single space; a prompt already at or
 *  under the limit passes through untouched (trimmed). Pure, computed once at record creation. */
const WORKING_TITLE_MAX_CHARS = 28;

export function workingTitleFromPrompt(text: string): string {
  const collapsed = text.trim().replace(/\s+/g, ' ');
  if (collapsed.length <= WORKING_TITLE_MAX_CHARS) return collapsed;
  const cut = collapsed.slice(0, WORKING_TITLE_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  return lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
}

// ── Derived run signals (generation-observability design D6) ────────────────────────────────────
// Elapsed time, the output counter and the heartbeat are DERIVED in memory from the request's own
// start timestamp and the same cumulative counts the journal throttles into entries — they are
// never separately persisted, and they never read the journal back. All four helpers below are
// pure so the build screen's liveness signals are Node-testable without a clock or a render.

/** Cumulative output counts before any token has arrived. */
export const EMPTY_RUN_AGGREGATES: RunAggregates = { chars: 0, tokens: 0 };

/**
 * Fold one stream event into the running totals. Only a `token` event moves them: `chars` by the
 * token's character count, `tokens` by one. The token's TEXT is counted and discarded — it is
 * never carried in the returned value, which is what keeps the derived counter inside the
 * no-internals rule. Any other event returns `prev` unchanged (same reference, so a React state
 * setter sees no spurious change).
 */
export function accumulateRunAggregates(prev: RunAggregates, event: GenerationEvent): RunAggregates {
  if (event.type !== 'token') return prev;
  return { chars: prev.chars + event.text.length, tokens: prev.tokens + 1 };
}

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

/**
 * Elapsed wall time as a plain `m:ss` clock (`0:07`, `1:05`, `12:30`) — a timer display, not a
 * progress claim. A `now` before `startedAt` (clock skew, or a value read before the first tick)
 * reads as `0:00` rather than a negative.
 */
export function elapsedLabel(startedAt: number, now: number): string {
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / MS_PER_SECOND));
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** How long the stream may go without a `token` or `stage` event before the screen says so
 *  (`prompt-flow` spec, "A stall heartbeat visibly reports when the stream goes quiet"). Wholly
 *  independent of the journal's own aggregate write throttle (design D6). */
export const HEARTBEAT_QUIET_MS = 8_000;

/**
 * Whole seconds the stream has been quiet, or `null` when it has not been quiet long enough to
 * report — which is the "show no quiet indication" case, including the instant a fresh event
 * arrives and resets `lastArrivalAt`. The threshold must be EXCEEDED, so exactly
 * `HEARTBEAT_QUIET_MS` still reads as healthy.
 */
export function quietSecondsSince(lastArrivalAt: number, now: number): number | null {
  const quietMs = now - lastArrivalAt;
  if (quietMs <= HEARTBEAT_QUIET_MS) return null;
  return Math.floor(quietMs / MS_PER_SECOND);
}

/** One stage transition as the timeline renders it. `durationMs` is `null` for a stage that never
 *  ended — the attempt was still in it when the journal stops. */
export interface StageDuration {
  stage: Stage;
  durationMs: number | null;
}

/**
 * A journal's `stage` entries as consecutive-transition durations (design D7): each stage lasts
 * until the next stage entry, and the last one lasts until the terminal entry if there is one.
 * Entries of any other kind are ignored — the journal is a mixed log, and the timeline's spine is
 * the stage transitions alone. Out-of-order timestamps clamp to `0` rather than reporting a
 * negative duration.
 */
export function stageDurations(journal: readonly RunJournalEntry[]): StageDuration[] {
  const stages = journal.filter((e): e is RunJournalEntry & { stage: Stage } => e.kind === 'stage' && e.stage != null);
  const terminal = journal.find((e) => e.kind === 'terminal');
  return stages.map((entry, i) => {
    const endsAt = i + 1 < stages.length ? stages[i + 1].t : terminal?.t;
    return {
      stage: entry.stage,
      durationMs: endsAt == null ? null : Math.max(0, endsAt - entry.t),
    };
  });
}

/** A ghost tile's colour (`pending-builds` design D6): a deterministic hash of the launcher id
 *  onto the SAME palette every installed tile resolves through (`tiles.ts#tileColor`'s fallback,
 *  `../../sdk/theme#appColor`) — never a second palette. `appColor` is itself already a pure
 *  string->hue hash, so this is a direct reuse with the launcher id as the hashed input instead of
 *  the app name. */
export function ghostTileColorFor(id: string): string {
  return appColor(id);
}
