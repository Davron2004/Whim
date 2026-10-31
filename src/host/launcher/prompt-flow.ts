/**
 * prompt-flow — the pure page machine behind the making sheet (design-system-v1 D15; `prompt-flow`
 * spec "The making flow is one sheet with four pages").
 *
 * `describe → plan → making → ready | failure`. Clarify and plan are ONE page: Continue on
 * Describe fires the clarify exchange, the questions render as they land, and the rewrite starts at
 * once with every question delegated (`decide: true`). Forward moves are gated by the page's one
 * bottom action and carry a request; backward moves are immediate and lossless. This module holds
 * the DECISIONS — which page comes next, what a back press means, what the build prompt is, what
 * the making page's four steps read as — with no I/O and no React, so the machine is directly
 * Node-testable (the same split `back-policy.ts` and `history-logic.ts` already use).
 * `LauncherRoot.tsx` owns the requests and holds one of these screens as its state.
 *
 * `@whim/contract` is a TYPE-ONLY import: importing the zod schema VALUES would pull zod into the
 * Metro bundle graph (the discipline `generation-client.ts` documents).
 */

import type { Clarification, ClarifyQuestion, ClarifyResponse, GenerationEvent, PlanRow, RewriteResponse } from '@whim/contract';
import type { InstalledApp } from './app-index';
import type { RunAggregates, RunJournalEntry } from './run-journal';
import { COPY, buildQueuedLine } from './copy';
import { GenerationClientError } from './transport-shared';
import { appColor } from '../../sdk/theme';

/** The `stage` event's `stage` field (`GenerationEvent` is a discriminated union). */
export type Stage = Extract<GenerationEvent, { type: 'stage' }>['stage'];

/** At most three questions reach the user — the wire caps this too, but a device that renders a
 *  fourth would be showing something the design never sized for. */
export const MAX_CLARIFY_QUESTIONS = 3;

/** One clarifying question as the page renders it: chips or rows over `options` — one pick for
 *  `select: 'one'`, several for `'many'` — plus a typed "Other" answer when `other` is true. */
export interface FlowQuestion {
  id: string;
  question: string;
  options: readonly string[];
  select: 'one' | 'many';
  other: boolean;
}

/** The longest typed "Other" answer, in characters — the contract's `CLARIFICATION_OTHER_MAX_CHARS`,
 *  mirrored because no contract value may enter the Metro bundle (zod). */
export const OTHER_ANSWER_MAX_CHARS = 200;

/** An option this long (in characters) or shorter reads as a chip; one question with a longer
 *  option shows every option as a full-width row (`system.md` §7.1 Question row). */
export const CHIP_OPTION_MAX_CHARS = 20;

/**
 * One question's answer as the page holds it: the options picked, the "Other" field's text exactly
 * as typed (trimmed only when it is sent), and whether the user asked Whim to decide. `decide` is
 * exclusive — while it is set there are no picks and no typed text — and it is every question's
 * starting answer.
 */
export interface FlowAnswer {
  readonly choices: readonly string[];
  readonly other: string;
  readonly decide: boolean;
}

/** Answers by question id. */
export type FlowAnswers = Readonly<Record<string, FlowAnswer>>;

/** One thing the user did to a question: tapped an option, typed into its "Other" field, or
 *  tapped "Decide for me". */
export type AnswerChange =
  | { readonly kind: 'pick'; readonly option: string }
  | { readonly kind: 'type'; readonly text: string }
  | { readonly kind: 'decide' };

/** What clarify answered in place of questions when the request can't be built as asked (beta-1
 *  D9): the reason, and the nearest thing Whim can build instead. Both are shown as plain text. */
export interface FlowLimit {
  readonly reason: string;
  readonly alternative: string;
}

