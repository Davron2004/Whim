/**
 * boot-state — which surface the mini-app container renders (`app-launcher`: "The mini-app
 * container shows a boot state before first paint").
 *
 * Pure, RN-free, and therefore directly Node-testable: `MiniAppView.tsx` cannot be imported under
 * the launcher's Node suite, so the branch ORDER — the part that is actually easy to get wrong —
 * lives here rather than as a chain of `if`s inside the component.
 *
 * No new host→realm signal exists for "the app is up": `paintMs` already carries the realm's
 * first-paint frame (`useMiniAppHost.ts`), so "has painted" is DERIVED from it and there is no
 * second source of truth to keep in sync (and no new bridge message).
 *
 * Precedence is load-bearing, not cosmetic: a launch refused pre-delivery, and a delivered app
 * that failed before it ever painted, are BOTH unpainted — so if the boot state outranked them
 * the user would sit in a permanent "opening" screen instead of the honest failure surface. The
 * failure surfaces therefore win, and the boot state is only what is left over.
 */

/** The four mutually-exclusive surfaces the container can show for one realm. */
export type MiniAppSurface = 'launch-failed' | 'app-error' | 'boot' | 'running';

export interface MiniAppSurfaceInput {
  /** `launchApp` refused this app pre-delivery (#41 D7) — nothing was ever delivered. */
  launchFailed: boolean;
  /** A post-delivery failure: a fatal bundle-`error` frame, or the paint watchdog firing. */
  lastError: string | null;
  /** `HostState.paintMs` — non-null exactly when the CURRENTLY bound realm reported first paint.
   *  `bind()` resets it, so a previous realm's paint can never suppress the next boot state. */
  paintMs: number | null;
}

/** First paint observed for the currently bound realm. The whole "has painted" signal. */
export function hasPainted(paintMs: number | null): boolean {
  return paintMs !== null;
}

/**
 * The surface to render. `boot` also covers the brief window BEFORE a realm is bound (the WebView
 * is mounted and loading its runtime HTML, `onLoadEnd` has not fired yet): that window shows the
 * exact blank WebView the requirement is about, and a boot state that blinked out and back in
 * across binding would be worse than one that simply spans the wait.
 */
export function miniAppSurface(s: Readonly<MiniAppSurfaceInput>): MiniAppSurface {
  if (s.launchFailed) return 'launch-failed';
  if (s.lastError) return 'app-error';
  return hasPainted(s.paintMs) ? 'running' : 'boot';
}

/** The shape of a `paint` bridge frame as it arrives from the outer page — untrusted data, so
 *  every field is optional and unknown until checked. */
export interface PaintFrame {
  /** Stamped `true` by the outer page only for a nonce-authenticated frame (constraint #4). */
  trusted?: unknown;
  /** The realm's own paint payload (`mountToFirstPaintMs`, `appName`) with `generation` stamped by
   *  the outer page to the host-bound `GEN` — unvalidated, so it stays an open bag of unknowns. */
  payload?: Record<string, unknown> | null;
}

/**
 * Whether a `paint` frame is the opening signal of the current launch, moving the boot state to
 * `running`. The frame must be nonce-authenticated (`trusted`, stamped by the outer page — the same
 * check the `probes` branch applies), so a bundle cannot post a `paint` for itself to skip its own
 * boot state. Its timing must also be a finite, nonnegative number: `paintMs !== null` is the
 * host's only painted-state signal, so accepting a frame that cannot populate it would cancel the
 * deadline while leaving the UI on `Opening…` forever.
 *
 * And it must belong to the current bind (design-system-v1 D4): `payload.generation` must equal
 * `boundGeneration`, the generation the host bound the live realm at, which the outer page stamps
 * onto every `paint` it forwards (as it does `nav-depth`). A reset recreates the iframe and rotates
 * the nonce (spike2 §5), but a frame already forwarded to RN can still be delivered after the next
 * bind; its older stamp keeps it from opening the new launch. `null` (no realm bound) accepts
 * nothing. The iframe-local `window.__whimGeneration` never reaches the host and is never compared.
 */
export function paintAccepted(frame: PaintFrame | null | undefined, boundGeneration: number | null): boolean {
  const paintMs = frame?.payload?.mountToFirstPaintMs;
  return frame?.trusted === true
    && boundGeneration !== null
    && frame.payload?.generation === boundGeneration
    && typeof paintMs === 'number'
    && Number.isFinite(paintMs)
    && paintMs >= 0;
}

/** Six seconds from an attempted source delivery, or from its accepted-delivery acknowledgement. */
export const STARTUP_DEADLINE_MS = 6_000;

/** Injected timer seam for deterministic Node tests; production uses the platform timers below. */
export interface StartupDeadlineScheduler {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

/** One currently bound realm's startup deadline. */
export interface StartupDeadline {
  /** Start, or restart, the allowance for the current attempt. */
  begin(): void;
  /** Complete startup only for the current bind's authenticated paint (`paintAccepted`). */
  acceptPaint(frame: PaintFrame | null | undefined, boundGeneration: number | null): boolean;
  /** Cancel the current attempt and invalidate a callback already queued by the platform. */
  cancel(): void;
}

const platformScheduler: StartupDeadlineScheduler = {
  set(callback, delayMs) {
    return setTimeout(callback, delayMs);
  },
  clear(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/**
 * Create a deadline whose callbacks are fenced by an attempt token. `clearTimeout` normally
 * prevents a cancelled callback, but the token also covers a callback that was already queued
 * when bind/reset, retry, exit, unmount, paint, or a fatal error cancelled its attempt.
 */
export function createStartupDeadline(
  onTimeout: () => void,
  scheduler: StartupDeadlineScheduler = platformScheduler,
): StartupDeadline {
  let handle: unknown | null = null;
  let attempt = 0;

  const cancel = (): void => {
    attempt += 1;
    if (handle !== null) {
      scheduler.clear(handle);
      handle = null;
    }
  };

  return {
    begin() {
      cancel();
      const ownedAttempt = attempt;
      handle = scheduler.set(() => {
        if (ownedAttempt !== attempt) return;
        handle = null;
        attempt += 1;
        onTimeout();
      }, STARTUP_DEADLINE_MS);
    },
    acceptPaint(frame, boundGeneration) {
      if (!paintAccepted(frame, boundGeneration)) return false;
      cancel();
      return true;
    },
    cancel,
  };
}
