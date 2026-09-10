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
  /** The clarify exchange is still in flight: the step opens under this loading state the moment
   *  compose's primary action is tapped, so the wait is the clarify screen itself, never a grey
   *  compose button (`prompt-flow` "the clarify wait is a screen"). `withQuestions` clears it. */
  loading: boolean;
  /** When this clarify exchange started — `WorkingLine`'s clock reads from here (C3), never from
   *  a render or mount moment, so it survives a re-render untouched. Set once by `clarifyStep`;
   *  meaningless (and never read) once `loading` is false, so `backFrom`'s reconstruction of an
   *  already-answered clarify step omits it. */
  startedAt?: number;
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
  /** When the rewrite request started — `WorkingLine`'s clock reads from here (C3). Set once by
   *  `planStep`; meaningless (and never read) once `loading` is false. */
  startedAt?: number;
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

/**
 * The clarify step opens the moment compose's primary action is tapped, carrying the user's own
 * words forward to echo — UNDER LOADING, before the clarify exchange has even been asked
 * (`prompt-flow` "the clarify wait is the clarify screen loading"). `withQuestions` is what fills
 * it in once the response lands; zero questions never reaches this screen at all
 * (`stepAfterClarifyExchange` sends that case straight to `planStep`).
 */
export function clarifyStep(prev: ComposeScreen): ClarifyScreen {
  return {
    kind: 'clarify',
    ...(prev.editing ? { editing: prev.editing } : {}),
    text: prev.text,
    questions: [],
    answers: {},
    loading: true,
    startedAt: Date.now(),
  };
}

/** The clarify exchange answered: the skeleton is replaced by the real questions and the step
 *  goes live. Everything else about the screen — the echoed prompt, any answers already given —
 *  is carried through untouched. */
export function withQuestions(screen: ClarifyScreen, questions: readonly FlowQuestion[]): ClarifyScreen {
  return { ...screen, questions, loading: false };
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
    startedAt: Date.now(),
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
            // A clarify step reached by going BACK already has its questions answered (or was
            // skipped past) — never the loading state a forward move into it opens under.
            loading: false,
          }
        : composeStep(screen.editing, screen.text);
    default:
      return null;
  }
}

/** The primary action's label: plain words always, and the SAME words whether or not the step is
 *  busy — a busy action only softens (`PrimaryAction`'s own opacity/disabled state), it never
 *  relabels to a "One moment" placeholder (`prompt-flow` "the clarify wait is a screen, not a
 *  grey button"). `editing` swaps the plan step's label to the edit flow's own words; every other
 *  step's label is unbranched. */
