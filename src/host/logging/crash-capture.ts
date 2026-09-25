/**
 * crash-capture — uncaught host errors and unhandled promise rejections become seam records
 * (developer-observability D5; spec device-diagnostics "Uncaught host errors and fatal JS errors
 * are captured").
 *
 * The global handler logs, keeps a fatal error's projection for the next launch, and then calls
 * the handler that was installed before it, so a fatal error still ends the process exactly as it
 * did. The rejection hook logs, then defers to the tracking options it was given (React Native's
 * own, in a dev build; there are none in a release build). A render error that reaches the app's
 * root error boundary is recorded the same way as a fatal error (`renderCrashRecorder`).
 *
 * No React Native import: the RN globals (`ErrorUtils`, `HermesInternal`) are injected by
 * `platform/install-diagnostics.ts`, so the Node suite drives this with fakes.
 */

import type { DiagnosticRecord } from '@whim/contract';
import { CHANNELS } from './channels';
import { toDiagnostic } from './diagnostic';
import type { Seam } from './index';
import { redactFields } from './redact';

export type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;

/** The part of React Native's `ErrorUtils` global this uses. */
export interface GlobalErrorUtils {
  getGlobalHandler(): GlobalErrorHandler;
  setGlobalHandler(handler: GlobalErrorHandler): void;
}

/** Hermes' promise-rejection tracker options (the shape `promise/rejection-tracking` takes). */
export interface RejectionTracking {
  allRejections: boolean;
  onUnhandled: (id: number, rejection: unknown) => void;
  onHandled: (id: number) => void;
}

/** The part of the `HermesInternal` global this uses; absent on an engine without it. */
export interface RejectionTrackerHost {
  enablePromiseRejectionTracker?: (options: RejectionTracking) => void;
}

interface CrashCaptureDeps {
  errorUtils: GlobalErrorUtils | undefined;
  hermes: RejectionTrackerHost | null | undefined;
  /** The tracking options to defer to after logging a rejection. */
  previousRejectionTracking?: Partial<RejectionTracking>;
  seam: Pick<Seam, 'error' | 'warn'>;
  /** Called with a fatal error's projection before the previous handler runs. Must not throw. */
  keepFatal: (record: DiagnosticRecord) => void;
  now?: () => number;
}

/** The constant messages the two hooks log under (the seam's message is never variable). */
const UNCAUGHT_ERROR_MESSAGE = 'uncaught error';
const UNHANDLED_REJECTION_MESSAGE = 'unhandled promise rejection';
const NO_REJECTION_TRACKER_MESSAGE = 'promise rejection tracker unavailable';
const RENDER_ERROR_MESSAGE = 'uncaught render error';

/** A `:line:column` suffix, as Hermes/V8 print at the end of a frame's location. Deliberately
 *  the ONLY regex here — a single small quantifier on either side of a literal `:`, so there is
 *  no backtracking to simplify (sonarjs/super-linear-regex flags a broader `path:line:column`
 *  pattern, since a path's character class overlaps the digits it must also match). The path
 *  itself is found by a plain backward character scan below, not a regex. */
const LINE_COL_SUFFIX = /:\d+:\d+/g;
/** Characters that end a frame's location token (Hermes/V8 always wrap or space-separate one). */
function endsLocationToken(ch: string): boolean {
  return ch === ' ' || ch === '(' || ch === '\t' || ch === '\n';
}

/** Reduces every frame's location in a stack to its file name plus line:column, on every
 *  platform (spec device-diagnostics "Diagnostic stacks carry file names, not install paths").
 *  Android frames already have no path to strip, so this is a no-op there; an iOS frame's
 *  `…/Whim.app/main.jsbundle:1:234567` becomes `main.jsbundle:1:234567`. Only the path is
 *  dropped — line and column, which is all symbolication reads from a single flat map, are
 *  untouched, so a trimmed stack still symbolicates to the same source lines. */