/**
 * A service refusal's notice, carried on the page it landed on (design D9/D12; spec
 * `service-refusals`). `tone` doubles as the text/sender-landing distinction ONLY the two codes
 * with `landing: 'text'` (`content_policy`/`payload_too_large`) ever carry `danger` — so "clears
 * when the text changes" can be decided from `tone` alone, with no second field to drift from
 * `REFUSAL_RULES`. `retryAt` is the only clock-dependent field: the notice derives the copy-table
 * retry line from it FRESH on every render, and `useNoticeWindowClear` drops a `neutral` notice's
 * window the same way (design D12: "A sender refusal clears when its window ends").
 */
export interface FlowNotice {
  readonly hint: string;
  readonly tone: 'danger' | 'neutral';
  readonly retryAt?: number;
}

/** One labelled plan row. `label` is empty for the single-row fallback, which renders unlabelled
 *  (the wire carried a rewritten string and no structured breakdown). `edited`: the user rewrote
 *  the row inline, so its text is theirs, not the model's — it shows as typed, never through the
 *  prose renderer, which marks up agent prose only (Whim Syntax rule 7). */
export interface FlowPlanRow {
  label: string;
  text: string;
  edited?: true;
}

export interface DescribeScreen {
  kind: 'describe';
  editing?: InstalledApp;
  /** The user's own words, verbatim — never live-lexed while it is being typed. */
  text: string;
  /** A service refusal that landed here (`describeTextChanged` clears a `danger` one on an edit). */
  notice?: FlowNotice;
  /** The plan page this one was reached back from, with its answers and any edits. Continue returns
   *  to it while the words are unchanged; a change of the words drops it. */
  kept?: PlanScreen;
}

/** Why a plan page could not get the request it needs (the phone could not reach the server, or it
 *  answered with something unusable): the plain sentence the page shows, and which request
 *  "Try again" sends. */
export interface PlanProblem {
  readonly request: 'clarify' | 'rewrite';
  readonly reason: string;
}

export interface PlanScreen {
  kind: 'plan';
  editing?: InstalledApp;
  text: string;
  /** The clarify questions, at most three, once they have landed. */
  questions: readonly FlowQuestion[];
  /** By question id; every question starts delegated (`delegatedAnswers`). */
  answers: FlowAnswers;
  /** The clarify exchange is still in flight: the questions are genuinely coming. */
  asking: boolean;
  /** Clarify answered that the request can't be built as asked: the page shows the reason and the
   *  alternative instead of questions and a plan, and starts nothing on its own. */
  limit?: FlowLimit;
  /** The rewrite endpoint's prompt — what generation is asked to build, UNLESS `edited` is true
   *  (`promptForBuild` is the one place that decides between this and the rows). Empty until the
   *  rewrite lands. */
  rewritten: string;
  rows: readonly FlowPlanRow[];
  /** The plan rows have not landed: the exchange (clarify, then rewrite) is in flight or waiting
   *  on "Try again". Skeleton rows stand in for rows whose shape is known. */
  loading: boolean;
  /** When the exchange started — the ember-free wait lines read from here, never from a render. */
  startedAt?: number;
  /** Set the moment any row is edited inline on this page, and never cleared. Flips
   *  `promptForBuild` from trusting `rewritten` to assembling the prompt from `rows` instead —
   *  the two are independent strings the rewrite endpoint returns together, so once a row has
   *  been hand-edited only the rows still reflect what the user approved. */
  edited: boolean;
  /** A service refusal that landed here (a plan-started `generate`, always). */
  notice?: FlowNotice;
  problem?: PlanProblem;
}

export interface MakingScreen {
  kind: 'making';
  editing?: InstalledApp;
  /** The run's own journal id (its launcher id), set once the attempt exists: the key the sheet
   *  shows this run's page under, so one run's page never shows another's progress. */
  runId?: string;
  /** The user's verbatim prompt, tracked into the delivered snapshot's envelope. */
  text: string;
  /** The prompt generation is running against. */
  rewritten: string;
  answers: FlowAnswers;
  questions: readonly FlowQuestion[];
  stage: Stage | null;
  /** The stream produced its record and delivery is running — the last named step. */
  delivering: boolean;
  /** Set while the stream's latest event is `queued`: the build is waiting its turn, at this
   *  position (generations ahead + 1). Absent once any other event arrives (`withStreamEvent`). */
  queuedPosition?: number;
}

