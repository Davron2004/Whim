## Context

The shell has no navigator. `LauncherRoot.tsx` holds one `useState` over a 13-member `Screen` union and renders one component per kind (research.md A "Relevant files", B "Full `Screen` kind list"). Each screen that wants Android's back button registers its own `BackHandler` listener. There are nine of those plus the mini-app host's, all no-ops on iOS.

The good news from the research is that the design already gave nearly every screen a visible way out that calls the same prop as its listener (research.md A "Visible controls that already match the listener"). The iOS problem is therefore narrower than "add back buttons everywhere". Three places can hold an iPhone user in place or behave differently from Android:

1. Consent review with AI features off shows only `Turn AI features on` (`ConsentScreen.tsx:120-128`).
2. The plan step's header `Back` discards an open row edit, while Android back cancels the edit first (`PlanStep.tsx:98-108` vs `:127`).
3. The error screen offers `Try again` only, so a screen that throws on every render is a dead end (`ScreenErrorFallback.tsx:16-32`; research.md B "Error fallback trap").

Two smaller gaps sit next to these. The done step has no listener, so Android back backgrounds Whim instead of going Home (B "Done step"). And in-flow buttons at the bottom of the screen get no bottom safe-area inset, because the root frame applies the top edge only (A "Safe area"). On an iPhone that should put `Leave it running`, `Back to your apps` and the flow's primary action partly over the home indicator. Nobody has measured it yet; chain-4 does.

Nothing today stops the next screen from shipping with only a hardware back listener. That's the part worth a check.

Constraints: no new dependency this sprint (compliance D16; `package.json` is Class 1), no restyle of designed screens, `COPY` strings stay under the product-verbs guard, and `public-generation-server` chain-15 fails any added or changed `consent…` string in `copy.ts` that the privacy page doesn't quote (B "Consent copy tripwire").

## Goals / Non-Goals

**Goals:**
- An iPhone user can leave every screen and sheet by tapping something visible.
- System back and the visible control do the same thing on every screen, in every state, through one handler.
- Adding a screen without a visible exit fails the fast gate.
- The spec says what the product does: the orb is the exit from a running mini-app.

**Non-Goals:**
- An iOS edge-swipe gesture (D3).
- A host-side way to pop a mini-app's own screen stack on iOS (D5).
- A navigation library, a shared header component, or any visual redesign.
- The `launcher-polish-fixes` batch (⚙ glyph, tile accessibility labels, dev probe fixtures and the rest).

## Decisions

### D1. One shared seam and a declared exit table, not a shared header
Every screen keeps the control its design gives it. What becomes shared is the wiring: a `useSystemBack(handler)` hook that every screen calls instead of writing its own listener, and a React Native-free table in `screen-exits.ts` that declares each `Screen` kind's exit.

I considered a shared `ScreenHeader` with a chevron on every screen. It would restyle the failure, done, consent and link-missing screens, whose designs put the exit at the bottom as a destination (`Back to your apps`), and it would give those screens two exits. The research also shows the risk isn't how the controls look. It's the listener and the control drifting apart, as they already did on the plan step. One handler per screen, passed to both, fixes that; a shared look doesn't.

Keeping nine hand-written listeners was the other option. They're identical boilerplate, they re-register on every render for compose, clarify and plan (B "Listener churn"), and there's no stable syntax a check could hold on to.

### D2. The same controls on both platforms
No `Platform.OS` branch. The controls already render on Android and match the design there, so an iOS-only variant would add code and mean the Android emulator runs no longer cover what iPhone users see.

### D3. No edge-swipe back in this change
A swipe from the left edge is what iOS users expect, and I'd like Whim to have it eventually. It doesn't fit this change for four reasons:

- Over a running mini-app, `WKWebView` takes the touches natively, so a JavaScript responder never sees the pan. Doing it there needs native code or `react-native-gesture-handler`.
- On shell screens, a root `PanResponder` would compete with scroll views and text fields, couldn't drive an interactive transition, and on Android would fight the system back gesture, so it would need a platform branch anyway.
- A gesture library is a `package.json` bootstrap plus a pod install, days before the submission.
- App Review and the HIG ask for a visible way back. The swipe is what `UINavigationController` gives an app for free, and Whim doesn't use one.

Revisit if the shell ever moves onto a native stack navigator.

