# Contract: screen-observability-ui (chain-C → chain-E)

Interface only; rationale is `design.md` §D1/§D5. Chain-E does ALL wiring in `LauncherRoot.tsx`;
chain-C touched no wiring.

## `src/host/launcher/ScreenBoundary.tsx` (default export)

```ts
export interface ScreenFallbackProps {
  error: unknown;                    // the thrown value — never rendered raw to the user
  screen: string;                    // the failing screen's identifier
  resetErrorBoundary: () => void;    // clears the error state, remounts the failed subtree
}
export interface ScreenBoundaryProps {
  screen: string;                    // reset key AND failing-screen identifier (see below)
  FallbackComponent: ComponentType<ScreenFallbackProps>;
  children: ReactNode;
}
export default function ScreenBoundary(props: Readonly<ScreenBoundaryProps>): JSX.Element;
```

Usage chain-E writes (wrap the screen switch's `content` ONCE, inside `SafeAreaView`, per D1):

```tsx
<ScreenBoundary screen={screen.kind} FallbackComponent={ScreenErrorFallback}>{content}</ScreenBoundary>
```

- **`screen` is one prop doing both jobs**: it is the `resetKeys` entry (a changed value clears the
  error state, so navigating away and back re-attempts the screen) and the `screen` field in the
  log record. Pass the router's screen identity (`screen.kind`), nothing derived per render.
- **`FallbackComponent` is required, not defaulted.** The boundary imports NO `react-native`, which
  is what lets the Node acceptance suite really render it; a default fallback would drag RN in.
- **Report:** `log.error(CHANNELS.screen, 'screen render failed', { screen, errorClass, detail,
  stack })` — emitted in the boundary's render phase, i.e. BEFORE the fallback renders, not from
  `componentDidCatch`. `detail` is the message; `stack` may be `undefined` for a non-`Error` throw.
- **Reported once per failure:** React retries a failed render (re-mounting the tree, so the two
  throws are distinct `Error` objects with different internal stacks). Deduplication is by
  `screen|errorClass|message` in one module-level slot, cleared on every reset — so a retry that
  fails again IS reported again.
- The boundary catches render/lifecycle/effect-mount throws only. Event-handler and async throws
  are not caught by any React boundary; they still belong on the seam at their own call site.

## `src/host/launcher/ScreenErrorFallback.tsx` (default export)

```ts
export default function ScreenErrorFallback(props: Readonly<ScreenFallbackProps>): JSX.Element;
```

Takes exactly `ScreenFallbackProps` (so it is passable as `FallbackComponent` unchanged) and reads
only `resetErrorBoundary`. Full-screen, `shellPalette(useTheme().theme)` + `TYPE_SCALE`/`SPACING`/
`RADIUS`; no hex, no numeric font-size or radius literal; the thrown error never reaches the
surface.

## `src/host/launcher/DevLogOverlay.tsx` (default export)

```ts
export interface DevLogOverlayProps {
  visible: boolean;
  onClose: () => void;
  buffer?: LogRing;                  // defaults to the app seam's `log.buffer`
}
export default function DevLogOverlay(props: Readonly<DevLogOverlayProps>): JSX.Element | null;
```

Renders an RN `Modal` (`onRequestClose` → `onClose`, so Android back closes it) over
`View`/`Text`/`FlatList`; re-reads `buffer.snapshot()` each time `visible` turns true. Its labels
are developer strings held locally, NOT in `copy.ts` (same standing as `DevProbeScreen`).

**It gates itself:** `if (!devLogOverlayEnabled(__DEV__)) return null;`. Chain-E must ALSO gate the
affordance that opens it on the same predicate — the spec requires no affordance to render in a
shipping build, not merely a dead route.

## `src/host/launcher/dev-log-view.ts` (new, pure, no `react-native`)

```ts
export const SHOW_DEV_LOG_OVERLAY = false;          // THE build-time flag; default false
export function devLogOverlayEnabled(dev: boolean, flag?: boolean): boolean;  // dev || flag
export const ALL_CHANNELS_FILTER = 'all';
export interface DevLogFilter { channel: Channel | 'all'; minLevel: LogLevel }
export const DEFAULT_DEV_LOG_FILTER: DevLogFilter;  // { channel: 'all', minLevel: 'debug' }
export function visibleRecords(snapshot: readonly DevLogRecord[], filter?: DevLogFilter): readonly DevLogRecord[];
export function formatRecordTime(at: number): string;   // 'HH:MM:SS.mmm', UTC
export function formatFields(fields: Readonly<Record<string, unknown>>): string;
```

`visibleRecords` returns the snapshot filtered and reversed to newest-first, never mutating its
argument. The flag is flipped by hand in a local working copy (the `RUN_*_PROBE` idiom) and is
never committed as `true`.

## `copy.ts` keys added (additive only; three new keys, no existing key touched)

```ts
screenErrorTitle: 'This screen stopped working',
screenErrorBody: 'Nothing you made was lost. Try again, and it should come back.',
screenErrorRetry: 'Try again',
```

Only `ScreenErrorFallback` uses them. The overlay needs no `copy.ts` key.