export interface ReadyScreen {
  kind: 'ready';
  editing?: InstalledApp;
  /** The delivered app, whose own tile and colour this page shows. */
  app: InstalledApp;
}

export type FlowScreen = DescribeScreen | PlanScreen | MakingScreen | ReadyScreen;

/** The failure page's state as the sheet keys it: the run it is about, by whichever id survived. */
export interface FailedRunKey {
  readonly kind: 'failure';
  readonly journalId?: string;
  readonly recordId?: string;
  readonly pendingId?: string;
}

/**
 * What a sheet page is shown under, so a page never shows another run's progress (spec "The sheet
 * SHALL be keyed by the run's own journal id"): the draft pages under the draft they belong to (one
 * per app being changed, one for a new app), and a run's pages under the run's own journal id —
 * the launcher id the attempt was started with, which is also the delivered app's id.
 */
export function pageKeyOf(screen: FlowScreen | FailedRunKey): string {
  switch (screen.kind) {
    case 'describe':
    case 'plan':
      return `draft:${screen.editing?.id ?? 'new'}`;
    case 'making':
      return `run:${screen.runId ?? 'starting'}`;
    case 'ready':
      return `run:${screen.app.id}`;
    case 'failure':
      return `run:${screen.journalId ?? screen.recordId ?? screen.pendingId ?? 'failed'}`;
  }
}

/** The describe page, optionally scoped to an app being changed and optionally prefilled. */
export function describeStep(editing?: InstalledApp, text = ''): DescribeScreen {
  return { kind: 'describe', ...(editing ? { editing } : {}), text };
}

/**
 * Describe's `onChangeText`: the text always updates. A `text`-landing refusal notice (`danger`
 * tone — the refusal was about the words themselves) clears with it (`service-refusals` "Changing
 * the text ... SHALL clear the notice"). A `sender`-landing notice (`neutral` — an availability or
 * limit refusal, unrelated to what is being retyped) survives a text edit; it clears only when its
 * window ends or the user leaves the page. New words are a new idea: the plan page the screen was
 * reached back from is dropped with its answers.
 */
export function describeTextChanged(screen: DescribeScreen, text: string): DescribeScreen {
  const kept = screen.kept?.text === text ? screen.kept : undefined;
  return {
    ...screen,
    text,
    notice: screen.notice?.tone === 'danger' ? undefined : screen.notice,
    kept,
  };
}

/**
 * The questions the plan page will render: capped at three, and with anything unpickable dropped
 * (a question with no options is not a question). A server that answers with none leaves an empty
 * list, which means the page has no "A few choices" section.
 */
export function acceptClarifyQuestions(questions: readonly ClarifyQuestion[] | undefined): FlowQuestion[] {
  if (!questions) return [];
  return questions
    .filter((q) => q.options.length > 0)
    .slice(0, MAX_CLARIFY_QUESTIONS)
    .map((q) => ({ id: q.id, question: q.question, options: q.options, select: q.select, other: q.other }));
}

/** The response's `limit`, when it carried one. */
export function clarifyLimitOf(response: Pick<ClarifyResponse, 'limit'>): FlowLimit | undefined {
  return response.limit ? { reason: response.limit.reason, alternative: response.limit.alternative } : undefined;
}

/**
 * A clarify `502` means the clarifier is unconfigured or the model answered unusably — the wire
 * contract's own instruction is to treat it as "no questions", never a dead end. Every other
 * failure is a real failure.
 */
export function isClarifySkip(err: unknown): boolean {
  return err instanceof GenerationClientError && err.kind === 'http' && err.status === 502;
}