### D4. Flow steps step back; they never cancel
Back on compose, clarify and plan stays `prompt-flow.ts#backFrom` (plan to clarify to compose to Home, state kept), for the header `Back` and system back alike.

The plan step gets `planBackAction(editingRow: boolean): 'cancel-edit' | 'leave'` in `prompt-flow.ts`, beside `buildBackAction`. `PlanStep` builds one `handleBack` from it and passes that to both `useSystemBack` and `FlowHeader`, so a tap on `Back` mid-edit cancels the edit like Android back does.

The build step takes a single `onBack` for both its listener and `Leave it running`, and loses its separate `onLeaveRunning` prop. That's safe because the details sheet's scrim covers the button whenever the sheet is open (research.md B "Details sheet"), so the button can only ever be tapped in the state where `onBuildBack` means "leave". The run is never cancelled from back.

The done step calls `useSystemBack(onBackToApps)`, so Android back matches `Back to your apps`.

I rejected a flow-level close (an `✕` that abandons the flow from clarify or plan). Home is at most three `Back` taps away, and a one-tap abandon would throw away answers and plan edits, so it would need a confirmation of its own. That's a second exit with its own meaning, for no stuck user.

### D5. A running mini-app is left through the orb; no host pop on iOS
The orb's `Home` path never touches `BackHandler` or the back policy (research.md A "Running mini-app"), so leaving a mini-app already works on iOS. What iOS lacks is a host-triggered pop of the app's own screen stack. A generated app that pushes a screen and draws no back button of its own is degraded on iOS, not trapped: `Home` exits, and its data persists.

The alternative was an orb `Back` row shown while the app reports depth above zero, feeding `policy.backPress()`. I left it out. Depth is an untrusted hint, so a hostile app could show a `Back` row that does nothing. It changes the orb's action set, which `app-launcher` specifies and instruments. And none of the seeded examples push screens. It's an open question below.

`mini-app-back-navigation`'s "A floating affordance offers an always-available exit" still describes the retired draggable, dimming button (research.md A "Constraints"). It's rewritten to describe the orb, keep its header, and name `Home` as the guaranteed exit where there's no system back.

### D6. Consent review renders its two buttons from one pure function
`consent-flow.ts` gains `consentControls(mode, consentOn)`, returning `{ primary, plain }`, each `{ action: 'agree' | 'close' | 'turn-off'; label }` with `label` typed as a `COPY` key:

| State | primary | plain |
|---|---|---|
| ask | `agree` / `consentAgree` | `close` / `consentDecline` |
| review, on | `close` / `consentReviewKeepOn` | `turn-off` / `consentReviewTurnOff` |
| review, off | `agree` / `consentReviewTurnOn` | `close` / `consentDecline` |

`ConsentScreen` always renders both buttons through a local `ConsentAction` component that receives the control plus `onAgree`, `onClose` and `onTurnOff` as props and picks the handler by `action`, and the screen calls `useSystemBack(onClose)`. Passing `onClose={onClose}` as a JSX prop is what lets D8's "bound" rule see it. Review-off's `close` is `onConsentReviewClose` (`LauncherRoot.tsx:838`): back to Settings, consent unchanged, no request.

`Not now` reuses `COPY.consentDecline`. It reads right under `Turn on AI features`, and a new `consent…` string would trip chain-15's privacy-page parity check for a label that discloses nothing. A header chevron in review mode was the other option; in review-on it would sit beside `Keep AI features on` as a second exit with the same meaning.

### D7. The error screen offers a way home
`ScreenBoundaryProps` and `ScreenFallbackProps` gain `onLeave?: () => void`, which the boundary passes straight through. `ScreenBoundary` stays free of React Native and of the router. `LauncherRoot` passes `onLeave={goHome}` whenever `SCREEN_EXITS[screen.kind].back !== 'root'`. That read is also the typecheck's coverage guarantee (D8). `goHome` changes `screen.kind`, which is already the boundary's reset key.

`ScreenErrorFallback` renders a small child component only when `onLeave` is present. The child calls `useSystemBack(onLeave)` and renders a plain `Back to your apps` (new `COPY.screenErrorBack`) under `Try again`. Mounting it conditionally keeps the hook call unconditional inside the child. On Home the fallback keeps `Try again` alone and Android back keeps its default.

