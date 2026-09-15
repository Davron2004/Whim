# service-notice (chain-4)

## `ServiceNotice.tsx` — `src/host/launcher/`

```ts
export interface ServiceNoticeProps {
  hint: string;           // the refusal's own hint, verbatim — never a code/status/Retry-After/transport message
  retryLine?: string;     // the copy-table retry-window line (service-refusal.ts#retryLine), precomputed by the
                           // caller; absent renders no second line
  tone: 'danger' | 'neutral'; // from service-refusal.ts#REFUSAL_RULES
}
export default function ServiceNotice(props: Readonly<ServiceNoticeProps>): JSX.Element;
```

Plain `Text`, never `WhimProse` — the hint is neither COPY nor user/agent prose. Tokens only
(`SHELL_PALETTE`, `RADIUS`/`SPACING`/`TYPE_SCALE` from `../../sdk/theme`); the danger tone tints via
two alpha-suffixed `SHELL_PALETTE.danger` reads, never a second hex literal. Render it directly
above the screen's primary action, outside the step's own scroll content (`marginHorizontal:
SPACING.lg` matches `flow-chrome.tsx#PrimaryAction`'s own inset).

## `useRetryGate` — same file

```ts
export function useRetryGate(retryAt: number | undefined): boolean; // true while disabled
```

A live retry-window gate for a mounted screen: reads `refusal-landing.ts#retryWindowState` once on
mount/`retryAt` change, arms exactly ONE `setTimeout` to re-check when the window lifts (never a
ticking countdown, never a request of its own), and returns the current `disabled` verdict. `retryAt
=== undefined` always reads `false` (nothing to gate). Any caller gating a primary action on a
refusal's window uses this hook — don't hand-roll a second timer.

**Wiring rule the four call sites (`ComposeStep`/`ClarifyStep`/`PlanStep`/`FailureScreen`) all
follow:** `const gated = useRetryGate(notice?.retryAt); ... enabled={!gated}` (compose additionally
ANDs its own text-length check; the failure screen's Retry button gets `disabled={gated}` plus the
same muted-tone restyle `gated` already drives, not a boolean prop rename). The action's label never
changes — only its enabled/disabled state.

## `refusal-landing.ts` — pure, RN-free

```ts
export type RefusalRequest = 'clarify' | 'rewrite' | 'generate';
export type RefusalSentFrom = 'compose' | 'clarify' | 'plan';

export function refusalLanding(request: RefusalRequest, sentFrom: RefusalSentFrom, code: ServiceRefusalCode):
  'compose' | 'clarify' | 'plan';
// design D9: request === 'generate' -> 'plan' always. Otherwise REFUSAL_RULES[code].landing === 'text'
// -> 'compose'; 'sender' -> sentFrom verbatim. Reads service-refusal.ts#REFUSAL_RULES — never a second table.

export interface RetryWindowState { readonly disabled: boolean; readonly msUntilEnable: number; }
export function retryWindowState(retryAt: number | undefined, now: number): RetryWindowState;
// retryAt undefined, or now >= retryAt -> { disabled: false, msUntilEnable: 0 }. Otherwise
// { disabled: true, msUntilEnable: retryAt - now }.
```

## `FlowNotice` — `prompt-flow.ts`, carried on `ComposeScreen`/`ClarifyScreen`/`PlanScreen`

```ts
export interface FlowNotice {
  readonly hint: string;
  readonly tone: 'danger' | 'neutral';
  readonly retryAt?: number;    // epoch ms; absent when the refusal carried no Retry-After
  readonly retryLine?: string;  // precomputed once, at the moment the notice was created
}
```

Each of `ComposeScreen`/`ClarifyScreen`/`PlanScreen` gained an optional `notice?: FlowNotice` field;
the `failure`-kind `Screen` member in `LauncherRoot.tsx` gained the same field (only ever set for a
refused Retry, never resurrected from a hydrated ghost — the window is not persisted). `tone` is the
clearing key: `danger` (a text-landing refusal, about the words themselves) clears on the next edit;
`neutral` (a sender-landing refusal) survives an edit and clears only by leaving the step or a fresh
navigation replacing the screen outright.

```ts
export function composeTextChanged(screen: ComposeScreen, text: string): ComposeScreen;
// updates text; drops screen.notice iff its tone is 'danger'.
```

`updatePlanRow` (existing signature, unchanged) applies the identical drop-iff-`danger` rule to
`notice` alongside its existing `rows`/`edited` update — reuse that rule rather than re-deriving it.

## Building a notice — `LauncherRoot.tsx`-local, not exported

`noticeFrom(refusal: ServiceRefusal): FlowNotice` (private) reads `REFUSAL_RULES[refusal.code].tone`
and, only when `retryAtOf(refusal, now)` is defined, adds `retryAt` and one `retryLine(...)` call
through a `formatLocalTime` `Intl.DateTimeFormat` formatter. Any later chain building its own notice
(e.g. a report-sheet refusal) should follow the same shape rather than inventing a second one.

## For chain-5 (report sheet) and later chains

`ServiceNotice`/`useRetryGate` are general-purpose — the report sheet's own refusal (design D14)
renders through the same component and gate, keyed off its own `FlowNotice`-shaped value (the sheet
does not carry a `prompt-flow.ts` screen, so it holds its own `notice`/`retryAt` state locally rather
than importing `FlowNotice`). `refusalLanding`/`retryWindowState` stay specific to the five-step flow
and pending-builds' D10 split; a non-flow surface needing only the window arithmetic should import
`retryWindowState` directly rather than `refusalLanding`.