/** Every question delegated: "Decide for me" selected, nothing picked, nothing typed. This is each
 *  question's starting answer, and what the rewrite is always sent. */
export function delegatedAnswers(questions: readonly FlowQuestion[]): FlowAnswers {
  return Object.fromEntries(questions.map((q) => [q.id, { choices: [], other: '', decide: true }]));
}

/**
 * Continue on Describe opens the plan page at once, under its loading state — the wait is the page
 * itself (skeleton question and plan rows), never a grey Continue button. `withQuestions` fills in
 * the questions once clarify answers, `withPlan` the rows once the rewrite does.
 */
export function planStep(prev: DescribeScreen): PlanScreen {
  return {
    kind: 'plan',
    ...(prev.editing ? { editing: prev.editing } : {}),
    text: prev.text,
    questions: [],
    answers: {},
    asking: true,
    rewritten: '',
    rows: [],
    loading: true,
    startedAt: Date.now(),
    edited: false,
  };
}

/** The clarify exchange answered with questions (possibly none): they replace the skeleton, every
 *  one delegated. Everything else about the page is carried through untouched. */
export function withQuestions(screen: PlanScreen, questions: readonly FlowQuestion[]): PlanScreen {
  return { ...screen, questions, answers: delegatedAnswers(questions), asking: false, problem: undefined };
}

/** The clarify exchange answered with a `limit`: the page leaves loading and shows it, with no
 *  questions and no plan — there is nothing to ask about a request that can't be made. */
export function withLimit(screen: PlanScreen, limit: FlowLimit): PlanScreen {
  return { ...screen, questions: [], answers: {}, asking: false, loading: false, limit, problem: undefined };
}

/** A request the page needs could not be sent or answered: the page stays, with its words and
 *  whatever has landed, and offers Try again. */
export function withProblem(screen: PlanScreen, problem: PlanProblem): PlanScreen {
  return { ...screen, asking: false, loading: false, problem };
}

/** "Try again" (or reopening a closed plan): the page is waiting on `request` again. */
export function retrying(screen: PlanScreen, request: 'clarify' | 'rewrite'): PlanScreen {
  return {
    ...screen,
    asking: request === 'clarify',
    loading: true,
    problem: undefined,
    startedAt: Date.now(),
  };
}

/** Which request a plan page is still missing, or `null` when it has everything it asked for (or
 *  is a limit page, which asks for nothing). */
export function missingRequest(screen: PlanScreen): 'clarify' | 'rewrite' | null {
  if (screen.limit || screen.problem) return null;
  if (screen.asking) return 'clarify';
  return screen.loading ? 'rewrite' : null;
}

const NO_ANSWER: FlowAnswer = { choices: [], other: '', decide: false };

/**
 * One question's answer after one change. A pick on a `select: 'one'` question MOVES the pick
 * (radio-like: tapping the picked option again keeps it), which is where "at most one choice" is
 * enforced; on `'many'` it toggles. Typing sets the "Other" text, capped like the field itself. A
 * `select: 'one'` question holds one answer, so typing a real answer clears its pick and picking
 * clears its typed text; on `'many'` both can stand. "Decide for me" clears every pick and the
 * typed text; picking or typing afterwards clears it (exclusive both ways, in single and multi
 * select). Emptying the last pick of a `'many'` question or the typed text leaves nothing picked
 * and nothing delegated, which falls back to delegating — an empty question means "you decide".
 * A change the question cannot take (an option it doesn't list, typing where it has no "Other"
 * field) leaves the answer as it was.
 */
export function answerAfter(question: FlowQuestion, prev: FlowAnswer | undefined, change: AnswerChange): FlowAnswer {
  const current = prev ?? NO_ANSWER;
  const one = question.select === 'one';
  if (change.kind === 'decide') return { choices: [], other: '', decide: true };
  const next = changed(question, current, change, one);
  const empty = next.choices.length === 0 && next.other.trim().length === 0;
  return empty ? { choices: [], other: next.other, decide: true } : next;
}