export function trimFrameLocations(stack: string): string {
  let result = '';
  let cursor = 0;
  for (const match of stack.matchAll(LINE_COL_SUFFIX)) {
    const suffixStart = match.index;
    let tokenStart = suffixStart;
    let lastSlash = -1;
    while (tokenStart > 0 && !endsLocationToken(stack[tokenStart - 1])) {
      // The FIRST '/' found scanning backward from the suffix is the one closest to the
      // basename — further ones (higher up the path) must not overwrite it.
      if (lastSlash === -1 && stack[tokenStart - 1] === '/') lastSlash = tokenStart - 1;
      tokenStart -= 1;
    }
    const basenameStart = lastSlash === -1 ? tokenStart : lastSlash + 1;
    result += stack.slice(cursor, tokenStart) + stack.slice(basenameStart, suffixStart) + match[0];
    cursor = suffixStart + match[0].length;
  }
  return result + stack.slice(cursor);
}

/** A thrown value as named fields: its class and stack go to the diagnostics projection (which
 *  drops the stack's message line); its message stays in `detail`, which never leaves the phone. */
function thrownFields(where: string, thrown: unknown): Record<string, unknown> {
  const isErr = thrown instanceof Error;
  const stack = isErr ? thrown.stack : undefined;
  return {
    where,
    errorClass: isErr ? thrown.name : typeof thrown,
    detail: isErr ? thrown.message : undefined,
    stack: stack === undefined ? undefined : trimFrameLocations(stack),
  };
}

/** Log `error` as an error record and, when it is fatal, keep its projection for the next launch.
 *  Never throws: every caller still has to hand the error on to what ends the process. */
function recordThrown(
  deps: Pick<CrashCaptureDeps, 'seam' | 'keepFatal' | 'now'>,
  message: string,
  where: string,
  error: unknown,
  isFatal: boolean,
): void {
  try {
    const fields = thrownFields(where, error);
    deps.seam.error(CHANNELS.app, message, fields);
    if (isFatal) {
      const at = (deps.now ?? (() => Date.now()))();
      deps.keepFatal(toDiagnostic({ at, level: 'error', channel: CHANNELS.app, message, fields: redactFields(fields) }));
    }
    // eslint-disable-next-line no-restricted-syntax -- intentional: recording the error must never stop it reaching the handler that ends the process on a fatal error.
  } catch {
    // deliberately silent — see the disable comment above
  }
}

export function installCrashCapture(deps: CrashCaptureDeps): void {
  const { errorUtils, hermes, seam } = deps;

  if (errorUtils) {
    const previous = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((error, isFatal) => {
      recordThrown(deps, UNCAUGHT_ERROR_MESSAGE, isFatal ? 'fatal' : 'uncaught', error, isFatal === true);
      previous(error, isFatal);
    });
  }

  installRejectionHook(hermes, deps.previousRejectionTracking, seam);
}

/** The Hermes rejection hook: log, then defer to `previousTracking`. On an engine without the
 *  tracker, say so once, as a warning on the sink channel: never uploaded, but in the ring buffer,
 *  so an engine that silently drops unhandled rejections is visible in the log. */
function installRejectionHook(
  hermes: RejectionTrackerHost | null | undefined,
  previousTracking: Partial<RejectionTracking> | undefined,
  seam: CrashCaptureDeps['seam'],
): void {
  const enableTracker = hermes?.enablePromiseRejectionTracker;
  if (typeof enableTracker !== 'function') {
    seam.warn(CHANNELS.sink, NO_REJECTION_TRACKER_MESSAGE, { engine: hermes == null ? 'no HermesInternal' : 'no tracker' });
    return;
  }
  enableTracker.call(hermes, {
    allRejections: true,
    onUnhandled: (id, rejection) => {
      seam.error(CHANNELS.app, UNHANDLED_REJECTION_MESSAGE, thrownFields('unhandled-rejection', rejection));
      previousTracking?.onUnhandled?.(id, rejection);
    },
    onHandled: id => {
      previousTracking?.onHandled?.(id);
    },
  });
}

/**
 * What the app's root error boundary does with a render error before rethrowing it (review F3).
 * In React Native 0.85 a render error no boundary handles goes React 19 `onUncaughtError` →
 * `ExceptionsManager.handleException(error, true)`, which never calls the `ErrorUtils` handler
 * above, so without this such a crash would leave no record and no fatal slot. Records it as an
 * error record on the container channel (`where: "render"`) and keeps it in the fatal slot, since
 * the boundary rethrows it into that fatal path. Never throws.
 */
export function renderCrashRecorder(deps: Pick<CrashCaptureDeps, 'seam' | 'keepFatal' | 'now'>): (error: unknown) => void {
  return error => recordThrown(deps, RENDER_ERROR_MESSAGE, 'render', error, true);
}
