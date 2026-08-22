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
  /** The realm's own paint payload, forwarded verbatim (`mountToFirstPaintMs`, the iframe-local
   *  `generation`, `appName`) — unvalidated, so it stays an open bag of unknowns. */
  payload?: Record<string, unknown> | null;
}

/**
 * Whether a `paint` frame may move the boot state to `running`. ONE guard: the frame must be
 * nonce-authenticated (`trusted`, stamped by the outer page — the same check the `probes` branch
 * applies), so a bundle cannot post a `paint` for itself to skip its own boot state.
 *
 * Deliberately NOT generation-fenced, unlike `nav-depth`. Two independent reasons:
 *
 *  - A stale-realm paint cannot arrive: a realm reset RECREATES the iframe (spike2 §5), which
 *    tears down the old realm's window before the new one exists.
 *  - `payload.generation` is not comparable to the host's counter. The outer page re-stamps only
 *    `nav-depth` with the generation the host authoritatively bound (`GEN`); `paint` it forwards
 *    VERBATIM, so `payload.generation` is the iframe-local `window.__whimGeneration` — it starts
 *    at 0 and reaches 1 on the first delivery, while the host's `genCounter` starts at 1 and is
 *    pre-incremented per bind, so the first launch is 2. Comparing them rejects every real paint.
 */
export function paintAccepted(frame: PaintFrame | null | undefined): boolean {
  return !!frame && frame.trusted === true;
}
