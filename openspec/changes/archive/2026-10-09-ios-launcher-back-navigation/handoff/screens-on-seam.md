# Handoff: screens-on-the-seam (chain-2)

Every screen below dropped its own `BackHandler.addEventListener('hardwareBackPress', …)` and
`useEffect` for `useSystemBack(<identifier>)`, where `<identifier>` is the exact same identifier
also bound to the screen's visible control (the D8 "bound" rule chain-3 will scan for).

| Screen (file) | `useSystemBack(...)` argument | Visible control uses the same identifier |
|---|---|---|
| `ComposeStep.tsx` | `onBack` | `FlowHeader onBack={onBack}` |
| `ClarifyStep.tsx` | `onBack` | `FlowHeader onBack={onBack}` |
| `SettingsScreen.tsx` | `onBack` | chevron `onPress={onBack}` |
| `HistoryScreen.tsx` | `onBack` | chevron `onPress={onBack}` |
| `FailureScreen.tsx` | `onBack` | `Back to your apps` `onPress={onBack}` |
| `AppLinkMissingScreen.tsx` | `onBackToApps` | `Back to your apps` `onPress={onBackToApps}` |
| `PlanStep.tsx` | `handleBack` (new local fn, built from `planBackAction(editingIndex != null)`; cancels the open row edit or calls `onBack`) | `FlowHeader onBack={handleBack}` |
| `BuildStep.tsx` | `onBack` (the `onLeaveRunning` prop is REMOVED — one `onBack` prop drives both the hook and the button) | `Leave it running` `onPress={onBack}` |
| `DoneStep.tsx` | `onBackToApps` | `Back to your apps` `onPress={onBackToApps}` |
| `ConsentScreen.tsx` | `onClose` | unchanged — still renders from `consentScreenActions`/`pressHandlerFor`, per chain-1's adjudication; only the hook was added |

## `BuildStep` prop change
`BuildStepProps.onLeaveRunning` is deleted. `onBack: () => void` is now the ONE prop: `useSystemBack(onBack)`
and `Leave it running`'s `onPress` both call it. `LauncherRoot.tsx` passes only `onBack={onBuildBack}`
to `<BuildStep>` (the `onLeaveRunning={onLeaveRunning}` line was removed from that call site). The
standalone `onLeaveRunning` function in `LauncherRoot.tsx` is untouched and still used — it's read
through `onLeaveRunningRef.current()` inside `onBuildBack`, which is what `BuildStep` now calls for
both the button and system back.

## `SCREEN_EXITS` rows that differ from design D8's table, for chain-3 to correct
- **`consent`**: unchanged from chain-1's own reconciliation note — `ConsentScreen.tsx` still
  renders labels from `consentScreenActions`'s own `actionLabel` switch (`COPY.consentDecline`,
  `COPY.consentReviewKeepOn`, etc.), not from `consentControls`. Chain-1's handoff already pointed
  the row at `file: 'consent-flow.ts'` because that's where `consentControls`'s quoted-key table
  lives (for the "labelled" scanner rule's `component`/quoted-key check). If chain-3's scanner reads
  labels from the RENDERING file instead, the consent row's `file` should be `ConsentScreen.tsx`
  (where `COPY.consentDecline`/`COPY.consentReviewKeepOn` are literally referenced), not
  `consent-flow.ts`. Re-check both files together before writing the row.
- **`build`**: no row change — `buildLeaveRunning` is still the control's label, still in
  `BuildStep.tsx`. Only the prop plumbing changed, not the label or its file.
- **`plan`**: no row/label change — `component: 'FlowHeader'` in `PlanStep.tsx` still applies;
  `handleBack` is a new local identifier, not a new control.
- All other rows (`settings`, `history`, `link-missing`, `failure`, `compose`, `clarify`, `done`)
  match design D8 exactly: no file or label differs from what the table already says.

## Tests re-pinned (never deleted)
- `test/failure-screen.suite.ts` (was line 98): now asserts `useSystemBack(onBack);` is present and
  `BackHandler` is gone from the source, plus the existing non-imperative-`onDismiss` checks.
- `test/app-link-ui.suite.ts` (was line 114): now asserts `useSystemBack(onBackToApps);` and no
  `BackHandler` in `AppLinkMissingScreen.tsx`.
- `test/prompt-flow-screens.suite.ts` (was lines 557/570): the "Leave it running" case now checks
  `onPress={onBack}` instead of a bare `onLeaveRunning` reference; the hardware-back case now
  asserts `useSystemBack(onBack);` and no `BackHandler`, and that the old `onLeaveRunning`/`onCancel`
  props are both gone from `BuildStep.tsx`.
- `test/prompt-flow-wiring.suite.ts:458-479` (build-screen wiring in `LauncherRoot.tsx`) — untouched,
  stayed green: it already only checked `onBack={onBuildBack}` and the absence of a
  `hardwareBackPress` string in `LauncherRoot.tsx`, neither of which chain-2 touches.

## `flow-chrome.tsx`
`FlowHeader`'s `Back` `TouchableOpacity` `hitSlop` raised from `10` to `16` (D11). No style change.

## knip
Before this chain: `use-system-back.ts` reported as an unused file. After wiring it into all ten
screens above: gone. `npx knip` now reports only `SCREEN_EXITS`/`FALLBACK_EXIT` as unused exports —
expected, since chain-3's scanner is their first consumer.