export function primaryActionLabel(step: FlowStep, editing: boolean): string {
  if (step !== 'plan') return COPY.flowContinue;
  return editing ? COPY.planBuildEdit : COPY.planBuild;
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

// ── Derived run signals (generation-observability design D6; build-liveness B1) ─────────────────
// Elapsed time, the output counters and the liveness verdict are DERIVED in memory from the
// request's own start timestamp and the same cumulative counts the journal throttles into entries
// — they are never separately persisted, and they never read the journal back. Every helper below
// is pure so the build screen's liveness signals are Node-testable without a clock or a render.

/** Cumulative output counts before any token has arrived. */
export const EMPTY_RUN_AGGREGATES: RunAggregates = { chars: 0, tokens: 0 };

/**
 * Everything the build screen's liveness signals are derived FROM, held in memory for the life of
 * one attempt and never read back out of the journal (design D6): the moment the attempt started,
 * the cumulative counts folded from its stream, and three separate arrival clocks (build-liveness
 * B1) — because "quiet" used to mean one thing (no `token`/`stage` since X) when the roster's
 * reasoning models made it mean two different things: the model can be reasoning for minutes with
 * nothing to show, or the connection itself can have gone dead. One clock cannot tell those apart,
 * so there are three:
 *   - `lastTokenAt` — the last VISIBLE output arrived (the stream is writing).
 *   - `lastThinkingAt` — the last reasoning delta arrived (the model is thinking, not hung).
 *   - `lastFrameAt` — ANY frame arrived at all, INCLUDING the transport's own keepalive comment
 *     (`ClientOptions.onKeepalive`) — the one clock that answers "is the connection still there",
 *     independent of what the model is doing. Starts at `startedAt`.
 * `livenessOf` folds the three into the one state the build screen renders; the rendered values —
 * `buildLivenessLine(liveness, s, now)` — are computed per render from a single `now`, so the
 * clock and the liveness verdict can never disagree.
 */
export interface RunSignals {
  startedAt: number;
  aggregates: RunAggregates;
  lastTokenAt: number | null;
  lastThinkingAt: number | null;
  lastFrameAt: number;
}

/** How often the shell re-renders a live build screen so its derived clock moves (design D6/D8):
 *  a re-render on a timer, never an animation, and never a journal read. */
export const RUN_SIGNAL_TICK_MS = 1_000;

/**
 * Fold one stream event into the running totals. A `token` event moves `chars`/`tokens`; a
 * `thinking` event moves `thinkingChars` by its own reported length (build-liveness B1) — the
 * reasoning TEXT never crosses the wire at all (`contract/src/index.ts`'s `thinking` doc comment),
 * so there is nothing here to discard, only a length to add. Both texts are counted and never
 * carried in the returned value, which is what keeps the derived counters inside the no-internals
 * rule. Any other event returns `prev` unchanged (same reference, so a React state setter sees no
 * spurious change).
 */
export function accumulateRunAggregates(prev: RunAggregates, event: GenerationEvent): RunAggregates {
  if (event.type === 'token') {
    return { ...prev, chars: prev.chars + event.text.length, tokens: prev.tokens + 1 };
  }
  if (event.type === 'thinking') {
    return { ...prev, thinkingChars: (prev.thinkingChars ?? 0) + event.chars };
  }
  return prev;
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

/** Below this, `WorkingLine` shows the phrase alone — a clock that has barely moved reads as
 *  theatre, not honesty (`flow-working.tsx#WorkingLine`). */
const WORKING_LINE_CLOCK_THRESHOLD_MS = 5_000;

/**
 * `WorkingLine`'s rendered text: the phrase alone under the threshold, and `phrase · m:ss` once
 * `now - startedAt` reaches it. The phrase itself never changes here — a rotating phrase reads as
 * theatre (`flow-working.tsx` doc comment) — only whether the clock suffix has appeared yet.
 */
export function workingLineText(phrase: string, startedAt: number, now: number): string {
  if (now - startedAt < WORKING_LINE_CLOCK_THRESHOLD_MS) return phrase;
  return `${phrase} · ${elapsedLabel(startedAt, now)}`;
}

// ── Liveness: thinking from hanging (build-liveness B1) ──────────────────────────────────────────
// "'quiet for x s' is misleading. is it really quiet? or is it thinking ... it was 'quiet' for
// minutes at a time then suddenly would add thousands of characters to the count" (the reported
// bug). One heartbeat could not answer "what is happening right now" once the roster's models
// started reasoning for minutes before writing — `livenessOf` answers it from the three
// `RunSignals` clocks, cascading from the most specific truth to the least: writing beats
// thinking beats merely connected beats stalled, each window independently sized and all
// INCLUSIVE at the boundary (`now - last <= window` is still the earlier state, matching
// `elapsedLabel`'s own "exceeded, not merely reached" rounding discipline).

/** A `token` within this long still reads as "writing" even through a short gap between chunks. */
export const WRITING_WINDOW_MS = 4_000;

/** A `thinking` event within this long still reads as "thinking it through" between deltas. */
export const THINKING_WINDOW_MS = 4_000;

/** No frame at all — not even a keepalive — within this long is a stall, not merely a quiet
 *  moment. The server's own keepalive is every 15s, so two missed keepalives plus margin is the
 *  earliest a silence can honestly be called "nothing has arrived", never a normal gap. */
export const STALL_MS = 40_000;

/** The four things the build screen can honestly say is happening right now. `writing` and
 *  `thinking` are DISTINCT states on purpose — the whole point of this design is to stop
 *  collapsing "the model is composing an answer" and "the model has gone quiet for minutes" into
 *  one ambiguous "quiet" reading. */
export type Liveness = 'writing' | 'thinking' | 'connected' | 'stalled';

export function livenessOf(s: RunSignals, now: number): Liveness {
  if (s.lastTokenAt != null && now - s.lastTokenAt <= WRITING_WINDOW_MS) return 'writing';
  if (s.lastThinkingAt != null && now - s.lastThinkingAt <= THINKING_WINDOW_MS) return 'thinking';
  if (now - s.lastFrameAt <= STALL_MS) return 'connected';
  return 'stalled';
}

/**
 * The keepalive comment frame (`: keepalive\n\n`, `ClientOptions.onKeepalive`) folded into
 * `RunSignals`: pure transport liveness, so it moves `lastFrameAt` ONLY — never `aggregates`,
 * never `lastTokenAt`/`lastThinkingAt`, and (unlike `journalStreamEvent`) it never touches a
 * `RunJournalStore` at all, by construction: this function does not take one. A keepalive is
 * transport noise, not something a run's history should record.
 */
export function withKeepalive(signals: RunSignals, at: number): RunSignals {
  return { ...signals, lastFrameAt: at };
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
