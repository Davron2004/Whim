# Host startup watchdog contract

## Interface

`src/host/launcher/boot-state.ts` exports this React Native free seam:

```ts
export const STARTUP_DEADLINE_MS = 6_000;

export interface StartupDeadlineScheduler {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

export interface StartupDeadline {
  begin(): void;
  acceptPaint(frame: PaintFrame | null | undefined): boolean;
  cancel(): void;
}

export function createStartupDeadline(
  onTimeout: () => void,
  scheduler?: StartupDeadlineScheduler,
): StartupDeadline;
```

`begin()` replaces any active timer and fences its callback with a new attempt token.
`acceptPaint()` returns false without changing the timer unless `paintAccepted(frame)` passes.
Paint passes only when it is trusted and `mountToFirstPaintMs` is a finite, nonnegative number;
zero is valid. Accepted paint cancels the timer and returns true. Missing, null, string, `NaN`,
infinite, or negative timing leaves the deadline armed, so malformed trusted data cannot strand
the one-field `paintMs !== null` state on `Opening…`. `cancel()` is idempotent and invalidates
callbacks that the platform had already queued before timer cancellation.

## Host wiring

- `deliverBySource()` begins the deadline after source assembly succeeds and immediately before
  `control(js)`. Native startup failure can therefore reach the existing app-error state without
  any page frame.
- An accepted delivery frame calls `begin()` again, preserving the full six-second paint window.
- Bind/reset, fatal realm errors, trusted paint, retry, exit, and unmount cancel the active attempt.
- The timeout publishes `app never became visible` only while there is no earlier error and no
  trusted paint. It cannot replace a fatal error or a newer launch's state.
- Paint keeps its nonce-authentication check and has no host/iframe generation comparison.

Native WebView rules, CSP, bridge authority, iframe recreation, retry copy, and error UI are
unchanged.

## Verification contract

The fake-clock launcher tests cover a frame-free timeout, delayed accepted delivery and paint,
valid zero timing, malformed trusted timing through the existing app-error surface, untrusted
paint, reset/retry stale callbacks, cleanup, and fatal-error preservation. Source checks bind
those behaviors to the delivery, message, and lifecycle paths in `useMiniAppHost.ts`.

After merge and regate, the primary Release simulator confirmation uses normal `LauncherRoot`
with `RUN_NETDENY_PROBE=false`. Build the missing-rule control with native resource lookup set to
`WebViewNetworkDenyMissing`, open seeded Tip Splitter, and wait at least six seconds. The expected
result is the existing “This app ran into a problem” surface, with native missing-resource and
rule-list-unavailable logs. Restore the native lookup before the normal-rule confirmation. This
implementation chain performs no simulator interaction or native build.
