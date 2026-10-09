# sheet-modal (chain-5)

## `SheetModal.tsx` — `src/host/launcher/`

```ts
export interface SheetModalProps {
  /** Toggling this drives the rise animation open and an instant close. Keep the caller's
   *  instance MOUNTED across opens (never remount to open/close it) — the same contract
   *  `RunDetailsSheet.tsx` keeps for its own `Animated.Value`. */
  visible: boolean;
  /** Fires on a scrim tap AND on `onRequestClose` (Android hardware back while the Modal is
   *  visible — RN delivers it there, never to a `BackHandler` listener). Never the ONLY way to
   *  close: iOS has no hardware back button, so every caller must also give the sheet a visible
   *  close/cancel control. */
  onClose: () => void;
  children: React.ReactNode;
}
export default function SheetModal(props: Readonly<SheetModalProps>): JSX.Element;
```

A genuine RN `Modal` (`transparent`, `animationType="none"`, own `Animated.View` rise on
`MOTION.sheetRise`) — not an absolutely-positioned sibling `View` like `RunDetailsSheet.tsx` —
because a `Modal` mounts into its own native window and reliably layers above a WebView and the
orb; a plain sibling's stacking order over a hardware-accelerated WebView is not guaranteed on
Android. Tokens only (`SHELL_PALETTE`, `RADIUS.sheet`, `SPACING`); the scrim colour is
`inkAlpha(0.5)`. `KeyboardAvoidingView` wraps the content with `behavior="padding"` on iOS and
`undefined` on Android (AndroidManifest's `windowSoftInputMode="adjustResize"` already handles it
there). Respects the bottom safe-area inset (`useSafeAreaInsets().bottom` added to the sheet's own
`paddingBottom`).

`ReportSheet.tsx` is the one current consumer; a later chain's `AppLinkSheet.tsx` is expected to
reuse it identically — no second sheet primitive.

## `ReportSheet.tsx` — `src/host/launcher/`

```ts
export interface ReportSheetProps {
  /** The app being reported, or `null` while the sheet is closed. Toggling this (not a separate
   *  `open` boolean) both opens/closes the sheet and selects which app's draft loads. */
  app: InstalledApp | null;
  access: StoreAccess;
  /** Plain `ClientOptions` — sending needs no AI-data consent (design D3). */
  options: ClientOptions;
  onClose: () => void;
}
export default function ReportSheet(props: Readonly<ReportSheetProps>): JSX.Element;
```

`app` transitioning to non-null loads a fresh `reportDraftFor(app, access)` draft; transitioning to
`null` clears the draft, phase and any notice — closing (scrim, `Cancel`, hardware back, or the
thanks state's `Done`) always discards the draft and sends nothing. Renders through `SheetModal`,
`ServiceNotice`/`useRetryGate` (the same shared refusal surface `LauncherRoot.tsx`'s five-step flow
uses) for a send failure, and posts through `sendReport` from `generation-client.ts`. All strings
route through `copy.ts`'s `COPY` table (the `report*` keys) — nothing else on this surface renders
a literal string.

## `back-policy.ts` — the `overlayOpen` addition (mini-app-back-navigation delta)

```ts
export type BackAction = 'exit' | 'forward' | 'ignore' | 'close-overlay'; // was missing 'close-overlay'
export type BackEvent =
  | { type: 'backPress'; overlayOpen?: boolean } // was `{ type: 'backPress' }`
  | /* reset | navDepth | timeout, unchanged */ never;
```

`overlayOpen: true` on a `backPress` resolves to `'close-overlay'` UNCONDITIONALLY — before the
`bound` check, before depth, before `awaitingPop`/`escapeArmed` — and mutates NOTHING in state (not
forwarded into the realm, not counted toward the guaranteed-exit policy). `BackPolicy#backPress`
gained the same input: `backPress(overlayOpen = false): BackAction` — the default keeps every
existing zero-arg call site compiling unchanged.

## `useMiniAppHost.ts` — the `overlayOpen`/`onCloseOverlay` options

```ts
export interface UseMiniAppHostOptions {
  onExit?: () => void; // unchanged
  /** True while a host-layer sheet (the report sheet) covers this realm. */
  overlayOpen?: boolean;
  /** Called when a back press resolves to `close-overlay` — the caller closes its own sheet. */
  onCloseOverlay?: () => void;
}
```

Both are read through refs updated every render (the same idiom `onExitRef` already uses), so
neither re-subscribes the `BackHandler` listener. `MiniAppView.tsx` owns the report sheet's open
state LOCALLY (a `reportOpen` boolean plus the `ReportSheet` it renders as a sibling of `Orb`,
inside its own subtree — which is inside `LauncherRoot.tsx`'s `ScreenBoundary`) and threads it
straight into these two options; it is NOT lifted to `LauncherRoot.tsx`, so a running app's report
sheet can never go stale across an unrelated screen change. `LauncherRoot.tsx` owns a SEPARATE
`reportTarget: InstalledApp | null` + its own `ReportSheet` instance for the done-step and
history-header entry points only (neither has a live realm to gate).

## Orb / copy additions (no behavior contract, listed for completeness)

`OrbActionId` gained `'report'` (`ORB_ACTIONS`/`ORB_ROW_TINT`/`ORB_ROW_GLYPH` are `Record<OrbActionId,
…>`, so a later chain adding another orb action must extend all three or fail the typecheck). `Orb`
gained a required `onReport: () => void` prop. `DoneStep` gained a required `onReport: () => void`
prop (a plain-text row below its two existing destinations). `HistoryScreen` gained a required
`onReport: () => void` prop (a header action reporting the version the user is on — no row gained
one).
