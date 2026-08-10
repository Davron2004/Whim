# Contract: failure-screen (chain-D → chain-E)

Interface only; rationale is `design.md` §D7. Chain-E migrates the `LauncherRoot.tsx` call site.

## `src/host/launcher/FailureScreen.tsx`

```ts
export interface FailureScreenProps {
  /** The terminal `failure` event's `reason`, or a plain-English client/stream-error summary. */
  reason: string;
  /** Hint-only diagnostic detail — never `kind`/`symbol`/`message`. */
  diagnostics: readonly { hint: string }[];
  /**
   * How many repair attempts the device OBSERVED go past on the stream. Absent (or zero) hides
   * the attempt row entirely — a count is never invented for a run that never reached repair.
   */
  observedRepairAttempts?: number;
  /**
   * Whether the app already has a working version installed. Absent (or false) omits the
   * reassurance row — there is nothing honest to reassure about.
   */
  hasWorkingVersion?: boolean;
  /** True when a repair recovered the run; the title and panel take the success hue instead. */
  recovered?: boolean;
  /** Returns to the prompt screen with the user's text preserved. */
  onRephrase: () => void;
  /** Dismisses the failure screen (back to home). */
  onDismiss: () => void;
}
export default function FailureScreen(props: Readonly<FailureScreenProps>): React.JSX.Element;
```

BACKWARD COMPATIBLE: the four original props are unchanged, and the three new ones are optional.
An unmigrated call site keeps compiling and renders the checklist with no attempt row, no
reassurance row, and the failure hue.

### What an absent value means

| prop | absent | present |
| --- | --- | --- |
| `observedRepairAttempts` | attempt row is NOT rendered at all | row of `REPAIR_ATTEMPT_LIMIT` segments + "Tried N times" label |
| `hasWorkingVersion` | the `done` reassurance row is omitted from the checklist | the row is the first one |
| `recovered` | failure hue (`shellPalette.danger`) title + panel, `COPY.failureTitle` | success hue (`STATUS_COLORS.done`), `COPY.failureRecoveredTitle` |

`observedRepairAttempts` counts the `repair` stage transitions the DEVICE watched go past — it is
not a wire field, and `generation-contract` is untouched. A count `<= 0` is the same as absent.

## `src/host/launcher/copy.ts` — new exports

The row composition and the attempt geometry live beside the copy they read (an RN-free module, so
the launcher Node suite exercises them for real; `FailureScreen.tsx` itself cannot be imported
there). Chain-E does not need to call these — the screen does.

```ts
export type FailureRowKind = 'done' | 'bad' | 'wait';
export interface FailureRow { readonly kind: FailureRowKind; readonly text: string }

/** reassurance (iff hasWorkingVersion) → one `bad` row per hint → the `wait` advisory row. */
export function failureChecklistRows(input: {
  readonly diagnostics: readonly { hint: string }[];
  readonly hasWorkingVersion: boolean;
}): readonly FailureRow[];

export const REPAIR_ATTEMPT_LIMIT = 3;
export type AttemptSegment = 'spent' | 'current' | 'remaining';
/** `observed` spent, then one `current`, then `remaining`; clamped to [0, limit]. */
export function attemptSegments(observed: number, limit?: number): readonly AttemptSegment[];
/** "Tried once" / "Tried 3 times" — attempts used, never attempts left. */
export function attemptsUsedLabel(observed: number): string;
```

`FailureRow.text` is ALWAYS a diagnostic's `hint` or a `COPY` string. A diagnostic's `kind`,
`symbol` or `message` is unreachable from the screen by construction.

## `copy.ts` keys ADDED (no existing key touched)

- `failureRecoveredTitle: 'Fixed it'`
- `failureRowLastVersionWorks: 'The version you already had still works and is still installed'`
- `failureRowSayItDifferently: 'Describing it differently usually gets past this'`

`failureTitle`, `failureRephrase`, `failureDismiss` are still used. `failureHintsTitle` is now
unread (the bulleted list it headed is gone) but is left in place — no existing key was edited.

## `src/host/launcher/MiniAppView.tsx`

Props unchanged. Two internal changes chain-E should not re-do: the launch-failure stylesheet is
token-only (`TYPE_SCALE`/`SPACING`/`RADIUS`), and the WebView `onError` now calls
`log.error(CHANNELS.app, 'mini-app webview failed to load', { appId, code, detail, domain, url })`
instead of `console.log`.

## Error surface

None. Neither component throws, and neither reads anything that can fail; every branch is a pure
render of the props above.