function changed(question: FlowQuestion, current: FlowAnswer, change: Exclude<AnswerChange, { kind: 'decide' }>, one: boolean): FlowAnswer {
  if (change.kind === 'type') {
    if (!question.other) return current;
    const choices = one && change.text.trim().length > 0 ? [] : current.choices;
    return { choices, other: change.text.slice(0, OTHER_ANSWER_MAX_CHARS), decide: false };
  }
  if (!question.options.includes(change.option)) return current;
  if (one) return { choices: [change.option], other: '', decide: false };
  const picked = current.choices.includes(change.option)
    ? current.choices.filter((choice) => choice !== change.option)
    : [...current.choices, change.option];
  // Kept in the order the question lists them, whatever order they were tapped in.
  return { choices: question.options.filter((option) => picked.includes(option)), other: current.other, decide: false };
}

/** Apply one answer change to the question it names; an id the page isn't showing changes nothing. */
export function withAnswer(screen: PlanScreen, questionId: string, change: AnswerChange): PlanScreen {
  const question = screen.questions.find((q) => q.id === questionId);
  if (!question) return screen;
  return { ...screen, answers: { ...screen.answers, [questionId]: answerAfter(question, screen.answers[questionId], change) } };
}

/** Whether every option is short enough for chips (`CHIP_OPTION_MAX_CHARS`); otherwise the
 *  question shows every option as a full-width row. */
export function showsChips(question: FlowQuestion): boolean {
  return question.options.every((option) => option.length <= CHIP_OPTION_MAX_CHARS);
}

/**
 * The answers as the wire carries them — by value, one entry per question: `decide: true` alone for
 * a delegated question, otherwise the picked `choices` (at most one for `select: 'one'`) and the
 * trimmed, capped `other` text, which is absent when empty. A question with no answer at all (never
 * delegated and never picked) is omitted.
 */
