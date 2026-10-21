# Contract: navigation (chain-14)

Interface only. Rules: design.md D6/D7, system.md §9 (four kinds of surface), spec launcher-screen-exits.

## The stack — `src/host/launcher/NativeStack.tsx`

```ts
export interface StackEntry {
  readonly key: string;          // stable while on the stack (LauncherRoot uses the screen kind)
  readonly title?: string;       // native header title; absent = header hidden, screen draws its own + back
  readonly largeTitle?: boolean; // iOS large title (Settings only)
  readonly onLeave: () => void;  // the ONE leave handler: header back, swipes, system back
  readonly background: string;   // screen + header background
  readonly foreground: string;   // header title / back tint
  readonly children: React.ReactNode;
}
export default function NativeStack(props: { entries: readonly StackEntry[]; onSettled?: () => void; backOverlaid?: boolean }): JSX.Element;
export function poppedEntry(top: number, dismissCount: number): number; // lowest popped index, ≥ 1
```

- `ScreenStack` + `ScreenStackItem` (react-native-screens 4.28.0), `activityState={2}`, `gestureEnabled` on
  every entry but the root. Root and title-less entries get `edges={['top','bottom']}`; titled ones `['bottom']`.
- iOS pop (header back, edge/content swipe, long-press menu) → `onDismissed(dismissCount)` → the lowest
  popped entry's `onLeave`. Android header back → `onHeaderBackButtonClicked` → `onLeave`. Android system
  back is NOT the stack's: each screen binds `useSystemBack(onLeave)`; only the top entry's answers (`SystemBackOnTop`:
  false when covered, or on all while `backOverlaid`, the age check). Outside the stack (sheets via `onRequestClose`,
  MakingSheet, FirstRunHost, AgeCheckBack, ScreenErrorFallback, the running app's BackHandler) it is the default, true.
- `onSettled` = `ScreenStack`'s `onFinishTransitioning`: a push or pop the platform drew has finished (iOS
  `didShowViewController`; Android the fragment animation's end, read from source, not run on a device).
- **Invariant: `onLeave` must move the machine off its entry synchronously** (no await first). An entry
  still rendered after the platform popped it is pushed again.
- A running app, the making flow, the legal ask screens and full screens are never entries.

## Machine — `LauncherRoot.tsx`

```ts
type HistoryScreenState = { kind: 'history'; app: InstalledApp; from: 'home' | 'app' };
// added Screen members:
| { kind: 'advanced' }
| { kind: 'report'; app: InstalledApp | null; from: { kind: 'settings' } | HistoryScreenState }
type StackScreen = Extract<Screen, { kind: 'home'|'settings'|'advanced'|'history'|'report' }>
                 | Extract<Screen, { kind: 'consent'; mode: 'review' }>;
function stackFor(screen: Screen): readonly StackScreen[] | null;  // root first; null = not on the stack
```

| Screen | Stack (`screenId`s) | Header | Leaves to |
|---|---|---|---|
| home | `home` | hidden | — |
| settings | `home, settings` | "Settings", large | `goHome` |
| advanced | `home, settings, advanced` | "Advanced" | settings |
| consent review (AI features) | `home, settings, consent` | "AI features" | settings |
| history | `home, history` | hidden, for good: History draws its own (Back + `Report`) | a swipe: `leaveHistory`; its Back and system back: see "History's leave" |
| report | `stackFor(from)` + `report` | "Report a problem" | `from` |

- Push = `setScreen(next)`; pop = the entry's `onLeave`. To add a pushed screen: a Screen member, a branch
  in `stackFor`, `stackTitle`, `leaveFor`, `renderStackScreen`.
- Every stack entry's header and the `StatusBar` follow the live `useTokens()` (`t.colors.bg`/`text`; bar: `statusBarStyleOver`).
- AI features row always opens review mode. Review's "Turn on AI features" runs the legal flow with
  continuation `{ kind: 'settings' }`; its consent step grants directly (`reviewedConsent`, #104).
- Root `SafeAreaView` edges: `frameEdgesFor(kind, onNativeStack)` → `[]` on the stack.
- `ToastHost` is mounted once in `LauncherRoot` around the screen boundary; `useToast()` works in every screen.

## History's leave (`LauncherRoot.tsx`)

History's `onLeave` (a swipe: `onDismissed`) is `leaveHistory(app, from)`: `goHome()` at once (UIKit already popped),
then `onOpen(app)` when `from === 'app'`, at the version now current. Its own Back and system back are bound apart:
- Opened over an app: `backFromHistoryToApp(app)`. Never Home first; History stays until `onOpen` has replaced it with
  the app in one step. Failed open: alert, then Home. Refused open (the app is busy with a copy): Home. A second Back
  or system back while THAT app's `open` is in flight (`appOps.opFor(app.id) === 'open'`) is ignored. Android back
  while the Whim sheet still slides away reaches its `Modal`, not `BackHandler`: `closeSheet` on `history` = its Back.
- Opened from Home: `backFromHistoryToHome` = `startStackPop()`, then `goHome()` (a JS pop UIKit animates). An `onOpen`
  or app link arriving meanwhile waits for `POP_FALLBACK_MS` (1000 ms) or the pop's own `onSettled`: `onStackSettled`
  first ends the oldest push still drawing (`stackPushes`: a deeper stack on a non-empty one is a push; a stack mounted
  afresh is none), so it waits `1 + pushes drawing`. Only the latest waiter runs (earlier: `false`). Swipes: no hold.
- **Never pop the stack and then replace or unmount it (an app opening) within the pop's animation**: react-native-screens
  recycles the stack with the pop unfinished and the next Home is blank for good (iOS).

## Exit table — `screen-exits.ts`

`ScreenKind` += `'advanced' | 'report'` (both `{ back: 'screen' }`). `screen-controls.suite.tsx` cases take
`label: string | 'native header'`; a native-header case renders the screen in `NativeStack` and checks
`headerBackShown`, `iosPop`, `androidHeaderBack` and `hardwareBack` all run the same leave.

## Screens

```ts
// SettingsScreen
{ onBack; onOpenAIFeatures; legalLanguage; onLegalLanguageChange; version?: string; onReportProblem; onOpenAdvanced }
// AdvancedScreen
{ onBack; errorDetails; onErrorDetailsChange; deviceId; onResetDeviceId; serverChoice: ServerChoice;
  ownServerAcknowledged; onAcknowledgeOwnServer: () => void; onChooseServer: (c: ServerChoice) => void;
  savedAddress?: string; onServerUrlChange; canProbe; probe: SessionProbe | null; legalLanguage }
// ReportScreen (default: on the stack) and ReportPage (named: a page of the Whim sheet over a running app)
ReportScreenProps = { app: InstalledApp | null; access; options; onLeave; onUpdateRequired; legalLanguage }
```

- `server-address.ts`: `type ServerChoice = 'whim' | 'own'`, `serverChoice(kv)`, `chooseServer(kv, c)`
  (key `whim.server-choice:v1` = `'whim'`); `serverOverride` honours the address only for `'own'`.
  Choosing Whim's server keeps the address. `clearServerUrl` is gone.
- `settings-sections.ts`: `middleTruncated(id)`, `versionLabel(read)`, `SessionProbe {address; result}`,
  `addressCheck(canProbe, draft, probe)`. Advanced never probes; `LauncherRoot` records the session
  connectivity probe's result (`lastProbe`) — one probe per typing pause (#130). `DebouncedProbe` deleted.
- `GroupedList` `RowTrailing` += `{ kind: 'check'; checked: boolean }` (role `radio`).
- `keyboardOverlap` clamps `frameBottom` to the window (a frame measured mid-push on Android sat below it).
- Report copy (#153): `reportCodeLine(ownServer?)`, `reportThanksLine(ownServer?)` name no company on the
  user's own server. `reportDraftFor(null, access)` = a report with no app (Settings).

## Android predictive back (D7)

Verified on API 37, gesture nav: no preview with or without `enableOnBackInvokedCallback` (RN's always-on
callback; classic stack has no progress handling). Flag left off; issue #164. Pops work on every path.

## Tests

`native-screens.tsx` (alias for `react-native-screens`): `stackIds`, `stackItems`, `headerBackShown`,
`iosPop(tree, n)`, `androidHeaderBack`; its `ScreenStack` models iOS moves (a JS-changed top starts one, `iosPop`
does not): `stackUnmountsMidMove()` counts unmounts during one, `stackMoveEnds()` (async) ends it and fires
`onFinishTransitioning`. `native-host.tsx` adds `Clipboard.copied`. Suites: `native-stack-ui.suite.tsx` (new),
`screen-controls`, `privacy-settings-ui`, `settings-screen`, `report-send`, `history-ui` (the leave rules above),
`launcher-stress-ui` (asserts `stackUnmountsMidMove()` is unchanged by every step).
