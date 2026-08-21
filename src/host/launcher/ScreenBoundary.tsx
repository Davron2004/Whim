// ─────────────────────────────────────────────────────────────────────────────
// ScreenBoundary — the launcher's one recoverable error boundary (obs-v1, design D1,
// host-observability "Every screen renders inside a recoverable error boundary").
// ─────────────────────────────────────────────────────────────────────────────
// Wraps the ROUTER's screen switch, never an individual screen: coverage is a property of the
// router, so a screen added later is covered by construction. `react-error-boundary` v6 supplies
// the catch + the reset-key semantics; this component adds the two things the spec asks for:
//
//   1. the throw is reported through the logging seam BEFORE the fallback renders — so the
//      report happens in the boundary's render phase (deduplicated per caught error), not in
//      `componentDidCatch`, which React runs only after the fallback has already rendered;
//   2. `screen` is BOTH the failing-screen identifier in that record AND the reset key, so
//      navigating to a different screen clears the error state and a screen that failed once is
//      reachable again.
//
// Deliberately free of `react-native`: the fallback arrives as a prop (`FallbackComponent`), so
// the boundary itself can be rendered — and its catch/report/reset behaviour exercised — by the
// launcher's Node acceptance suite, which cannot bundle React Native.
import React, { useCallback } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { log } from '../logging';
import { CHANNELS } from '../logging/channels';

/** What the boundary hands its fallback. `resetErrorBoundary` retries the failed subtree. */
export interface ScreenFallbackProps {
  /** The thrown value, for the fallback to decide layout from — never rendered raw to the user. */
  error: unknown;
  /** The identifier of the screen that failed (the same one the log record carries). */
  screen: string;
  /** Clears the error state and remounts the failed subtree from scratch. */
  resetErrorBoundary: () => void;
}

export interface ScreenBoundaryProps {
  /** The active screen's identifier: reported as the failing screen AND used as the reset key —
   *  a changed value clears the error state and re-attempts the subtree. */
  screen: string;
  /** The recoverable error screen. `ScreenErrorFallback` is the launcher's. */
  FallbackComponent: ComponentType<ScreenFallbackProps>;
  children: ReactNode;
}

function errorClassOf(error: unknown): string {
  if (error instanceof Error) return error.constructor.name;
  return typeof error;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : JSON.stringify(error);
}

function stackOf(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

/** Identity of a failure for reporting purposes — NOT the thrown object, and NOT its stack: React
 *  retries a failed render before giving up on the subtree, so one screen failure arrives as two
 *  distinct `Error` instances whose stacks differ in React's own internal frames. Class + message
 *  is what stays equal across that retry, and the seam must see the failure once. */
function signatureOf(error: unknown): string {
  return `${errorClassOf(error)}|${messageOf(error)}`;
}

/**
 * The one failure already reported, as `screen|class|message`. MODULE-level, not a ref, because
 * React's retry re-mounts the whole tree — the boundary included — so per-instance state does not
 * survive the very repetition it would exist to suppress. One slot, not a growing set: a
 * different failure simply replaces it, and a reset clears it, so a screen that fails, is retried
 * and fails again is reported both times.
 */
let lastReported: string | null = null;

export default function ScreenBoundary({ screen, FallbackComponent, children }: Readonly<ScreenBoundaryProps>) {
  const renderFallback = useCallback(
    ({ error, resetErrorBoundary }: { error: unknown; resetErrorBoundary: () => void }) => {
      const failure = `${screen}|${signatureOf(error)}`;
      if (lastReported !== failure) {
        lastReported = failure;
        log.error(CHANNELS.screen, 'screen render failed', {
          screen,
          errorClass: errorClassOf(error),
          detail: messageOf(error),
          stack: stackOf(error),
        });
      }
      return <FallbackComponent error={error} screen={screen} resetErrorBoundary={resetErrorBoundary} />;
    },
    [FallbackComponent, screen],
  );

  const onReset = useCallback(() => {
    // A retry (or a screen change) starts a fresh attempt: the next throw is a new failure and is
    // reported again, even if it fails in exactly the same way.
    lastReported = null;
  }, []);

  return (
    <ErrorBoundary resetKeys={[screen]} onReset={onReset} fallbackRender={renderFallback}>
      {children}
    </ErrorBoundary>
  );
}
