/**
 * failure-kind — which failure a run ended in, what the Failure page says about it and what it
 * offers (system.md §8 failure kinds, §9 Didn't work; `prompt-flow` "Failure is shown by kind,
 * honestly, never as a crash"). No `react-native` import: the launcher's Node suite exercises it.
 *
 * The kind is read from what the run left behind, so a live failure and the same failure reopened
 * from its tile read alike: the stored cause, whether rewording can help, the repair tries the run
 * used, how an interruption happened, whether only a newer Whim can finish it, and whether a
 * refusal is still holding Try again. Never from how the reason is worded.
 */
import { COPY, failureCouldntRunLine, REPAIR_ATTEMPT_LIMIT } from './copy';
import type { PendingBuildFailure, PendingFailureCause } from './pending-builds';

export type FailureKind =
  /** The server used every repair try and the app still didn't run. */
  | 'couldnt-run'
  /** A refused Try again: the server's reason is the notice, with its window. */
  | 'refused'
  /** Only a newer Whim can finish this run (an `update` fallback ended it). */
  | 'needs-update'
  /** Whim closed while it was making. */
  | 'closed'
  /** The person stopped the run. */
  | 'stopped'
  /** The stream dropped before its end. */
  | 'connection'
  /** Anything else: the reason as the server (or the phone) worded it. */
  | 'other';

export interface FailureFacts {
  /** The terminal event's reason, the phone's own sentence for an error, or a refusal's text. */
  readonly reason: string;
  /** Whether describing the app differently could get past it. */
  readonly rephraseHelps: boolean;
  /** Repair tries the run is known to have used (observed live, or recorded in its journal). */
  readonly repairs: number;
  /** How the run was interrupted, when it was. */
  readonly interrupted?: 'closed' | 'stopped';
  /** A refused Try again's notice is showing. */
  readonly refused: boolean;
  /** What ended the run, when it was told apart (`PendingFailureCause`). */
  readonly cause?: PendingFailureCause;
  /** Only a newer Whim than this one can finish the run. */
  readonly needsUpdate?: boolean;
}

export function failureKindOf(facts: FailureFacts): FailureKind {
  if (facts.refused) return 'refused';
  if (facts.interrupted) return facts.interrupted;
  if (facts.needsUpdate) return 'needs-update';
  if (facts.cause === 'connection') return 'connection';
  return facts.repairs >= REPAIR_ATTEMPT_LIMIT ? 'couldnt-run' : 'other';
}

/** The sentence a lost connection was stored under before records named their cause. Frozen here,
 *  not read from `COPY`: rewording the live sentence must not change how those records read. */
const LEGACY_CONNECTION_REASON = 'I lost the connection to the server partway through.';

/** The cause a persisted failure names; a record written before causes were stored names none, and
 *  is read as a lost connection only when it carries the sentence that meant one then. */
export function failureCauseOf(failure: Pick<PendingBuildFailure, 'reason' | 'cause'> | undefined): PendingFailureCause | undefined {
  if (failure?.cause) return failure.cause;
  return failure?.reason === LEGACY_CONNECTION_REASON ? 'connection' : undefined;
}

/** The page's one sentence for the kind; `null` for a refusal, whose notice says it. */
export function failureSentence(kind: FailureKind, facts: Pick<FailureFacts, 'reason' | 'rephraseHelps'>): string | null {
  switch (kind) {
    case 'couldnt-run':
      return failureCouldntRunLine(REPAIR_ATTEMPT_LIMIT, facts.rephraseHelps);
    case 'refused':
      return null;
    case 'needs-update':
      return COPY.failureNeedsUpdate;
    case 'closed':
      return COPY.interruptedBuildReason;
    case 'stopped':
      return COPY.failureStopped;
    case 'connection':
      return COPY.failureConnection;
    case 'other':
      return facts.reason;
  }
}

/** What a Failure page action does: describe the app again with the words kept, run it again, open
 *  Whim's store listing, or leave. */
export type FailureMove = 'change' | 'retry' | 'update' | 'not-now';

export interface FailureAction {
  readonly move: FailureMove;
  readonly label: string;
  readonly variant: 'ember' | 'ink' | 'plain';
}

const CHANGE: FailureAction = { move: 'change', label: COPY.failureChangeDescription, variant: 'ink' };
const RETRY: FailureAction = { move: 'retry', label: COPY.actionTryAgain, variant: 'ember' };
const UPDATE: readonly FailureAction[] = [
  { move: 'update', label: COPY.updateAction, variant: 'ink' },
  { move: 'not-now', label: COPY.updateNotNow, variant: 'plain' },
];

/**
 * The page's actions for the kind, first the filled one (system.md §8): where rewording can help
 * (a run that didn't work, or a refusal of the words themselves), "Change the description" leads
 * and "Try again as it is" follows; otherwise "Try again", which is Whim's action and so `ember`. A
 * stopped run can also be described again. Whim closing and a lost connection were never the
 * words' doing, so they never offer rewording. A run only a newer Whim can finish offers neither:
 * "Update Whim", or "Not now". `canRetry` false (no attempt is left to run again) leaves "Change
 * the description" as the one way on.
 */
export function failureActions(kind: FailureKind, rephraseHelps: boolean, canRetry: boolean): readonly FailureAction[] {
  if (kind === 'needs-update') return UPDATE;
  if (!canRetry) return [CHANGE];
  if ((kind === 'couldnt-run' || kind === 'other' || kind === 'refused') && rephraseHelps) {
    return [CHANGE, { move: 'retry', label: COPY.failureTryAgainAsIs, variant: 'plain' }];
  }
  if (kind === 'stopped') return [RETRY, { ...CHANGE, variant: 'plain' }];
  return [RETRY];
}
