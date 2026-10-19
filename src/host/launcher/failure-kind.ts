/**
 * failure-kind — which failure a run ended in, what the Failure page says about it and what it
 * offers (system.md §8 failure kinds, §9 Didn't work; `prompt-flow` "Failure is shown by kind,
 * honestly, never as a crash"). No `react-native` import: the launcher's Node suite exercises it.
 *
 * The kind is read from what the run left behind, so a live failure and the same failure reopened
 * from its tile read alike: the reason, whether rewording can help, the repair tries the run used,
 * how an interruption happened, and whether a refusal is still holding Try again.
 */
import { COPY, failureCouldntRunLine, REPAIR_ATTEMPT_LIMIT } from './copy';

export type FailureKind =
  /** The server used every repair try and the app still didn't run. */
  | 'couldnt-run'
  /** A refused Try again: the server's reason is the notice, with its window. */
  | 'refused'
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
}

export function failureKindOf(facts: FailureFacts): FailureKind {
  if (facts.refused) return 'refused';
  if (facts.interrupted) return facts.interrupted;
  if (facts.reason === COPY.failureConnection) return 'connection';
  return facts.repairs >= REPAIR_ATTEMPT_LIMIT ? 'couldnt-run' : 'other';
}

/** The page's one sentence for the kind; `null` for a refusal, whose notice says it. */
export function failureSentence(kind: FailureKind, facts: Pick<FailureFacts, 'reason' | 'rephraseHelps'>): string | null {
  switch (kind) {
    case 'couldnt-run':
      return failureCouldntRunLine(REPAIR_ATTEMPT_LIMIT, facts.rephraseHelps);
    case 'refused':
      return null;
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

/** What a Failure page action does: describe the app again with the words kept, or run it again. */
export type FailureMove = 'change' | 'retry';

export interface FailureAction {
  readonly move: FailureMove;
  readonly label: string;
  readonly variant: 'ember' | 'ink' | 'plain';
}

const CHANGE: FailureAction = { move: 'change', label: COPY.failureChangeDescription, variant: 'ink' };
const RETRY: FailureAction = { move: 'retry', label: COPY.actionTryAgain, variant: 'ember' };

/**
 * The page's actions for the kind, first the filled one (system.md §8): where rewording can help
 * (a run that didn't work, or a refusal of the words themselves), "Change the description" leads
 * and "Try again as it is" follows; otherwise "Try again", which is Whim's action and so `ember`. A
 * stopped run can also be described again. Whim closing and a lost connection were never the
 * words' doing, so they never offer rewording. `canRetry` false (no attempt is left to run again)
 * leaves "Change the description" as the one way on.
 */
export function failureActions(kind: FailureKind, rephraseHelps: boolean, canRetry: boolean): readonly FailureAction[] {
  if (!canRetry) return [CHANGE];
  if ((kind === 'couldnt-run' || kind === 'other' || kind === 'refused') && rephraseHelps) {
    return [CHANGE, { move: 'retry', label: COPY.failureTryAgainAsIs, variant: 'plain' }];
  }
  if (kind === 'stopped') return [RETRY, { ...CHANGE, variant: 'plain' }];
  return [RETRY];
}
