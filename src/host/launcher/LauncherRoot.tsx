// ─────────────────────────────────────────────────────────────────────────────
// LauncherRoot — the product shell's top-level screen switch (launcher-shell / #5 D6).
// ─────────────────────────────────────────────────────────────────────────────
// Plain RN state, no navigation library: home grid → full-screen mini-app → back to home; a
// __DEV__ entry reaches the containment/bridge probe; a settings entry reaches the shell
// settings. The prompt flow (shell-redesign-v2, group D) contributes the five steps of screen
// `2a` — compose → clarify → plan → build → done — as members of the same union, with all async
// orchestration (the clarify exchange, the rewrite call, the SSE loop, abort wiring, delivery
// routing) living here: the step screens are presentational and the decisions between them are
// the pure machine in `prompt-flow.ts`. This is also the host wiring: the MMKV-backed
// installed-apps index, the persistent version store, the sanctioned StoreAccess path (with the
// device user-data delete), first-run seeding (D7), the fork/delete flows (D2), the fixed theme,
// the highlighting off-switch, and the persisted device id + server address — all read once from
// the same `whim.launcher` KVBackend the installed-apps index uses. One WebView == one realm ==
// one app: launching reads the active bundle source from the record and hands it to MiniAppView
// (keyed by launcher id, so each launch is a fresh realm).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, StatusBar, StyleSheet, Text, TouchableOpacity, View, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Diagnostic, GenerationEvent } from '@whim/contract';
import { APP_RECORDS } from '../../runtime/generated/app-records';
import { APP_BUNDLES } from '../../runtime/generated/app-bundles';
import { RADIUS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import { log } from '../logging';
import { CHANNELS } from '../logging/channels';
import type { AppRecord } from '../bridge';
import { createPersistentStore } from '../version-store';
import { createMmkvBackend } from '../version-store/fs/mmkv-backend';
import type { KVBackend } from '../version-store/fs/kv-fs';
import { deleteStorage, peekAppliedSchema } from '../storage-engine';
import { HighlightingProvider } from '../ui/whim-prose/WhimProse';
import { AppIndex, InstalledApp } from './app-index';
import { AppBusy, runAppOp } from './app-busy';
import type { AppBusyMap } from './app-busy';
import { StoreAccess } from './store-access';
import { PendingBuildStore } from './pending-builds';
import type { PendingBuildRecord } from './pending-builds';
import { RunJournalStore } from './run-journal';
import type { RunJournal, RunTerminalCounts } from './run-journal';
import {
  deliverAndSettle,
  dropPendingBuild,
  failPendingBuild,
  hydratedDiagnostics,
  journalStreamEvent,
  retryBuildScreen,
  startPendingBuild,
} from './build-lifecycle';
import { buildGenerateRequest, buildRewriteAppContext } from './generation-request';
import { seedFirstRun, SeedSpec } from './seed';
import { COPY } from './copy';
import HomeScreen, { HOME_GRID_COLUMNS, HOME_GRID_COLUMN_GAP } from './HomeScreen';
import MiniAppView from './MiniAppView';
import DevProbeScreen from './DevProbeScreen';
import SettingsScreen from './SettingsScreen';
import HistoryScreen from './HistoryScreen';
import ComposeStep from './ComposeStep';
import ClarifyStep from './ClarifyStep';
import PlanStep from './PlanStep';
import BuildStep from './BuildStep';
import DoneStep from './DoneStep';
import FailureScreen from './FailureScreen';
import ScreenBoundary from './ScreenBoundary';
import ScreenErrorFallback from './ScreenErrorFallback';
import DevLogOverlay from './DevLogOverlay';
import { devLogOverlayEnabled } from './dev-log-view';
import RunTimeline from './RunTimeline';
import { runTimelineDevModeEnabled } from './run-timeline-view';
import { HomeGridSkeleton } from './flow-skeletons';
import {
  EMPTY_RUN_AGGREGATES,
  RUN_SIGNAL_TICK_MS,
  acceptClarifyQuestions,
  backFrom,
  buildStep,
  clarifyStep,
  clarificationsFrom,
  composeStep,
  doneStep,
  isClarifySkip,
  planStep,
  stepAfterClarifyExchange,
  updatePlanRow,
  withAnswer,
  withDelivering,
  withPlan,
  withStage,
} from './prompt-flow';
import type { BuildScreen, ClarifyScreen, ComposeScreen, FlowQuestion, FlowScreen, PlanScreen, RunSignals } from './prompt-flow';
import { FlowRequests, onlyOnStep } from './flow-request';
import { shellPalette } from './theme';
import { ThemeProvider, useTheme } from './theme-context';
import { loadServerUrl, saveServerUrl } from './server-address';
import { loadHighlighting, saveHighlighting } from './highlighting';
import { getDeviceId } from './device-id';
import { GenerationClientError, clarifyPrompt, generateApp, rewritePrompt } from './generation-client';
import type { ClientOptions } from './generation-client';

type Screen =
  | { kind: 'home' }
  | { kind: 'app'; app: InstalledApp; record: AppRecord; source: string; engineAppId: string }
  | { kind: 'dev' }
  | { kind: 'settings' }
  | { kind: 'history'; app: InstalledApp }
  // The five steps of screen `2a`, shaped and sequenced by `prompt-flow.ts`. `editing` absent =
  // the new-app flow (the home composer row); present = the per-app "Prompt again" edit flow.
  | FlowScreen
  // `observedRepairAttempts` is how many repair attempts THIS device watched go past on the
  // stream (never a wire field), and `hasWorkingVersion` says whether the app already had a
  // working snapshot installed — both are the failure screen's honest-only rows.
  | {
      kind: 'failure';
      editing?: InstalledApp;
      prompt: string;
      reason: string;
      diagnostics: readonly { hint: string }[];
      observedRepairAttempts: number;
      hasWorkingVersion: boolean;
      /** Set ONLY when this screen was opened from a `failed`/`interrupted` pending-build record
       *  rather than from a live terminal event — the one thing that distinguishes the two, and
       *  what turns the primary action into Retry and the secondary into Dismiss (`prompt-flow`
       *  "Failure screens hydrate from the persisted failure payload"). */
      pendingId?: string;
      /** The pending-build record this LIVE failure screen already settled — set by every ending
       *  that went through `settleFailed`, absent for the clarify/rewrite failures, which fail
       *  before any attempt (and so any record) exists. Deliberately NOT `pendingId`: it says
       *  there is something to discard, without claiming the screen was hydrated from a ghost, so
       *  the primary action stays Rephrase rather than flipping to Retry. */
      recordId?: string;
      /** Which run journal describes the attempt this screen is about — the live attempt's
       *  launcher id, or the record's own. The what-happened section is read from it ONCE, when
       *  the screen opens; a missing journal changes nothing else about the screen. */
      journalId?: string;
    };

const GENERIC_STREAM_ERROR = "Something went wrong while building your app. Please try again.";

/** The developer affordance that opens the dev log overlay. A mechanism word, deliberately not in
 *  `copy.ts` — the same standing `DevProbeScreen`'s and the overlay's own labels have. */
const DEV_LOG_LABEL = 'Logs';

/**
 * The build-time flag that lets the seam DELIVER records to the dev server, in the `RUN_*_PROBE`
 * idiom (App.tsx): flipped by hand in a local working copy and never committed as `true`.
 * Deliberately separate from the overlay's flag — reading the ring buffer on-device is local and
 * free, while the sink is a network transport that must not switch itself on because a build
 * happens to be a dev build (design D5, `logging/sink.ts`).
 */
const SEND_DEV_LOGS = false;

/** The first-run example set, built from the generated host records + bundle sources (D7). */
function defaultSeeds(): SeedSpec[] {
  const seeds: Array<{ id: string; name: string; prompt: string }> = [
    { id: 'tip-splitter', name: 'Tip Splitter', prompt: 'Example: split a bill with tip' },
    { id: 'water-counter', name: 'Water Counter', prompt: 'Example: track glasses of water' },
    { id: 'style-gallery', name: 'Style Gallery', prompt: 'Example: every SDK component in one screen' },
  ];
  return seeds
    .filter(s => APP_RECORDS[s.id] && APP_BUNDLES[s.id])
    .map(s => ({ ...s, record: APP_RECORDS[s.id], bundleSource: APP_BUNDLES[s.id] }));
}

/** Maps a thrown error from the client calls down to the failure screen's honest
 *  `{reason, diagnostics}` shape — never the raw error kind/status, matching the "failure shown
 *  honestly" requirement's hint-only discipline (diagnostics stay empty here; only a terminal
 *  `failure` event ever carries real per-diagnostic hints). */
function errorReason(err: unknown): { reason: string; diagnostics: readonly { hint: string }[] } {
  if (err instanceof GenerationClientError && err.hint) {
    return { reason: err.hint, diagnostics: [] };
  }
  return { reason: GENERIC_STREAM_ERROR, diagnostics: [] };
}

/** The taxonomy `errorReason()` intentionally scrubs off the screen, as named fields: constructor,
 *  GenerationClientError kind/status/hint, message, stack. Never prompt text or generated source. */
function errorFields(err: unknown): Record<string, unknown> {
  const isErr = err instanceof Error;
  return {
    ctor: isErr ? err.constructor.name : typeof err,
    ...(err instanceof GenerationClientError ? { kind: err.kind, status: err.status, hint: err.hint } : {}),
    message: isErr ? err.message : undefined,
    stack: isErr ? err.stack : undefined,
  };
}

/** Breadcrumb for a swallowed generation-path error, on the generation channel. */
function logGenError(stage: string, err: unknown): void {
  log.error(CHANNELS.gen, 'generation step failed', { stage, ...errorFields(err) });
}

/** Every failure screen this shell shows is ALSO recorded on the generation channel (prompt-flow
 *  "The failure is recoverable from the log"): the error class, message, stack and mapped kind,
 *  plus each diagnostic's `kind`/`symbol`/`message` — precisely the taxonomy the screen scrubs,
 *  since it may show nothing but a diagnostic's `hint`. A terminal `failure` event has no thrown
 *  error, so its own class name stands in for one and its `reason` for the message. */
function logGenFailureShown(input: {
  stage: string;
  reason: string;
  observedRepairAttempts: number;
  err?: unknown;
  /** The class name to record when nothing was thrown (the two stream-shaped failures). */
  failureClass?: string;
  diagnostics?: readonly Diagnostic[];
}): void {
  log.error(CHANNELS.gen, 'failure screen shown', {
    stage: input.stage,
    reason: input.reason,
    observedRepairAttempts: input.observedRepairAttempts,
    ...(input.err === undefined
      ? {
          ctor: input.failureClass ?? 'GenerationFailure',
          kind: input.diagnostics?.[0]?.kind,
          message: input.reason,
          stack: undefined,
        }
      : errorFields(input.err)),
    ...(input.diagnostics
      ? { diagnostics: input.diagnostics.map((d) => ({ kind: d.kind, symbol: d.symbol, message: d.message })) }
      : {}),
  });
}

/** What the device OBSERVED on one generation stream. `repair` counts repair-stage starts — the
 *  attempts the device actually watched go past, which is the only thing the failure screen's
 *  attempt row is allowed to show. */
interface EventCounts {
  stage: number;
  token: number;
  diagnostic: number;
  repair: number;
}

/** Tally one stream event. Kept out of the build orchestration so that reading `onBuildIt` shows
 *  the flow rather than the arithmetic; no event field reaches UI state from here. */
function countEvent(counts: EventCounts, event: GenerationEvent): void {
  if (event.type === 'stage') {
    counts.stage++;
    if (event.stage === 'repair' && event.status === 'start') counts.repair++;
  } else if (event.type === 'token') {
    counts.token++;
  } else if (event.type === 'diagnostic') {
    counts.diagnostic++;
  }
}

export default function LauncherRoot() {
  // Construct the persistent host services once (device native modules — lazy under the hood).
  // The device id, server address and highlighting flag all read from the SAME `whim.launcher`
  // KVBackend instance the installed-apps index uses (one MMKV instance, several consumers).
  const { index, access, pending, journal, kv } = useMemo(() => {
    const launcherKv: KVBackend = createMmkvBackend('whim.launcher');
    const idx = new AppIndex(launcherKv);
    const store = createPersistentStore(createMmkvBackend('whim-version-store'));
    const acc = new StoreAccess({ store, index: idx, deleteStorage: (appId) => deleteStorage({ appId }) });
    return {
      index: idx,
      access: acc,
      pending: new PendingBuildStore(launcherKv),
      // The run journal rides on the SAME backend instance as the pending record it is a sibling
      // key of (design D1), under the same single-writer discipline.
      journal: new RunJournalStore(launcherKv),
      kv: launcherKv,
    };
  }, []);

  return (
    <ThemeProvider>
      <LauncherShell index={index} access={access} pending={pending} journal={journal} kv={kv} />
    </ThemeProvider>
  );
}

/**
 * The developer log surface: the affordance and the overlay it opens, GATED TOGETHER on the same
 * predicate the overlay gates itself on — the spec asks for no affordance in a shipping build,
 * not merely a dead route. It is a modal above the live screen rather than a `Screen` variant, so
 * a developer reads the log of the screen they are looking at without navigating away from it.
 */
function DevLogTools({ palette }: Readonly<{ palette: ReturnType<typeof shellPalette> }>) {
  const [open, setOpen] = useState(false);
  if (!devLogOverlayEnabled(__DEV__)) {
    return null;
  }
  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        accessibilityLabel={DEV_LOG_LABEL}
        style={[styles.devLogBtn, { backgroundColor: palette.card, borderColor: palette.cardBorder }]}
      >
        <Text style={[TYPE_SCALE.eyebrow, { color: palette.textMuted }]}>{DEV_LOG_LABEL}</Text>
      </TouchableOpacity>
      <DevLogOverlay visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

function LauncherShell({
  index,
  access,
  pending,
  journal,
  kv,
}: Readonly<{
  index: AppIndex;
  access: StoreAccess;
  pending: PendingBuildStore;
  journal: RunJournalStore;
  kv: KVBackend;
}>) {
  const { theme } = useTheme();
  const palette = shellPalette(theme);

  const [screen, setScreen] = useState<Screen>({ kind: 'home' });
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [pendingBuilds, setPendingBuilds] = useState<PendingBuildRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverUrl, setServerUrl] = useState<string | undefined>(() => loadServerUrl(kv));
  const [highlighting, setHighlighting] = useState<boolean>(() => loadHighlighting(kv));

  const deviceId = useMemo(() => getDeviceId(kv), [kv]);
  const clientOptions = useMemo<ClientOptions | null>(
    () => (serverUrl != null ? { baseUrl: serverUrl, deviceId } : null),
    [serverUrl, deviceId],
  );

  /** How many tiles the grid is known to be about to show — the skeleton's exact count. Read
   *  synchronously from the index at mount, before first-run seeding resolves. */
  const knownAppCount = useMemo(() => index.list().length, [index]);

  // Tracks the in-flight generation's abort controller, the caller's own cancellation intent, and
  // whether the user left it running (generation-client's abort contract: the caller must track
  // intent itself rather than infer it from the stream's output, since an abort and an unrelated
  // truncated stream look identical). Cleared once the generation settles.
  const genRef = useRef<{ controller: AbortController; cancelled: boolean; detached: boolean } | null>(null);

  // The same bookkeeping for the flow's two unary requests — compose's clarify and plan's rewrite
  // — one controller per step, so leaving a step cancels its own request and nothing else
  // (`flow-request.ts`). A ref for the same reason `genRef` is one: the leave-handler must reach
  // the CURRENT request, not the one a stale render closed over.
  const flowRequests = useRef(new FlowRequests()).current;

  // The home grid's per-app wait affordances (`app-busy.ts`): which app is opening, forking or
  // being deleted right now. A ref for the guard — two taps in one frame both read the same
  // `useState` value, so state alone could not refuse the second — plus a mirrored snapshot in
  // state, which is the only half the screens render.
  const appOps = useRef(new AppBusy()).current;
  const [appBusy, setAppBusy] = useState<AppBusyMap>({});

  // The build screen of the attempt currently in flight, kept live even while the user is
  // elsewhere. This is ALL that "tap a building ghost to reattach" needs (design D7): the stream
  // never left this shell's closure when `onLeaveRunning` detached it, so reattaching is a screen
  // -state change — reading the screen back out of here — and not a second subscriber, an event
  // bus or per-tile progress. Cleared the moment the attempt settles.
  const liveRef = useRef<{ id: string; screen: BuildScreen } | null>(null);

  // The live attempt's derived-signal state (design D6): its start time, the cumulative counts
  // folded from its stream and the arrival that the heartbeat measures quiet from. A REF, not
  // state, because it moves on every token — re-rendering per token is exactly the cadence this
  // change refuses. The build screen's clock moves on the tick below instead, and the journal is
  // never read to produce any of it.
  const signalsRef = useRef<RunSignals | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (screen.kind !== 'build') return undefined;
    const timer = setInterval(() => setTick((t) => t + 1), RUN_SIGNAL_TICK_MS);
    return () => clearInterval(timer);
  }, [screen.kind]);

  // The build screen's details view (task 5.4): the entries read at the moment it was opened, or
  // `null` while it is closed. STATE, not a ref, because opening it is exactly the one moment this
  // screen should re-render — and the read happens there, never on the tick above.
  const [timeline, setTimeline] = useState<RunJournal | null>(null);

  // While the details view is up, hardware back closes IT rather than cancelling the run: this
  // listener is registered after the build screen's own, and the newest listener runs first.
  useEffect(() => {
    if (timeline === null) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setTimeline(null);
      return true;
    });
    return () => sub.remove();
  }, [timeline]);

  // Leaving the build screen closes it, so returning to a later attempt never opens onto the
  // previous one's entries.
  useEffect(() => {
    if (screen.kind !== 'build') setTimeline(null);
  }, [screen.kind]);

  /** Whether the timeline shows the developer counts, decided ONCE for both surfaces — never a
   *  bare `__DEV__` check (decision #60(c)). */
  const timelineDevMode = runTimelineDevModeEnabled(__DEV__);

  const refresh = () => {
    setApps(index.list());
    setPendingBuilds(pending.list());
  };

  // The sink's destination is the address the device ALREADY persists for `/v1/generate` (design
  // D4) — no second setting. It stays inert until both the flag and an address are set, so this
  // runs on every address change and is a no-op in every build that ships.
  useEffect(() => {
    log.sink.configure({ enabled: SEND_DEV_LOGS, baseUrl: serverUrl });
  }, [serverUrl]);

  useEffect(() => {
    // Before the first grid render, and exactly once per process (`pending-builds` "A live
    // building record is demoted to interrupted at launch"): the process that owned any surviving
    // `building` stream is gone, so that state can no longer be truthful. The grid is gated on
    // `ready`, which this effect sets at its end — so nothing has rendered a record yet.
    pending.demoteBuildingToInterrupted();
    (async () => {
      try {
        await seedFirstRun(index, access, defaultSeeds());
      } catch (e) {
        log.warn(CHANNELS.app, 'first-run seeding failed', { operation: 'seed', ...errorFields(e) });
      }
      refresh();
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The tile's tap: busy from the tap until the mini-app screen replaces the grid or the open
   *  fails (`app-launcher` "Opening an app shows an immediate busy affordance" — a tap MUST NOT
   *  read as unregistered while the active bundle is being read). */
  const onOpen = (app: InstalledApp) =>
    runAppOp(appOps, setAppBusy, app.id, 'open', async () => {
      try {
        const source = await access.activeBundle(app);
        setScreen({ kind: 'app', app, record: app.record, source, engineAppId: access.engineAppId(app) });
      } catch (e) {
        // The user still gets the alert; the class/message/stack of what actually failed is only
        // recoverable from the seam (host-observability "The alert paths now log").
        log.error(CHANNELS.app, 'installed-app action failed', { operation: 'open', ...errorFields(e) });
        Alert.alert('Could not open this app', (e as Error)?.message ?? String(e));
      }
    });

  const onFork = (app: InstalledApp, opts: { shareData: boolean }) =>
    runAppOp(appOps, setAppBusy, app.id, 'fork', async () => {
      try {
        await access.fork(app, undefined, opts);
        refresh();
      } catch (e) {
        log.error(CHANNELS.app, 'installed-app action failed', { operation: 'fork', ...errorFields(e) });
        Alert.alert('Could not fork this app', (e as Error)?.message ?? String(e));
      }
    });

  const onHistory = (app: InstalledApp) => {
    setScreen({ kind: 'history', app });
  };

  const onDelete = (app: InstalledApp) =>
    runAppOp(appOps, setAppBusy, app.id, 'delete', async () => {
      try {
        await access.remove(app);
        // The app's retained last-run report goes with it, in the SAME operation — the discipline
        // "dismissing a ghost deletes its journal" applied to the other journal key. Nothing else
        // ever revisits this id, so a report left behind would never be reclaimed.
        journal.deleteLastRun(app.id);
        refresh();
      } catch (e) {
        log.error(CHANNELS.app, 'installed-app action failed', { operation: 'delete', ...errorFields(e) });
        Alert.alert('Could not delete this app', (e as Error)?.message ?? String(e));
      }
    });

  /** The leave-handler half of the flow's cancellation pattern: the step being left cancels its
   *  OWN in-flight request and nothing else. Compose drops its busy state on the way out too —
   *  the primary action is busy only for the clarify request this just cancelled, and its
   *  post-await reset is guarded, so nothing else would ever clear it. */
  const leaveFlowStep = (kind: Screen['kind']) => {
    if (kind === 'compose') {
      flowRequests.abort('compose');
      setBusy(false);
    } else if (kind === 'plan') {
      flowRequests.abort('plan');
    }
  };

  const goHome = () => {
    leaveFlowStep(screen.kind);
    refresh();
    setScreen({ kind: 'home' });
  };

  const onServerUrlChange = (url: string) => {
    saveServerUrl(kv, url);
    setServerUrl(loadServerUrl(kv));
  };

  const onHighlightingChange = (enabled: boolean) => {
    saveHighlighting(kv, enabled);
    setHighlighting(enabled);
  };

  // ── The `2a` flow (group D) ────────────────────────────────────────────────────────────────
  // compose → clarify → plan → build → done. Every forward move is gated by a primary action and
  // carries one request; every backward move is immediate (`prompt-flow.ts#backFrom`). The step
  // screens never touch fetch, StoreAccess or AbortController — all of that lives here.

  /** The ONE construction of the failure screen from a thrown error: it records the failure on the
   *  generation channel on the way, so no path can reach the screen without a log record. Always
   *  called OUTSIDE the `setScreen` updater — an updater is not pure and React may run it twice.
   *  `observed` defaults to 0: the clarify and rewrite steps fail before any generation stream
   *  exists, and a count is never invented for a run that never reached repair. */
  const failure = (
    editing: InstalledApp | undefined,
    prompt: string,
    err: unknown,
    stage: string,
    observed = 0,
    settledAttemptId?: string,
  ): Screen => {
    const reasoned = errorReason(err);
    logGenFailureShown({ stage, reason: reasoned.reason, observedRepairAttempts: observed, err });
    return {
      kind: 'failure',
      editing,
      prompt,
      ...reasoned,
      // Absent for the clarify and rewrite steps: they fail before any attempt — and so before any
      // journal or pending-build record — exists, and neither a timeline nor a discardable attempt
      // is ever invented for a run that never started. An attempt's launcher id is both its
      // journal key and its record id, so the one argument answers both.
      ...(settledAttemptId != null ? { journalId: settledAttemptId, recordId: settledAttemptId } : {}),
      observedRepairAttempts: observed,
      // The app being edited already has a working version installed; a brand-new app has none.
      hasWorkingVersion: editing != null,
    };
  };

  const openCompose = (editing?: InstalledApp, text?: string) => setScreen(composeStep(editing, text ?? ''));

  const goBack = (from: FlowScreen) => {
    leaveFlowStep(from.kind);
    const target = backFrom(from);
    if (target === 'home') goHome();
    else if (target) setScreen(target);
  };

  /** Fetch the plan and show it: the step opens immediately under its row skeleton, and its own
   *  primary action stays busy until the rewrite response lands. */
  const openPlan = async (prev: ComposeScreen | ClarifyScreen) => {
    if (!clientOptions) return;
    const plan = planStep(prev);
    // Guarded like every other post-navigation write: this runs straight after the clarify await
    // on the compose path, and a user who has already left must not be pulled onto a plan step.
    setScreen(onlyOnStep<Screen, 'compose' | 'clarify'>(prev.kind, () => plan));
    const request = flowRequests.start('plan');
    try {
      const response = await rewritePrompt(
        clientOptions,
        plan.text,
        clarificationsFrom(plan.questions, plan.answers),
        // A re-prompt tells the rewrite which app it is changing; composing a new app sends none.
        buildRewriteAppContext(plan.editing),
        request.controller.signal,
      );
      if (request.cancelled) return;
      setScreen(onlyOnStep<Screen, 'plan'>('plan', (s) => withPlan(s, response)));
    } catch (e) {
      // A request the user walked away from fails as an abort: no failure screen, no breadcrumb.
      if (request.cancelled) return;
      logGenError('rewrite failed', e);
      const failed = failure(plan.editing, plan.text, e, 'rewrite failed');
      setScreen(onlyOnStep<Screen, 'plan'>('plan', () => failed));
    } finally {
      flowRequests.release('plan', request);
    }
  };

  /** compose → clarify, or straight past it when the exchange has nothing to ask. A clarify
   *  `502` means "skip to the plan step", not a dead end (`isClarifySkip`). */
  const onComposeContinue = async (from: ComposeScreen) => {
    if (!clientOptions) return;
    setBusy(true);
    const request = flowRequests.start('compose');
    let questions: FlowQuestion[] = [];
    try {
      questions = acceptClarifyQuestions(
        (await clarifyPrompt(clientOptions, from.text, request.controller.signal)).questions,
      );
    } catch (e) {
      // The user left compose while this was in flight: the abort surfaces here as a plain
      // `AbortError`, and it is swallowed — no failure screen, no breadcrumb, and `busy` was
      // already cleared by the leave-handler that cancelled it.
      if (request.cancelled) return;
      if (!isClarifySkip(e)) {
        logGenError('clarify failed', e);
        setBusy(false);
        const failed = failure(from.editing, from.text, e, 'clarify failed');
        setScreen(onlyOnStep<Screen, 'compose'>('compose', () => failed));
        return;
      }
    } finally {
      flowRequests.release('compose', request);
    }
    if (request.cancelled) return;
    setBusy(false);
    if (stepAfterClarifyExchange(questions) === 'clarify') {
      setScreen(onlyOnStep<Screen, 'compose'>('compose', () => clarifyStep(from, questions)));
    } else {
      await openPlan(from);
    }
  };

  /** A settling attempt releases ONLY the refs that still point at ITSELF. Two attempts can
   *  overlap — "Leave it running" and then a Retry or a new build — and the newer one has already
   *  overwritten both refs. Clearing the older attempt's way would strand the newer one:
   *  uncancellable (`abortLiveAttempt` would see null) and with its `building` ghost tapping into
   *  the "no live run to reattach to" branch forever. Cancel is the deliberate exception — it
   *  clears whatever is live because that is what the user asked for. */
  const releaseGenRef = (ctl: NonNullable<typeof genRef.current>) => {
    if (genRef.current === ctl) genRef.current = null;
  };
  const releaseLiveRef = (attemptId: string) => {
    if (liveRef.current?.id === attemptId) liveRef.current = null;
  };

  /** The record deletion the user's two delete gestures share — cancelling an in-flight attempt
   *  and dismissing a `failed`/`interrupted` ghost — WITH the run journal that rode alongside it
   *  (`generation-run-journal` "Dismissing a ghost deletes its journal": the same operation, so a
   *  journal can never outlive the record it describes). */
  const dropAttempt = (id: string) => {
    dropPendingBuild(pending, id);
    journal.delete(id);
  };

  /** A terminal `failure`, a stream that ended without one, or a throw: the record moves to
   *  `failed` and STAYS on the grid, so the attempt is still reachable after the screen is gone.
   *  Never a delete — only the user's cancel/dismiss and a successful delivery do that. The
   *  journal's terminal entry is written here too, and FIRST: this is the one settlement every
   *  non-deliverable ending passes through, and the entry must not wait on the aggregate throttle
   *  (`generation-run-journal` "A terminal entry is always written immediately"). */
  const settleFailed = (
    id: string,
    reason: string,
    diagnostics: readonly { hint: string }[],
    observed: RunTerminalCounts,
  ) => {
    releaseLiveRef(id);
    // `observed` is the end-of-stream flush: the final cumulative counts (closing the last throttle
    // window, which no aggregate entry can) and how many `diagnostic` events went past. Only the
    // loop that watched the stream can supply them, so they are threaded in rather than re-derived.
    journal.appendTerminal(id, { failure: { reason, diagnostics }, ...observed });
    failPendingBuild(pending, id, reason, diagnostics);
    refresh();
  };

  /** The abort + record deletion both cancel routes share: the build step's own back press and a
   *  Cancel chosen from a `building` ghost's quick actions. */
  const abortLiveAttempt = () => {
    const ctl = genRef.current;
    if (ctl) {
      ctl.cancelled = true;
      ctl.controller.abort();
      genRef.current = null;
    }
    const live = liveRef.current;
    liveRef.current = null;
    if (live) dropAttempt(live.id);
    refresh();
  };

  /** The ONE settlement for a generation that ended without a deliverable result — a terminal
   *  `failure` event, or a stream that ended without any terminal event. The record is persisted
   *  as `failed` with its payload AND the failure screen is shown from the same values, so what
   *  the grid keeps and what the user just read can never disagree. */
  const showStreamFailure = (input: {
    attemptId: string;
    editing: InstalledApp | undefined;
    prompt: string;
    reason: string;
    hints: readonly { hint: string }[];
    observed: number;
    counts: RunTerminalCounts;
  }) => {
    settleFailed(input.attemptId, input.reason, input.hints, input.counts);
    setScreen({
      kind: 'failure',
      editing: input.editing,
      prompt: input.prompt,
      reason: input.reason,
      diagnostics: input.hints,
      journalId: input.attemptId,
      // `settleFailed` just persisted the record above, so this live screen HAS an attempt to
      // discard — and its Discard must delete it rather than merely navigate.
      recordId: input.attemptId,
      observedRepairAttempts: input.observed,
      // The app being edited already has a working version installed; a brand-new app has none.
      hasWorkingVersion: input.editing != null,
    });
  };

  /**
   * ONE generation attempt, end to end: the launcher id and its `building` record are written
   * BEFORE the request goes out (design D3/D4), the stream runs, and exactly one of three
   * settlements follows — delivered (record deleted, after the store and index are both written),
   * failed (record persisted with its payload, never deleted), or cancelled (record deleted by the
   * cancel path itself). The plan's `Build it` and a ghost's Retry are its only two entries, so
   * this stays the shell's single `generateApp` call site.
   */
  const runAttempt = async (building: BuildScreen, reuseId?: string) => {
    if (!clientOptions) return;
    setScreen(building);

    const controller = new AbortController();
    const ctl = { controller, cancelled: false, detached: false };
    genRef.current = ctl;
    const editing = building.editing;
    // Declared outside the try so a throw mid-stream still knows what the device observed.
    const counts: EventCounts = { stage: 0, token: 0, diagnostic: 0, repair: 0 };

    // The id this attempt writes to, decided and persisted before the request exists: a new
    // install mints one, a rebuild's id IS the app it rebuilds, a retry reuses its record's.
    const attemptId = startPendingBuild(pending, { editing, text: building.text, reuseId });
    // The journal is created at the SAME moment as the record it is a sibling of
    // (`generation-run-journal` "A run journal is created alongside its pending-build record"),
    // and the attempt's derived signals start from the same instant the request does.
    journal.create(attemptId);
    const startedAt = Date.now();
    let signals: RunSignals = { startedAt, aggregates: EMPTY_RUN_AGGREGATES, lastArrivalAt: startedAt };
    signalsRef.current = signals;
    /** What the terminal entry flushes, read at the instant the stream ends: the final cumulative
     *  counts (the throttle's last window has no later arrival to close it) and the diagnostics
     *  tally. Numbers only — the same redaction rule every journal entry lives under. */
    const terminalCounts = (): RunTerminalCounts => ({
      aggregates: signals.aggregates,
      observedDiagnostics: counts.diagnostic,
    });
    // The live screen a `building` ghost taps back into; kept in step with the stream below.
    let live = building;
    liveRef.current = { id: attemptId, screen: live };
    refresh();

    try {
      const request = await buildGenerateRequest(
        access,
        (appId) => peekAppliedSchema({ appId }),
        editing,
        building.rewritten,
        clarificationsFrom(building.questions, building.answers),
      );
      let terminal: GenerationEvent | null = null;

      // Only `stage` ever reaches UI state (never `token.text` or `diagnostic.kind`/`symbol` —
      // spec "Generation progress is shown without exposing internals"); `result`/`failure` are
      // held until the stream ends so the terminal-event handling below stays in one place.
      for await (const event of generateApp(clientOptions, request, controller.signal)) {
        countEvent(counts, event);
        // The journal write and the signal fold for this event, in one place and at one clock
        // reading: `stage` journals immediately, `token` goes through the store's own ~5s
        // throttle, everything else writes nothing (`build-lifecycle#journalStreamEvent`).
        signals = journalStreamEvent(journal, attemptId, signals, event, Date.now());
        signalsRef.current = signals;
        if (event.type === 'stage') {
          live = withStage(live, event.stage);
          liveRef.current = { id: attemptId, screen: live };
          setScreen((s) => (s.kind === 'build' ? withStage(s, event.stage) : s));
        } else if (event.type === 'result' || event.type === 'failure') {
          terminal = event;
        }
      }

      if (ctl.cancelled) return; // cancel-on-navigate-away: the cancel path deleted the record
      releaseGenRef(ctl);

      if (terminal == null) {
        // Stream ended with no terminal event and no cancel — a stream error, not a crash.
        log.error(CHANNELS.gen, 'stream ended with no terminal event', { ...counts });
        logGenFailureShown({
          stage: 'stream ended with no terminal event',
          reason: GENERIC_STREAM_ERROR,
          observedRepairAttempts: counts.repair,
          failureClass: 'StreamEndedWithoutTerminalEvent',
        });
        showStreamFailure({
          attemptId,
          editing,
          prompt: building.text,
          reason: GENERIC_STREAM_ERROR,
          hints: [],
          observed: counts.repair,
          counts: terminalCounts(),
        });
        return;
      }
      if (terminal.type === 'failure') {
        logGenFailureShown({
          stage: 'terminal failure event',
          reason: terminal.reason,
          observedRepairAttempts: counts.repair,
          failureClass: 'GenerationFailureEvent',
          diagnostics: terminal.diagnostics,
        });
        showStreamFailure({
          attemptId,
          editing,
          prompt: building.text,
          reason: terminal.reason,
          hints: terminal.diagnostics.map((d) => ({ hint: d.hint })),
          observed: counts.repair,
          counts: terminalCounts(),
        });
        return;
      }

      // The stream ended with a deliverable result: the terminal entry is written HERE, at the end
      // of the stream and before delivery starts, carrying no failure field.
      journal.appendTerminal(attemptId, terminalCounts());
      live = withDelivering(live);
      liveRef.current = { id: attemptId, screen: live };
      setScreen((s) => (s.kind === 'build' ? withDelivering(s) : s));
      // Store first, index second, pending record deleted LAST (design D5) — a process death
      // anywhere inside this await leaves the record behind to surface as `interrupted`.
      const delivered = await deliverAndSettle(pending, {
        access,
        appId: attemptId,
        editing,
        text: building.text,
        wire: terminal.app,
        summary: terminal.summary,
      });
      // Delivery landed: the attempt's journal becomes the delivered app's retained last-run
      // report, under the id the app NOW has (a behind-tip rebuild delivers onto a fork, whose id
      // is not the attempt's). After the delivery, never before it — a death in between loses the
      // report and nothing else (design D5).
      journal.moveToLastRun(attemptId, delivered.id);
      releaseLiveRef(attemptId);
      refresh();
      if (ctl.detached) return; // "Leave it running": delivered silently, the user is elsewhere
      setScreen((s) => (s.kind === 'build' ? doneStep(s, delivered) : s));
    } catch (e) {
      if (ctl.cancelled) return;
      releaseGenRef(ctl);
      logGenError('build failed', e);
      const reasoned = errorReason(e);
      settleFailed(attemptId, reasoned.reason, reasoned.diagnostics, terminalCounts());
      setScreen(failure(editing, building.text, e, 'build failed', counts.repair, attemptId));
    }
  };

  /** The approval gate's action — the first moment a generation request is sent. */
  const onBuildIt = async (from: PlanScreen) => {
    await runAttempt(buildStep(from));
  };

  /** `Leave it running`: back to the shell WITHOUT cancelling — the run finishes and its result
   *  is still delivered, it just no longer takes over the screen. Its record stays `building`, so
   *  the grid keeps showing the ghost for as long as the stream is in flight. */
  const onLeaveRunning = () => {
    const ctl = genRef.current;
    if (ctl) ctl.detached = true;
    goHome();
  };

  /** Hardware back out of the build step (design "cancel-on-navigate-away"): aborts the in-flight
   *  request, deletes the attempt's pending record and returns to compose with the text preserved
   *  — nothing is installed or updated, since the generation loop bails out on `ctl.cancelled`
   *  before ever reaching delivery, and no ghost or failure record is left behind. */
  const onCancelGeneration = (editing: InstalledApp | undefined, text: string) => {
    abortLiveAttempt();
    openCompose(editing, text);
  };

  // ── Ghost-tile handlers (design D7) ────────────────────────────────────────────────────────
  // The grid's four entry points into a pending-build record. Chain-3's tiles bind them;
  // `handoff/ghost-handlers.md` is their contract.

  /** The failure screen for a `failed`/`interrupted` record, hydrated from what was PERSISTED —
   *  no live stream is involved, so the observed-repair count is zero rather than invented, and an
   *  `interrupted` record (which never carried a payload, because nothing failed) says so. */
  const failureFromRecord = (rec: PendingBuildRecord): Screen => {
    const edited = rec.editingAppId ? index.get(rec.editingAppId) : null;
    return {
      kind: 'failure',
      ...(edited ? { editing: edited } : {}),
      prompt: rec.prompt,
      reason: rec.failure?.reason ?? COPY.interruptedBuildReason,
      diagnostics: hydratedDiagnostics(rec.failure),
      observedRepairAttempts: 0,
      hasWorkingVersion: edited != null,
      pendingId: rec.id,
      journalId: rec.id,
    };
  };

  /** Tap a ghost. `building` reattaches to the run's own build-progress screen — the stream is
   *  still in this shell's closure, so this is a screen-state change and no new request is sent;
   *  reattaching also un-detaches it, so its done step lands as if the user had never left.
   *  `failed`/`interrupted` opens the hydrated failure screen instead. */
  const onOpenPending = (rec: PendingBuildRecord) => {
    if (rec.state !== 'building') {
      setScreen(failureFromRecord(rec));
      return;
    }
    const live = liveRef.current;
    if (live?.id !== rec.id) {
      // Reachable, and not only after a crash: `liveRef` holds ONE attempt, so two overlapping
      // attempts (a "Leave it running" plus a Retry or a new build) leave the older one's
      // `building` ghost pointing at a run this ref no longer names. The `releaseLiveRef` guards
      // stop an older attempt stranding a NEWER one; they cannot make this branch unreachable.
      // Nothing is lost either way — the run still delivers or settles on its own — so the honest
      // response is a logged no-op rather than an invented screen.
      log.warn(CHANNELS.gen, 'building ghost has no live run to reattach to', { pendingId: rec.id });
      return;
    }
    if (genRef.current) genRef.current.detached = false;
    setScreen(live.screen);
  };

  /** Cancel from a `building` ghost's quick actions: the same abort + delete the build step's own
   *  back press does, without taking the user off the grid. */
  const onCancelPending = (rec: PendingBuildRecord) => {
    if (liveRef.current?.id === rec.id) {
      abortLiveAttempt();
      return;
    }
    dropAttempt(rec.id);
    refresh();
  };

  /** Dismiss a `failed`/`interrupted` record, from its quick actions or its failure screen: the
   *  record is deleted and its ghost stops rendering. */
  const onDismissPending = (rec: PendingBuildRecord) => {
    dropAttempt(rec.id);
    goHome();
  };

  /** Leave a failure screen without acting on the attempt at all — the honest counterpart to
   *  Dismiss, and what the hardware back gesture performs. It touches NO store: the record keeps
   *  its ghost tile and its run journal stays readable, so a user who only wanted to read the
   *  failure can walk away without destroying it. */
  const onLeaveFailure = () => {
    goHome();
  };

  /** Retry from a hydrated failure screen: a NEW generation from the record's stored prompt,
   *  reusing the same launcher id, so the ghost the user is looking at is the one that resolves. */
  const onRetryPending = async (rec: PendingBuildRecord) => {
    const edited = rec.editingAppId ? index.get(rec.editingAppId) : null;
    await runAttempt(retryBuildScreen(rec, edited ?? undefined), rec.id);
  };

  /** The what-happened section's entries, read ONCE per failure screen shown — `screen` is a new
   *  object only when the shell navigates, so no render or tick re-reads the store. A missing or
   *  unreadable journal reads as `null` and the section falls back to its empty note; nothing else
   *  about the screen depends on it. */
  const failureJournal = useMemo(
    () => (screen.kind === 'failure' && screen.journalId != null ? journal.get(screen.journalId) : null),
    [screen, journal],
  );

  /** The build screen's Details affordance: ONE read of the in-flight attempt's journal, at the
   *  moment the user asks for it. */
  const onShowDetails = () => {
    const id = liveRef.current?.id;
    setTimeline((id != null ? journal.get(id) : null) ?? []);
  };

  /**
   * The failure screen's actions. Back is the same non-destructive leave in every shape; the
   * primary is Retry when the screen was hydrated from a ghost (`pendingId`) and Rephrase when it
   * was shown live. Discard is offered ONLY when there is an attempt to discard, and it always
   * deletes one: a hydrated ghost's record, or — for a live failure that already settled one
   * (`recordId`, every ending that went through `settleFailed`) — that record. Both go through
   * `onDismissPending`, so record and journal die together in the shell's single deletion path.
   * The clarify and rewrite failures fail before any attempt exists, so they get NO Discard at all
   * rather than one that would merely navigate under a destructive label. A record discarded
   * elsewhere in the meantime drops the button the same way, instead of acting on a ghost that is
   * no longer there.
   */
  const failureActions = (s: Extract<Screen, { kind: 'failure' }>) => {
    const ghost = s.pendingId != null ? pending.get(s.pendingId) : null;
    if (ghost != null) {
      return {
        retryable: true,
        onRephrase: () => onRetryPending(ghost),
        onBack: onLeaveFailure,
        onDismiss: () => onDismissPending(ghost),
      };
    }
    const settled = s.recordId != null ? pending.get(s.recordId) : null;
    return {
      retryable: false,
      onRephrase: () => openCompose(s.editing, s.prompt),
      onBack: onLeaveFailure,
      ...(settled != null ? { onDismiss: () => onDismissPending(settled) } : {}),
    };
  };

  // v2: the shell is fixed and always light (paper), never dark — see theme.ts.
  const statusBarStyle = 'dark-content';

  let content: React.ReactNode;
  if (!ready) {
    content = (
      <View style={styles.loading}>
        <HomeGridSkeleton
          count={knownAppCount}
          columns={HOME_GRID_COLUMNS}
          gap={HOME_GRID_COLUMN_GAP}
          color={palette.card}
        />
      </View>
    );
  } else if (screen.kind === 'app') {
    content = (
      <MiniAppView
        key={screen.app.id}
        record={screen.record}
        bundleSource={screen.source}
        engineAppId={screen.engineAppId}
        theme={theme}
        onExit={goHome}
        onVersions={() => onHistory(screen.app)}
        onChangeIt={() => openCompose(screen.app)}
      />
    );
  } else if (screen.kind === 'dev') {
    content = <DevProbeScreen onExit={goHome} />;
  } else if (screen.kind === 'settings') {
    content = (
      <SettingsScreen
        onBack={goHome}
        serverUrl={serverUrl}
        onServerUrlChange={onServerUrlChange}
        highlighting={highlighting}
        onHighlightingChange={onHighlightingChange}
      />
    );
  } else if (screen.kind === 'history') {
    content = (
      <HistoryScreen
        app={screen.app}
        access={access}
        onBack={goHome}
        onChangeIt={(app) => openCompose(app)}
      />
    );
  } else if (screen.kind === 'compose') {
    const from = screen;
    content = (
      <ComposeStep
        text={from.text}
        serverConfigured={clientOptions != null}
        busy={busy}
        onChangeText={(text) => setScreen({ ...from, text })}
        onContinue={() => onComposeContinue(from)}
        onBack={() => goBack(from)}
        onOpenSettings={() => {
          leaveFlowStep('compose');
          setScreen({ kind: 'settings' });
        }}
      />
    );
  } else if (screen.kind === 'clarify') {
    const from = screen;
    content = (
      <ClarifyStep
        prompt={from.text}
        questions={from.questions}
        answers={from.answers}
        busy={false}
        onAnswer={(id, answer) => setScreen(withAnswer(from, id, answer))}
        onContinue={() => openPlan(from)}
        onBack={() => goBack(from)}
      />
    );
  } else if (screen.kind === 'plan') {
    const from = screen;
    content = (
      <PlanStep
        rows={from.rows}
        loading={from.loading}
        onChangeRow={(rowIndex, text) => setScreen(updatePlanRow(from, rowIndex, text))}
        onBuild={() => onBuildIt(from)}
        onBack={() => goBack(from)}
      />
    );
  } else if (screen.kind === 'build') {
    const from = screen;
    content = (
      <>
        <BuildStep
          stage={from.stage}
          delivering={from.delivering}
          signals={signalsRef.current}
          now={Date.now()}
          onLeaveRunning={onLeaveRunning}
          onCancel={() => onCancelGeneration(from.editing, from.text)}
          onShowDetails={onShowDetails}
        />
        {timeline !== null && (
          <View style={[styles.timelineOverlay, { backgroundColor: palette.bg }]}>
            {/* The inset edges are DEFINED here, so the padding that keeps the list off them has
                to live on an inner view — an absolutely-positioned box ignores its own padding. */}
            <View style={styles.timelineBody}>
              <RunTimeline entries={timeline} devMode={timelineDevMode} />
            </View>
            <TouchableOpacity
              onPress={() => setTimeline(null)}
              accessibilityRole="button"
              style={[styles.timelineClose, { borderColor: palette.cardBorder }]}
            >
              <Text style={[TYPE_SCALE.bodyEmphatic, { color: palette.textMuted }]}>{COPY.timelineClose}</Text>
            </TouchableOpacity>
          </View>
        )}
      </>
    );
  } else if (screen.kind === 'done') {
    const from = screen;
    content = (
      <DoneStep app={from.app} onOpen={() => onOpen(from.app)} onBackToApps={goHome} />
    );
  } else if (screen.kind === 'failure') {
    content = (
      <FailureScreen
        reason={screen.reason}
        diagnostics={screen.diagnostics}
        observedRepairAttempts={screen.observedRepairAttempts}
        hasWorkingVersion={screen.hasWorkingVersion}
        journal={failureJournal}
        attemptStarted={screen.journalId != null}
        devMode={timelineDevMode}
        {...failureActions(screen)}
      />
    );
  } else {
    content = (
      <HomeScreen
        apps={apps}
        pending={pendingBuilds}
        onOpen={onOpen}
        onFork={onFork}
        onDelete={onDelete}
        appBusy={appBusy}
        onHistory={onHistory}
        onPromptAgain={(app) => openCompose(app)}
        onCreate={() => openCompose()}
        onSettings={() => setScreen({ kind: 'settings' })}
        onOpenDevProbe={__DEV__ ? () => setScreen({ kind: 'dev' }) : undefined}
        onOpenPending={onOpenPending}
        onCancelPending={onCancelPending}
        onDismissPending={onDismissPending}
      />
    );
  }

  // The boundary wraps the screen switch's `content` and NOTHING above it (design D1): a screen
  // that throws loses its own subtree, while the safe-area frame and the status-bar inset — the
  // blank-screen failure mode this exists to remove — still render. `screen.kind` is both the
  // failing-screen identifier in the log record and the reset key, so navigating away and back
  // re-attempts a screen that failed once.
  return (
    <HighlightingProvider enabled={highlighting}>
      <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: palette.bg }]}>
        <StatusBar barStyle={statusBarStyle} />
        <ScreenBoundary screen={screen.kind} FallbackComponent={ScreenErrorFallback}>
          {content}
        </ScreenBoundary>
        <DevLogTools palette={palette} />
      </SafeAreaView>
    </HighlightingProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: { flex: 1, padding: SPACING.lg },
  // The details view sits OVER the build screen rather than replacing it: the run carries on
  // behind it, and closing it returns to a progress screen that never went away.
  timelineOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  timelineBody: { flex: 1, paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg },
  timelineClose: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.card,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
  },
  devLogBtn: {
    position: 'absolute',
    right: SPACING.md,
    bottom: SPACING.md,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    borderWidth: 1,
    borderRadius: RADIUS.chip,
  },
});