### D8. The exit table and the check that enforces it
`src/host/launcher/screen-exits.ts` (React Native-free, `import type` of `COPY` only):

```ts
export type ScreenKind = 'home' | 'app' | 'dev' | 'settings' | 'history' | 'link-missing' | 'consent'
  | 'compose' | 'clarify' | 'plan' | 'build' | 'done' | 'failure';
export type ExitControl =
  | { file: string; copy: keyof typeof COPY }        // a COPY label rendered in `file`
  | { file: string; component: 'FlowHeader' }        // the shared flow header rendered in `file`
  | { file: string; literal: string };               // dev-only screens with no COPY entry
export interface ScreenExit {
  /** Who answers system back: the screen's own component through useSystemBack, the mini-app
   *  back policy (useMiniAppHost), or nobody (the root). */
  back: 'screen' | 'mini-app' | 'root';
  /** The component that calls useSystemBack (back === 'screen'), else null. */
  file: string | null;
  controls: readonly ExitControl[];
}
export const SCREEN_EXITS: Readonly<Record<ScreenKind, ScreenExit>>;
export const FALLBACK_EXIT: { file: 'ScreenErrorFallback.tsx'; controls: readonly ExitControl[] };
export function frameEdgesFor(kind: ScreenKind): readonly ('top' | 'bottom')[];
```

Rows (files relative to `src/host/launcher/`):

| kind | back | file | controls |
|---|---|---|---|
| home | root | null | none |
| app | mini-app | null | `orb-actions.ts` `orbActionHome`; `MiniAppView.tsx` `launchFailedBack` |
| dev | mini-app | null | `DevProbeScreen.tsx` literal `‹ Home` |
| settings | screen | `SettingsScreen.tsx` | `backLabel` |
| history | screen | `HistoryScreen.tsx` | `backLabel` |
| link-missing | screen | `AppLinkMissingScreen.tsx` | `appLinkMissingBack` |
| consent | screen | `ConsentScreen.tsx` | `consent-flow.ts` `consentDecline`, `consentReviewKeepOn` (D6) |
| compose, clarify, plan | screen | `ComposeStep.tsx`, `ClarifyStep.tsx`, `PlanStep.tsx` | component `FlowHeader` |
| build | screen | `BuildStep.tsx` | `buildLeaveRunning` |
| done | screen | `DoneStep.tsx` | `doneBackToApps` |
| failure | screen | `FailureScreen.tsx` | `failureBack` |

A control's `file` is where its label is referenced, which isn't always the screen's own file: the orb's labels live in `orb-actions.ts` and consent's in `consent-flow.ts`. Where a control in the table names no file, it's the screen's own `file`.

**Coverage is a type error.** `LauncherRoot` reads `SCREEN_EXITS[screen.kind]` (D7). Under the strict config, a `Screen` kind missing from `ScreenKind` can't index the record, so `tsc` fails in the fast gate.

**The suite.** `test/screen-exits.suite.ts` holds a pure scanner over a `{ fileName: source }` map of the top-level, non-test `.ts`/`.tsx` files in `src/host/launcher/`. It returns `{ rule, file }` violations for five rules:

