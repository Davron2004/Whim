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
export default function NativeStack(props: { entries: readonly StackEntry[] }): JSX.Element;
export function poppedEntry(top: number, dismissCount: number): number; // lowest popped index, ≥ 1
```

- `ScreenStack` + `ScreenStackItem` (react-native-screens 4.28.0), `activityState={2}`, `gestureEnabled` on
  every entry but the root. Root and title-less entries get `edges={['top','bottom']}`; titled ones `['bottom']`.
- iOS pop (header back, edge/content swipe, long-press menu) → `onDismissed(dismissCount)` → the lowest
  popped entry's `onLeave`. Android header back → `onHeaderBackButtonClicked` → `onLeave`. Android system
  back is NOT the stack's: each screen binds `useSystemBack(onLeave)` itself (LIFO listeners, top wins).
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
| history | `home, history` | hidden (History draws its own until 20.1) | `goHome`, then reopens the app when `from: 'app'` |
| report | `stackFor(from)` + `report` | "Report a problem" | `from` |

- Push = `setScreen(next)`; pop = the entry's `onLeave`. To add a pushed screen: a Screen member, a branch
  in `stackFor`, `stackTitle`, `leaveFor`, `renderStackScreen`, and `schemeFollowing` if it draws tokens.
- `schemeFollowing(top)`: settings/advanced/report draw `useTokens()` (header + `StatusBar` = `t.barStyle`);
  home/history/consent still draw `SHELL_PALETTE` and `dark-content`. Flip a kind when its screen moves.
- AI features row always opens review mode. Review's "Turn on AI features" runs the legal flow with
  continuation `{ kind: 'settings' }`; its consent step grants directly (`reviewedConsent`, #104).
- Root `SafeAreaView` edges: `frameEdgesFor(kind, onNativeStack)` → `[]` on the stack.
- `ToastHost` is mounted once in `LauncherRoot` around the screen boundary; `useToast()` works in every
  screen (Advanced uses it for "Phone ID copied").
- Done step still opens `ReportSheet` (host-level `reportTarget`) until 17.2 removes Report from Ready.

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
// ReportScreen (default) and ReportSheet (named; over a running app / Done until 19.2 and 17.2)
ReportScreenProps = { app: InstalledApp | null; access; options; onLeave; onUpdateRequired; legalLanguage }
ReportSheet: Omit<ReportScreenProps, 'onLeave'> & { onClose: () => void }   // app null = closed
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
`iosPop(tree, n)`, `androidHeaderBack`. `native-host.tsx` adds `Clipboard.copied`. Suites:
`native-stack-ui.suite.tsx` (new), `screen-controls`, `privacy-settings-ui`, `settings-screen`, `report-send`.