export function clarificationsFrom(
  questions: readonly FlowQuestion[],
  answers: FlowAnswers,
): Clarification[] {
  const out: Clarification[] = [];
  for (const q of questions) {
    const answer = answers[q.id];
    if (!answer) continue;
    if (answer.decide) {
      out.push({ id: q.id, question: q.question, choices: [], decide: true });
      continue;
    }
    const picked = q.options.filter((option) => answer.choices.includes(option));
    const choices = q.select === 'one' ? picked.slice(0, 1) : picked;
    const other = q.other ? answer.other.trim().slice(0, OTHER_ANSWER_MAX_CHARS) : '';
    if (choices.length === 0 && other.length === 0) continue;
    out.push({ id: q.id, question: q.question, choices, ...(other.length > 0 ? { other } : {}) });
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

/** The rewrite response arrived: the rows replace the skeleton and `Make it` goes live. */
export function withPlan(
  screen: PlanScreen,
  response: Pick<RewriteResponse, 'rewrittenPrompt' | 'plan'>,
): PlanScreen {
  return { ...screen, rewritten: response.rewrittenPrompt, rows: planRowsFrom(response), loading: false, problem: undefined };
}

/** Inline-editing one plan row, in place on the plan page: every other row, the original prompt
 *  and the answers are carried through untouched. `index` is the row's position — rows are a
 *  stable, never-reordered array, so an index survives duplicate row text where the `label:text`
 *  string the UI otherwise keys off of would collide. */
export function updatePlanRow(screen: PlanScreen, index: number, text: string): PlanScreen {
  const rows = screen.rows.map((row, i): FlowPlanRow => (i === index ? { ...row, text, edited: true } : row));
  // Saving a row edit clears a `text`-landing (`danger`-tone) notice, the same rule `describeTextChanged`
  // applies — a `sender`-landing notice survives it, unrelated to the plan's own words.
  return { ...screen, rows, edited: true, notice: screen.notice?.tone === 'danger' ? undefined : screen.notice };
}

/**
 * The prompt generation is actually asked to build. `rewritten` and `rows` are two independent
 * strings the rewrite endpoint returns together — not one derived from the other — so once the
 * user has hand-edited a row inline, only the rows still reflect what they approved and
 * `rewritten` is stale. Unedited, this is byte-identical to `screen.rewritten` (the common case).
 * Edited, it assembles one line per row — `label: text` when the row has a label, the bare text
 * otherwise — joined with newlines, and stays on that path even if the text is reverted
 * (`edited` is never cleared). The single-row fallback (`planRowsFrom`) collapses to exactly that
 * row's text, which is the lossless case.
 */
export function promptForBuild(screen: PlanScreen): string {
  if (!screen.edited) return screen.rewritten;
  return screen.rows.map((row) => (row.label.length > 0 ? `${row.label}: ${row.text}` : row.text)).join('\n');
}

/** The making page. Generation starts here and nowhere earlier. */
export function makingStep(prev: PlanScreen): MakingScreen {
  return {
    kind: 'making',
    ...(prev.editing ? { editing: prev.editing } : {}),
    text: prev.text,
    rewritten: promptForBuild(prev),
    answers: prev.answers,
    questions: prev.questions,
    stage: null,
    delivering: false,
  };
}

/** The making page out of the line: its place in line is gone, everything else untouched. */
function outOfLine(screen: MakingScreen): MakingScreen {
  if (screen.queuedPosition === undefined) return screen;
  const next = { ...screen };
  delete next.queuedPosition;
  return next;
}

/** A `stage` event: the build's turn has come (if it was waiting), and the step moves on. */
export function withStage(screen: MakingScreen, stage: Stage): MakingScreen {
  return { ...outOfLine(screen), stage };
}

/**
 * One stream event folded into the making page's state (the only two that carry any are `stage`
 * and `queued`): `queued` records the build's place in line, `stage` moves the step, and any other
 * event ends the waiting state — "in line" holds only while the latest event is `queued`. Returns
 * the same object when nothing changes, so the shell sets no state for a token.
 */
export function withStreamEvent(screen: MakingScreen, event: GenerationEvent): MakingScreen {
  if (event.type === 'stage') return withStage(screen, event.stage);
  if (event.type === 'queued') {
    return screen.queuedPosition === event.position ? screen : { ...screen, queuedPosition: event.position };
  }
  return outOfLine(screen);
}

/** The stream produced its record; the last named step is now the live one. */
export function withDelivering(screen: MakingScreen): MakingScreen {
  return { ...screen, delivering: true };
}

/** The ready page, showing the delivered app. */
export function readyStep(prev: MakingScreen, app: InstalledApp): ReadyScreen {
  return { kind: 'ready', ...(prev.editing ? { editing: prev.editing } : {}), app };
}

/** What a back press on the plan page does: leave it for Describe, or — while a row is being
 *  edited — cancel that edit and keep the page (spec launcher-screen-exits "System back and the
 *  visible control perform the same action"). `PlanPage` builds one handler from this and gives it
 *  to both `useSystemBack` and its back control, so a tap on Back mid-edit can no longer discard
 *  a draft. */
export function planBackAction(editingRow: boolean): 'cancel-edit' | 'leave' {
  return editingRow ? 'cancel-edit' : 'leave';
}

/** Back from the plan page: Describe, with the words kept and the plan page itself kept to come
 *  back to while the words stay as they are. */
export function backToDescribe(plan: PlanScreen): DescribeScreen {
  return { ...describeStep(plan.editing, plan.text), kept: plan };
}

/**
 * Hardware back on the making page (bug fix: back must never cancel a run — see `BuildStep.tsx`'s
 * header comment). The details sheet, when open, has no back handling of its own
 * (`RunDetailsSheet.tsx`), so the shell must decide between the sheet and the run itself from the
 * one signal it has: whether the sheet is open. `close-sheet` only ever closes the sheet; `leave`
 * is exactly the `onLeaveRunning` action — the run keeps going and is still delivered, it just
 * stops taking over the screen. Cancellation is reachable only from explicit affordances
 * elsewhere (a tile's own Stop), never from back.
 */
export function buildBackAction(sheetOpen: boolean): 'close-sheet' | 'leave' {
  return sheetOpen ? 'close-sheet' : 'leave';
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

/** Everything the build screen's progress reads: the named steps, the bar and the sentence. */
export interface BuildProgressView {
  statuses: BuildStepStatus[];
  fraction: number;
  sentence: string;
}

/**
 * The build screen's progress (beta-1 D8). While the build waits in line nothing has started, so
 * no step is live, the bar is empty and the sentence says where the build is in line. From the
 * first `stage` on it is the stage-driven progress above.
 */
export function buildProgressView(stage: Stage | null, delivering: boolean, queuedPosition?: number): BuildProgressView {
  if (queuedPosition !== undefined) {
    return { statuses: BUILD_STEPS.map(() => 'todo'), fraction: 0, sentence: buildQueuedLine(queuedPosition) };
  }
  return {
    statuses: buildStepStatuses(stage, delivering),
    fraction: buildProgressFraction(stage, delivering),
    sentence: currentActionSentence(stage, delivering),
  };
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
  /** The written-output counts when the current model turn began (its `stage` start), which a
   *  `restart` returns to (beta-1 D10). Absent means the attempt's own start: nothing written. */
  turnStart?: { readonly chars: number; readonly tokens: number };
  /** The latest event put the build in line (`queued`, beta-1 D8): it is waiting its turn. */
  inLine?: boolean;
  /** When the build's turn came after it waited in line: its build clock reads from here, so the
   *  time in line isn't counted as building. Absent for a build that never waited. */
  turnCameAt?: number;
}

/** One stream event's effect on the build's place in line: `queued` puts it in line, and the first
 *  other event after that is the moment its turn came. Same object when nothing changes. */
export function withLinePlace(signals: RunSignals, event: GenerationEvent, at: number): RunSignals {
  if (event.type === 'queued') return signals.inLine === true ? signals : { ...signals, inLine: true };
  if (signals.inLine !== true) return signals;
  return { ...signals, inLine: false, turnCameAt: at };
}

/** What the build is doing, as its liveness line tells it: waiting in line, waiting on or reading
 *  a model turn, or checking the app it wrote (`check`/`run`, where no model writes anything). */
export type LivenessPhase = 'line' | 'model' | 'checking';

export function livenessPhaseOf(stage: Stage | null, queuedPosition: number | undefined): LivenessPhase {
  if (queuedPosition !== undefined) return 'line';
  return stage === 'check' || stage === 'run' ? 'checking' : 'model';
}

/** A `stage` start begins a new model turn: the counts so far are where a restart of it returns. */
export function withTurnStart(signals: RunSignals): RunSignals {
  return { ...signals, turnStart: { chars: signals.aggregates.chars, tokens: signals.aggregates.tokens } };
}

/**
 * A `restart` (beta-1 D10): the current model turn is being resent and the tokens it streamed are
 * void, so everything counted from them goes back to where the turn began — the characters and
 * tokens written, and the "writing" clock — while the build carries on as the same build. The
 * reasoning tally is not counted from tokens and stays. The frame itself is liveness, like any
 * other event.
 */
export function withRestart(signals: RunSignals, at: number): RunSignals {
  const start = signals.turnStart ?? { chars: 0, tokens: 0 };
  return {
    ...signals,
    aggregates: { ...signals.aggregates, chars: start.chars, tokens: start.tokens },
    lastTokenAt: null,
    lastFrameAt: at,
  };
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