- **seam:** only `use-system-back.ts` and `useMiniAppHost.ts` import `BackHandler` from `react-native` or call `BackHandler.addEventListener`. (Comments that mention `BackHandler`, like `SheetModal.tsx:11-12`, don't count.)
- **declared:** every file other than `use-system-back.ts` that contains `useSystemBack(` is a row's `file` or `FALLBACK_EXIT.file`, and every `back: 'screen'` row's file calls it exactly once.
- **bound:** that call's argument is a bare identifier, and the same identifier appears inside an `on[A-Z]…={…}` JSX attribute in that file.
- **labelled:** every control's label appears in its file (a `copy` control as `COPY.<key>`, or as the quoted key `'<key>'` where a decision module returns keys, as `consentControls` does; a `literal` verbatim; a `component` as `<FlowHeader`), and `flow-chrome.tsx` contains `COPY.backLabel`.
- **real kinds:** every table key appears as `kind: '<key>'` in `LauncherRoot.tsx` or `prompt-flow.ts`.

The real tree must return no violations, and one inline fixture per rule must return exactly that violation. The fixture for "bound" is the plausible weaker refactor, not a deleted call: a plan step that passes `handleBack` to the hook but `onBack` to `FlowHeader`.

These are source assertions, which this repo accepts only when they lock a standing invariant (`docs/harness.md`, test classification). This one reads sensibly to someone who never saw the diff: no screen is left only by hardware back. The behavior inside each screen is tested on the pure functions (D4, D6, D9, D10) and on device (chain-4), not by grepping.

### D9. The hook: bind once, call the latest handler
`system-back.ts` (React Native-free) exports `BackHandlerLike` and `bindSystemBack(api, current: () => (() => void) | null): () => void`. It registers one `hardwareBackPress` listener that runs `current()` and returns `true`, or returns `false` when `current()` is `null`, and returns the unsubscribe. `use-system-back.ts` wraps it: `useSystemBack(handler: (() => void) | null)` stores the handler in a ref on every render and binds in a mount-only effect. This is the same idiom `onBuildBack` already uses to stop listener re-registration (`LauncherRoot.tsx:1346-1350`); the hook makes it the default for every screen.

### D10. The root frame applies the bottom inset, except where a screen owns it
`frameEdgesFor(kind)` returns `['top']` for `app` and `dev`, and `['top', 'bottom']` for every other kind. `LauncherRoot`'s `SafeAreaView` takes `edges={frameEdgesFor(screen.kind)}`. While `ready` is false, `screen.kind` is `home`, so the skeleton gets both edges.

Doing this once at the root beats adding `useSafeAreaInsets().bottom` to ten bottom buttons. Absolutely positioned children of the frame that set their own offsets, such as `RunDetailsSheet`'s scrim and the dev log button, are placed against the frame's border box and ignore its padding, so their own inset math doesn't change. Sheets on RN `Modal` render in their own window. A running mini-app is excluded because `MiniAppView`'s root is an in-flow child: padding the frame would shrink that box and lift the orb, which already adds `insets.bottom` itself, by the inset twice. `DevProbeScreen` uses RN's own `SafeAreaView`, which would double the inset on iOS.

### D11. The flow header's Back meets the 44-point touch target
`FlowHeader`'s `Back` is 13-point text with `hitSlop={10}`, about 33 points tall to a finger. Raising `hitSlop` to 16 makes it 45 with no visual change. The Settings and History chevrons are already 42×42 with 10 of slop.

## Risks / Trade-offs

- [The scanner is regex over source and can be refactored around] → it checks a stable hook call and JSX attribute names, not implementation lines, and each rule is proven against a fixture of the weaker variant. The per-screen behavior lives in pure-function tests.
- [The bottom inset moves Android screens too, if Android reports one] → that's the fix on Android 15 edge-to-edge as well. Chain-4 screenshots both platforms and looks for any control that moved into a worse place.
- [`BuildStep` losing `onLeaveRunning` depends on the scrim covering the button] → checked in research.md B; if a tap somehow lands, it closes the sheet rather than cancelling anything.
- [Consent copy tripwire] → no new `consent…` string (D6); the only new key is `screenErrorBack`.
- [A generated mini-app with sub-screens and no back button is awkward on iOS] → not a trap (D5); raised as an open question with a default.
- [Editing `LauncherRoot.tsx` alongside other launcher work] → chains 2 and 3 edit it; the `launcher-polish-fixes` batch's F9 also edits one line of it. Merges are serial with a regate, so a textual conflict there is small and caught at merge.

## Migration Plan

1. Chains 1 to 3 dispatch in order onto `integration/store-launch`, only after `store-launch-compliance` chains 6 and 7 have merged (chains.md).
2. Chain-4 is the attended walk. It can share the device session with `platform-release-readiness` chain-12 on the iPhone.
3. Rollback is reverting the chain merges. No persisted state changes.

## Open Questions

- **An orb `Back` row while a mini-app reports depth above zero?** Default: no (D5). Revisit if TestFlight users get stuck in generated sub-screens.
- **Should generation require a visible `nav.back()` control on every pushed screen** (a prompt rule plus an SDK lint in `checks/passes/`)? Default: out of this change; it's a server and static-checks change of its own.
- **Edge swipe later?** Default: only with a native stack navigator, never as a JavaScript gesture (D3).
- **Android back on the done step now goes Home instead of backgrounding Whim.** Default: yes, to match the visible control.
- **Bottom inset on Android.** Default: apply it on both platforms and let chain-4's emulator screenshots confirm nothing regressed.
