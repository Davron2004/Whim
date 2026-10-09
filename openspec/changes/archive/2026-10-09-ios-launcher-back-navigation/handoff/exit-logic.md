# Handoff: exit-logic (chain-1)

## `system-back.ts` (RN-free)
```ts
export interface BackHandlerLike {
  addEventListener(eventType: 'hardwareBackPress', listener: () => boolean): { remove(): void };
}
export function bindSystemBack(api: BackHandlerLike, current: () => (() => void) | null): () => void;
```
Registers exactly one `hardwareBackPress` listener. On fire: `current()` is read fresh every
time; if it returns a handler, the handler runs and the listener returns `true`; if `null`, returns
`false` (falls through to the platform default). The returned function unsubscribes.

## `use-system-back.ts` (the only file besides `useMiniAppHost.ts` allowed to import `BackHandler`)
```ts
export function useSystemBack(handler: (() => void) | null): void;
```
Keeps `handler` in a ref assigned on every render; binds `bindSystemBack(BackHandler, () =>
ref.current)` in a mount-only effect (`[]` deps) whose cleanup unsubscribes. **Once-per-mount
rule**: call it exactly once per screen component, unconditionally, with the current handler —
never re-created conditionally or called more than once in one file (chain-3's "declared"/"bound"
scanner rules require exactly one call per `back: 'screen'` file, and that call's argument be a
bare identifier also bound to a pressable control in the same file).

## `prompt-flow.ts` additions
```ts
export function planBackAction(editingRow: boolean): 'cancel-edit' | 'leave';
```
`'cancel-edit'` while a row is being edited, else `'leave'`. `PlanStep` (chain-2) builds one
`handleBack` from this and passes it to both `useSystemBack` and `FlowHeader`.

## `consent-flow.ts` additions — reconciliation note (Class A)
Staging already carries D6's mode → actions decision as `consent-screen-actions.ts`
(`consentScreenActions(mode: ConsentScreenMode)`, `hasNonGrantingExit`), consumed by
`ConsentScreen.tsx`'s own `actionLabel`/`pressHandlerFor`. That table was **not** duplicated. Per
design D8's scanner text (which names `consentControls` as the "decision module returns keys"
example), `consentControls` is still needed as a thin adapter for `screen-exits.ts`'s labelled
consent row:
```ts
export interface ConsentControl {
  readonly action: 'agree' | 'close' | 'turn-off';
  readonly label: keyof typeof COPY;
}
export function consentControls(
  mode: 'ask' | 'review',
  consentOn: boolean,
): { primary: ConsentControl; plain: ConsentControl };
```
Built on `consentScreenActions` — maps its five `ConsentScreenAction` values through one literal
table (`agree`→agree/consentAgree, `decline`→close/consentDecline, `keepOn`→close/
consentReviewKeepOn, `turnOff`→turn-off/consentReviewTurnOff, `turnOn`→agree/consentReviewTurnOn).
Matches design D6's table exactly. **Chain-2 does not need to render from this** — `ConsentScreen.tsx`
already renders correctly from `consentScreenActions`/`consentScreenActions`'s existing consumers;
chain-2's task 2.5 only needs to add `useSystemBack(onClose)` there, not adopt `consentControls`.

**Final reconciliation (`ios-back-fixes` fix chain):** `consentControls`/`ConsentControl`/
`CONSENT_CONTROL_BY_ACTION` never gained a production consumer — the "thin adapter" above was
speculative — and were deleted, along with their `test/consent-flow.suite.ts` cases. The consent
row's "labelled" scan reads `ConsentScreen.tsx` directly (see `screen-exits.ts` below), and its
"bound" scan is satisfied by `ConsentScreen.tsx` binding `onClose` DIRECTLY, inline, in its
`decline`/`keepOn` `onPress` attributes, not through any decision-module adapter.

## `screen-exits.ts` (RN-free, `import type { COPY }` only)
Exports `ScreenKind` (13 members, matching `LauncherRoot.tsx`'s `Screen['kind']`), `ExitControl`,
`ScreenExit`, `SCREEN_EXITS`, `FALLBACK_EXIT`, `frameEdgesFor` — signatures verbatim from design D8.
**Reconciliation**: the `consent` row's controls point at `file: 'consent-flow.ts'` (`copy:
'consentDecline'`, `copy: 'consentReviewKeepOn'`), matching where `consentControls`'s quoted-key
table lives now — NOT `ConsentScreen.tsx`, even though `ConsentScreen.tsx` also currently contains
`COPY.consentDecline`/`COPY.consentReviewKeepOn` literals via its own `actionLabel` switch. Chain-2
must correct this row (its own writes-contract) if its final render shape differs; chain-3 applies
the correction.

`frameEdgesFor(kind)`: `['top']` for `app`/`dev`, else `['top', 'bottom']`.

## `ScreenBoundary.tsx`
`ScreenBoundaryProps.onLeave?: () => void` and `ScreenFallbackProps.onLeave?: () => void` added;
passed straight through, unchanged, from the boundary to the fallback element on every render
(including inside `renderFallback`'s memoized callback — `onLeave` is a dep).

## `copy.ts`
One new key: `screenErrorBack: 'Back to your apps'`, beside `screenErrorRetry`. No `consent…` key
added (privacy-page parity tripwire untouched).

## Tests added
`test/screen-exits.suite.ts` (new, registered in `test/acceptance.ts` as `runScreenExitsTests`):
`bindSystemBack` (registration-once-across-swaps, latest-handler-runs, true/false return,
unsubscribe), `frameEdgesFor` (all 13 kinds), `ScreenBoundary` `onLeave` pass-through
(given/absent/invoked-once/reset-still-works) via `react-test-renderer`. `planBackAction` cases
added to `test/prompt-flow-screens.suite.ts`. `consentControls` cases added to
`test/consent-flow.suite.ts` (one close per state; review-on's close is primary; review-off's
plain is close/consentDecline; ask's labels are consentAgree/consentDecline).

Chain-3's scanner (`scanScreenExits`) is not yet written — that is task 3.3, dispatched after
chain-2 moves every screen onto `useSystemBack`.
