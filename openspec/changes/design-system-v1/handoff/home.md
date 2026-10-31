# Contract: home (chain-15)

Interface only. Rules: spec app-launcher (tiles, menus, grid, offline, delete, forking), system.md §3.2/§9.
Pure logic is Node-importable (no RN import); everything is under `src/host/launcher/` unless noted.

## Tile state model

```ts
// ui/AppTile-states.ts
type TileState = 'ready' | 'making' | 'queued' | 'failed' | 'stopped' | 'needs-update'
               | 'changing' | 'change-failed' | 'older';
tileLook(state): { plate: 'tint'|'ember-soft'|'fill'; ember?: 'working'|'waiting'|'out'; badge; ring }
stateLine(state, { example?, copy?, count? }): { text; color: ColorRole } | null   // ready: Example / Copy / none
tileAccessibilityLabel(name, line): string      // "Pour Timer, making"; name '' = the line alone
tileAccessibilityHint(state): string
// grid-composition.ts
type GridCell = AppCell | AttemptCell | OlderCell;
AppCell     { kind:'app'; state:'ready'|'changing'|'change-failed'; app: InstalledApp; rebuild?: PendingBuildRecord }
AttemptCell { kind:'attempt'; state:'making'|'queued'|'failed'|'stopped'|'needs-update'; rec; name }
OlderCell   { kind:'older'; recs: readonly PendingBuildRecord[] }
composeGrid(pending, apps, { now, queued?, deletedApps?, discardedAttempts? }): GridCell[]
searchCells(cells, query); SEARCH_FROM_APPS = 13; ATTEMPT_RECENT_MS = 1 day; attemptName(rec); cellKey(cell); cellName(cell)
```

Record to state: `building` -> making (queued when its id is in `queued`); `interrupted` -> stopped; `failed` with
`remedy.kind==='update'` -> needs-update, else failed. A record with `editingAppId` is never a cell: it makes its app
changing (`building`) or change-failed (failed or interrupted). An id both installed and an attempt is one cell, the
attempt. Order: making and queued, then non-collapsed failed/stopped/needs-update (pending order, newest first), then
apps by `createdAt` desc (tie: later index first; an app keeps its place when changed), then one `older` cell last
holding failed/stopped attempts with `createdAt` more than a day before `now` (needs-update never collapses). Armed
purges are not cells. `attemptName` = description's first three words, no leading a/an/the, capitalised (the plan's
proposed name is carried by no record yet: this is the one place to add it).

Menus (`tile-menus.ts`): `menuFor(cell): readonly { action: MenuAction; label; icon; destructive? }[]`. ready: open,
change, history, copy, customize, share, delete; making/queued: details, stop; failed: what-happened, try-again, discard;
stopped: try-again, discard; needs-update: update, discard; changing: details, stop-change; change-failed: what-happened,
try-again, discard-change; older: discard-all.

## `ui/AppTile.tsx`

```ts
TilePlate({ size: TileSize; state: TileState; tint: TintName; glyph: TileGlyph; activity?: number })  // the squircle alone
AppTile({ layout: GridLayout; name; state; tint; glyph; example?; copy?; count?; activity?; busy?; lifted?;
          onPress(): void; onLongPress(anchor: MenuAnchor): void })     // cell: plate + 2-line name + state line; 350 ms hold
LONG_PRESS_MS = 350
```

`onLongPress` plays the `long-press` haptic and measures the cell (`measureInWindow`); `lifted` (menu open) scales it
1.06. The done step's `launcher/app-tile.tsx` is unchanged in behaviour (done variant only) until chain-17.

## HomeScreen props (default export; callbacks keep their old names where they existed)

```ts
{ apps; pending?; purges?: Pick<PendingPurgeStore,'has'>; appBusy?; offline?; queued?: ReadonlySet<string>;
  activity?: Readonly<Record<string, number>>; canCopyData?: boolean /* false */; draft?: string;
  onOpen(app); onFork(app, opts: ForkOptions): Promise<InstalledApp | null>; onDelete(app);
  onUndoDelete(app): boolean; onSettleDelete(app); onDiscard(recs); onUndoDiscard(recs): boolean;
  onSettleDiscard(recs); onHistory(app); onPromptAgain(app); onCreate(idea?: string); onSettings();
  onOpenDevProbe?; onOpenPending?(rec); onCancelPending?(rec); onRetryPending?(rec);
  onCustomizeTile(app, tile: TileIdentity); onResetTile(app) }
```

