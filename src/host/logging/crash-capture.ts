/**
 * crash-capture — uncaught host errors and unhandled promise rejections become seam records
 * (developer-observability D5; spec device-diagnostics "Uncaught host errors and fatal JS errors
 * are captured").
 *
 * The global handler logs, keeps a fatal error's projection for the next launch, and then calls
 * the handler that was installed before it, so a fatal error still ends the process exactly as it
 * did. The rejection hook logs, then defers to the tracking options it was given (React Native's
 * own, in a dev build; there are none in a release build).
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
  seam: Pick<Seam, 'error'>;
  /** Called with a fatal error's projection before the previous handler runs. Must not throw. */
  keepFatal: (record: DiagnosticRecord) => void;
  now?: () => number;
}

/** The constant messages the two hooks log under (the seam's message is never variable). */
const UNCAUGHT_ERROR_MESSAGE = 'uncaught error';
const UNHANDLED_REJECTION_MESSAGE = 'unhandled promise rejection';

/** A thrown value as named fields: its class and stack go to the diagnostics projection (which
 *  drops the stack's message line); its message stays in `detail`, which never leaves the phone. */
function thrownFields(where: string, thrown: unknown): Record<string, unknown> {
  const isErr = thrown instanceof Error;
  return {
    where,
    errorClass: isErr ? thrown.name : typeof thrown,
    detail: isErr ? thrown.message : undefined,
    stack: isErr ? thrown.stack : undefined,
  };
}

export function installCrashCapture(deps: CrashCaptureDeps): void {
  const now = deps.now ?? (() => Date.now());
  const { errorUtils, hermes, seam } = deps;

  if (errorUtils) {
    const previous = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((error, isFatal) => {
      try {
        const fields = thrownFields(isFatal ? 'fatal' : 'uncaught', error);
        seam.error(CHANNELS.app, UNCAUGHT_ERROR_MESSAGE, fields);
        if (isFatal) {
          deps.keepFatal(
            toDiagnostic({ at: now(), level: 'error', channel: CHANNELS.app, message: UNCAUGHT_ERROR_MESSAGE, fields: redactFields(fields) }),
          );
        }
        // eslint-disable-next-line no-restricted-syntax -- intentional: recording the error must never stop it reaching the previous handler, which is what ends the process on a fatal error.
      } catch {
        // deliberately silent — see the disable comment above
      }
      previous(error, isFatal);
    });
  }

  const previousTracking = deps.previousRejectionTracking;
  hermes?.enablePromiseRejectionTracker?.({
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