- `onFork`: resolves the new entry; `null` = this app's slot was taken (nothing started); rejects = nothing was made.
- `canCopyData` is `access.canCopyData`, passed by `renderHome` in `LauncherRoot`; false = "Make a copy" forks `{ data: 'fresh' }` at once.
- Home uses `useToast()`: it must render under `ToastHost` (LauncherRoot mounts one; `toastClearance(screen.kind)` from
  `ComposerBar` lifts it above the composer on Home). Menus and sheets are mounted inside Home.
- `schemeFollowing('home')` is now true: Home draws `useTokens()`, so its stack entry and the status bar follow the scheme.
- `onCreate(idea)`: idea chips pass their words; `LauncherRoot` forwards as `{ kind: 'compose', text }` (the
  `ConsentContinuation` compose member gained `text?`, `runContinuation` -> `openCompose(editing, text)`).
- Composer bar: `ComposerBar({ draft?: string; onPress })` (own file). `draft` set = shows the words, label
  "Describe an app, draft in progress: ...". chain-16 drives it by passing `draft` to `HomeScreen`
  (today `renderHome` passes none). `HomeSkeleton({ count })` and `HomeHeader({ onSettings?, onOpenDevProbe? })` are shared
chrome; without `onSettings` the header's button is inert and hidden from screen readers (the skeleton also inerts its
composer). `count` excludes apps with an armed purge. List rows take `listRowPadding(largeText)` (geometry module).

## Delete, Discard, launch sweep (`soft-delete.ts`, `pending-purge.ts`)

`LauncherShell` owns `PurgeWindows` (built over `PendingPurgeStore`, `completePurge`, `refresh`) and arms from Home's
callbacks: `onDelete` -> `armApp(app)`; `onDiscard` -> `armAttempt(rec.id)` each; `onUndoDelete`/`onUndoDiscard` ->
`undo(kind, id)` (true = restored; false = Home says `COPY.undoTooLateToast`); `onSettleDelete`/`onSettleDiscard` ->
`finish(kind, id)`. The window belongs to the Undo toast (no clock of its own): Home passes `onEnd` on the toast, which
`Toast` runs once when it stops being offered (timeout 10 s / 6 s, swipe, dismiss, action, replaced), so under a screen
reader Undo lasts as long as the toast does. Home shows the toast
(`"<name> deleted"` `undo:true`; `"Discarded"` / `"N discarded"` with an Undo action) and plays the `warning` haptic.
Arm hides (Home reads `purges.has`) and deletes nothing; `finish` runs `completePurge` then `refresh()`; a
failed purge keeps its marker (still hidden). Undo is refused once the purge is running. `completeInterruptedPurges` runs
in the mount effect after the data-copy sweep and before seeding and `ready`. App links ignore armed entries
(`reachableApps/Attempts`). Home's Discard uses this path; the failure screen's Discard still calls `onDismissPending`.
Stop (`onCancelPending`) is unchanged: it ends the record, it does not leave a "Stopped" tile.

## Copy question — `CopyQuestionSheet.tsx` (History, chain-20, and `copy-app-data` chain-3 reuse this component)

```ts
export interface CopyQuestionSheetProps { visible: boolean; appName: string; onCopyData(): void; onStartFresh(): void; onClose(): void }
export function CopyQuestionSheet(p): JSX.Element   // Sheet 'fit', title COPY.copyQuestionTitle, two GroupedRows
```
Creates nothing; the caller hides it in every handler. Copy keys: `copyQuestion*`, `copyQuestionDataSubtitle(name)`,
`copyMadeToast`, `copyFailedToast` (generic; per-kind wording and the "Start fresh" offer on failure are
`copy-app-data` task 3.3). Success: toast `copyMadeToast` + Open. Old share-or-fresh sheet and `forkShareData` are gone.

## Other props chain-16 and later chains meet

```ts
CustomizeTileSheet({ visible; app: InstalledApp | null; onChoose(tile: TileIdentity); onReset(); onClose() })  // writes per pick
OlderAttemptsSheet({ attempts; visible; onOpen(rec); onClose() })
LauncherRoot keeps: openWithConsent({ kind: 'compose'; editing?; text? }), onOpenPending(rec), onCancelPending(rec),
  onRetryPending via openWithConsent({ kind: 'retry', record }), onHistory(app,'home'), refresh()
```

## Tests

`test/home-rig.tsx` (`renderHome`, `renderRoot`, `longPress`, `tile`, `menuLabels`, `chooseRow`, `toastOf`,
`pressToastAction`, `sheetTitled`, `sheetRows`, `tileNodeMock`): tiles measure as `CELL_RECT`; `withLauncher` uses it.
Suites: `grid-composition`, `home-grid-ui`, `launcher-interactions` (soft delete, customize, offline), `fork-ui`, `app-busy`.
`native-host.tsx` adds `Share.shared`; `native-svg.tsx` adds `LinearGradient`.
