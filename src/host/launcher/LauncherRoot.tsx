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
import { StatusBar, StyleSheet, Text, TouchableOpacity, View, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Diagnostic, GenerationEvent, RunSummary, WireAppRecord } from '@whim/contract';
import { APP_RECORDS } from '../../runtime/generated/app-records';
import { APP_BUNDLES } from '../../runtime/generated/app-bundles';
import { RADIUS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import { log } from '../logging';
import { CHANNELS } from '../logging/channels';
import type { AppManifest, AppRecord } from '../bridge';
import type { SchemaArtifact } from '../storage-engine';
import { createPersistentStore } from '../version-store';
import { createMmkvBackend } from '../version-store/fs/mmkv-backend';
import type { KVBackend } from '../version-store/fs/kv-fs';
import { deleteStorage, peekAppliedSchema } from '../storage-engine';
import { HighlightingProvider } from '../ui/whim-prose/WhimProse';
import { AppIndex, InstalledApp } from './app-index';
import { StoreAccess } from './store-access';
import { buildGenerateRequest } from './generation-request';
import { seedFirstRun, SeedSpec } from './seed';
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
import { HomeGridSkeleton } from './flow-skeletons';
import { liftManifestTileColor } from './manifest-tile-color';
import { promptEnvelope } from './prompt-envelope';
import {
  acceptClarifyQuestions,
  backFrom,
  buildStep,
  clarifyStep,
  clarificationsFrom,
  composeStep,
  doneStep,
  isClarifySkip,
  planStep,
  reopenCompose,
  stepAfterClarifyExchange,
  withAnswer,
  withDelivering,
  withPlan,
  withStage,
} from './prompt-flow';
import type { ClarifyScreen, ComposeScreen, FlowQuestion, FlowScreen, PlanScreen } from './prompt-flow';
import { shellPalette } from './theme';
import { ThemeProvider, useTheme } from './theme-context';
import { loadServerUrl, saveServerUrl } from './server-address';
import { loadHighlighting, saveHighlighting } from './highlighting';
import { getDeviceId } from './device-id';
import { GenerationClientError, clarifyPrompt, generateApp, rewritePrompt } from './generation-client';
import type { ClientOptions } from './generation-client';
import { isAtTip } from './history-logic';

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

/** A fresh, sufficiently-unique launcher id for a brand-new install. Not a security-sensitive
 *  value (only used as a local index/store key), so a timestamp+random string is enough — no new
 *  dependency, mirrors `StoreAccess.fork`'s own cheap id construction in spirit. */
function freshAppId(): string {
  // eslint-disable-next-line sonarjs/pseudo-random -- local id only, not security-sensitive
  return `app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Maps a `result` event's wire app record into the host-held `AppRecord` `install`/`update`
 *  expect (design D5 "record: <mapped from wire>"). The wire's `manifest`/`schema` only need to
 *  round-trip on the wire (`ManifestShape`/`SchemaShape` are generic records) — they are
 *  structurally the same shapes `AppManifest`/`SchemaArtifact` describe, matching every fixture
 *  `APP_RECORDS` already ships. The declared tile colour is lifted onto the host record through
 *  chain-F's one mapping function, so the grid, the history header and prose all resolve one app
 *  to one colour. `schemaArtifact` is omitted entirely when the wire schema has no keys, the same
 *  "only when the app actually declares storage" convention every other record in
 *  `app-records.ts` follows. */
function mapWireRecord(appId: string, wire: WireAppRecord): AppRecord {
  const hasSchema = Object.keys(wire.schema).length > 0;
  return {
    appId,
    name: wire.name,
    manifest: { ...(wire.manifest as unknown as AppManifest), ...liftManifestTileColor(wire.manifest) },
    ...(hasSchema ? { schemaArtifact: wire.schema as unknown as SchemaArtifact } : {}),
  };
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

/** D5's delivery routing: a brand-new install (no `editing`), an in-place update when `editing`
 *  is at the tip of its own history, or — when it has been restored behind its own tip — a
 *  silent shared continuation (fork with `shareData:true`, no question asked per decision #52 D2
 *  / the `linked-apps` spec) followed by an update onto that fork. The ONLY three `StoreAccess`
 *  call shapes a `result` event may produce (spec "Delivery only through StoreAccess").
 *
 *  `text` is the user's VERBATIM prompt (not the rewritten one) and `summary` the run's summary
 *  when it produced one — together the `{v:2, text, summary?}` envelope the snapshot tracks. */
async function deliverResult(
  access: StoreAccess,
  editing: InstalledApp | undefined,
  text: string,
  wire: WireAppRecord,
  summary?: RunSummary,
): Promise<InstalledApp> {
  const prompt = promptEnvelope(text, summary);
  const schemaJson = Object.keys(wire.schema).length > 0 ? JSON.stringify(wire.schema) : undefined;

  if (!editing) {
    const id = freshAppId();
    const record = mapWireRecord(id, wire);
    return access.install({ id, name: record.name, record, bundleSource: wire.bundle, source: wire.source, prompt, example: false, schemaJson });
  }

  const record = mapWireRecord(editing.record.appId, wire);
  if (await isAtTip(access, editing)) {
    return access.update(editing, { record, bundleSource: wire.bundle, source: wire.source, schemaJson, prompt });
  }
  const fork = await access.fork(editing, undefined, { shareData: true });
  return access.update(fork, { record, bundleSource: wire.bundle, source: wire.source, schemaJson, prompt });
}

export default function LauncherRoot() {
  // Construct the persistent host services once (device native modules — lazy under the hood).
  // The device id, server address and highlighting flag all read from the SAME `whim.launcher`
  // KVBackend instance the installed-apps index uses (one MMKV instance, several consumers).
  const { index, access, kv } = useMemo(() => {
    const launcherKv: KVBackend = createMmkvBackend('whim.launcher');
    const idx = new AppIndex(launcherKv);
    const store = createPersistentStore(createMmkvBackend('whim-version-store'));
    const acc = new StoreAccess({ store, index: idx, deleteStorage: (appId) => deleteStorage({ appId }) });
    return { index: idx, access: acc, kv: launcherKv };
  }, []);

  return (
    <ThemeProvider>
      <LauncherShell index={index} access={access} kv={kv} />
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

function LauncherShell({ index, access, kv }: Readonly<{ index: AppIndex; access: StoreAccess; kv: KVBackend }>) {
  const { theme } = useTheme();
  const palette = shellPalette(theme);

  const [screen, setScreen] = useState<Screen>({ kind: 'home' });
  const [apps, setApps] = useState<InstalledApp[]>([]);
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

  const refresh = () => setApps(index.list());

  // The sink's destination is the address the device ALREADY persists for `/v1/generate` (design
  // D4) — no second setting. It stays inert until both the flag and an address are set, so this
  // runs on every address change and is a no-op in every build that ships.
  useEffect(() => {
    log.sink.configure({ enabled: SEND_DEV_LOGS, baseUrl: serverUrl });
  }, [serverUrl]);

  useEffect(() => {
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

  const onOpen = async (app: InstalledApp) => {
    try {
      const source = await access.activeBundle(app);
      setScreen({ kind: 'app', app, record: app.record, source, engineAppId: access.engineAppId(app) });
    } catch (e) {
      // The user still gets the alert; the class/message/stack of what actually failed is only
      // recoverable from the seam (host-observability "The alert paths now log").
      log.error(CHANNELS.app, 'installed-app action failed', { operation: 'open', ...errorFields(e) });
      Alert.alert('Could not open this app', (e as Error)?.message ?? String(e));
    }
  };

  const onFork = async (app: InstalledApp, opts: { shareData: boolean }) => {
    try {
      await access.fork(app, undefined, opts);
      refresh();
    } catch (e) {
      log.error(CHANNELS.app, 'installed-app action failed', { operation: 'fork', ...errorFields(e) });
      Alert.alert('Could not fork this app', (e as Error)?.message ?? String(e));
    }
  };

  const onHistory = (app: InstalledApp) => {
    setScreen({ kind: 'history', app });
  };

  const onDelete = async (app: InstalledApp) => {
    try {
      await access.remove(app);
      refresh();
    } catch (e) {
      log.error(CHANNELS.app, 'installed-app action failed', { operation: 'delete', ...errorFields(e) });
      Alert.alert('Could not delete this app', (e as Error)?.message ?? String(e));
    }
  };

  const goHome = () => {
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
  ): Screen => {
    const reasoned = errorReason(err);
    logGenFailureShown({ stage, reason: reasoned.reason, observedRepairAttempts: observed, err });
    return {
      kind: 'failure',
      editing,
      prompt,
      ...reasoned,
      observedRepairAttempts: observed,
      // The app being edited already has a working version installed; a brand-new app has none.
      hasWorkingVersion: editing != null,
    };
  };

  const openCompose = (editing?: InstalledApp, text?: string) => setScreen(composeStep(editing, text ?? ''));

  const goBack = (from: FlowScreen) => {
    const target = backFrom(from);
    if (target === 'home') goHome();
    else if (target) setScreen(target);
  };

  /** Fetch the plan and show it: the step opens immediately under its row skeleton, and its own
   *  primary action stays busy until the rewrite response lands. */
  const openPlan = async (prev: ComposeScreen | ClarifyScreen) => {
    if (!clientOptions) return;
    const pending = planStep(prev);
    setScreen(pending);
    try {
      const response = await rewritePrompt(
        clientOptions,
        pending.text,
        clarificationsFrom(pending.questions, pending.answers),
      );
      setScreen((s) => (s.kind === 'plan' ? withPlan(s, response) : s));
    } catch (e) {
      logGenError('rewrite failed', e);
      const failed = failure(pending.editing, pending.text, e, 'rewrite failed');
      setScreen((s) => (s.kind === 'plan' ? failed : s));
    }
  };

  /** compose → clarify, or straight past it when the exchange has nothing to ask. A clarify
   *  `502` means "skip to the plan step", not a dead end (`isClarifySkip`). */
  const onComposeContinue = async (from: ComposeScreen) => {
    if (!clientOptions) return;
    setBusy(true);
    let questions: FlowQuestion[] = [];
    try {
      questions = acceptClarifyQuestions((await clarifyPrompt(clientOptions, from.text)).questions);
    } catch (e) {
      if (!isClarifySkip(e)) {
        logGenError('clarify failed', e);
        setBusy(false);
        setScreen(failure(from.editing, from.text, e, 'clarify failed'));
        return;
      }
    }
    setBusy(false);
    if (stepAfterClarifyExchange(questions) === 'clarify') {
      setScreen(clarifyStep(from, questions));
    } else {
      await openPlan(from);
    }
  };

  /** The approval gate's action — the first moment a generation request is sent. */
  const onBuildIt = async (from: PlanScreen) => {
    if (!clientOptions) return;
    const building = buildStep(from);
    setScreen(building);

    const controller = new AbortController();
    const ctl = { controller, cancelled: false, detached: false };
    genRef.current = ctl;
    const editing = building.editing;
    // Declared outside the try so a throw mid-stream still knows what the device observed.
    const counts: EventCounts = { stage: 0, token: 0, diagnostic: 0, repair: 0 };

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
        if (event.type === 'stage') {
          setScreen((s) => (s.kind === 'build' ? withStage(s, event.stage) : s));
        } else if (event.type === 'result' || event.type === 'failure') {
          terminal = event;
        }
      }

      if (ctl.cancelled) return; // cancel-on-navigate-away: nothing installed/updated
      genRef.current = null;

      if (terminal == null) {
        // Stream ended with no terminal event and no cancel — a stream error, not a crash.
        log.error(CHANNELS.gen, 'stream ended with no terminal event', { ...counts });
        logGenFailureShown({
          stage: 'stream ended with no terminal event',
          reason: GENERIC_STREAM_ERROR,
          observedRepairAttempts: counts.repair,
          failureClass: 'StreamEndedWithoutTerminalEvent',
        });
        setScreen({
          kind: 'failure',
          editing,
          prompt: building.text,
          reason: GENERIC_STREAM_ERROR,
          diagnostics: [],
          observedRepairAttempts: counts.repair,
          hasWorkingVersion: editing != null,
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
        setScreen({
          kind: 'failure',
          editing,
          prompt: building.text,
          reason: terminal.reason,
          diagnostics: terminal.diagnostics.map((d) => ({ hint: d.hint })),
          observedRepairAttempts: counts.repair,
          hasWorkingVersion: editing != null,
        });
        return;
      }

      setScreen((s) => (s.kind === 'build' ? withDelivering(s) : s));
      const delivered = await deliverResult(access, editing, building.text, terminal.app, terminal.summary);
      refresh();
      if (ctl.detached) return; // "Leave it running": delivered silently, the user is elsewhere
      setScreen((s) => (s.kind === 'build' ? doneStep(s, delivered) : s));
    } catch (e) {
      if (ctl.cancelled) return;
      genRef.current = null;
      logGenError('build failed', e);
      setScreen(failure(editing, building.text, e, 'build failed', counts.repair));
    }
  };

  /** `Leave it running`: back to the shell WITHOUT cancelling — the run finishes and its result
   *  is still delivered, it just no longer takes over the screen. */
  const onLeaveRunning = () => {
    const ctl = genRef.current;
    if (ctl) ctl.detached = true;
    goHome();
  };

  /** Hardware back out of the build step (design "cancel-on-navigate-away"): aborts the in-flight
   *  request and returns to compose with the text preserved — nothing is installed or updated,
   *  since the generation loop bails out on `ctl.cancelled` before ever reaching `deliverResult`. */
  const onCancelGeneration = (editing: InstalledApp | undefined, text: string) => {
    const ctl = genRef.current;
    if (ctl) {
      ctl.cancelled = true;
      ctl.controller.abort();
      genRef.current = null;
    }
    openCompose(editing, text);
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
        onOpenSettings={() => setScreen({ kind: 'settings' })}
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
        onEditRow={(row) => setScreen(reopenCompose(from, row))}
        onBuild={() => onBuildIt(from)}
        onBack={() => goBack(from)}
      />
    );
  } else if (screen.kind === 'build') {
    const from = screen;
    content = (
      <BuildStep
        stage={from.stage}
        delivering={from.delivering}
        onLeaveRunning={onLeaveRunning}
        onCancel={() => onCancelGeneration(from.editing, from.text)}
      />
    );
  } else if (screen.kind === 'done') {
    const from = screen;
    content = (
      <DoneStep app={from.app} onOpen={() => onOpen(from.app)} onBackToApps={goHome} />
    );
  } else if (screen.kind === 'failure') {
    const { editing, prompt } = screen;
    content = (
      <FailureScreen
        reason={screen.reason}
        diagnostics={screen.diagnostics}
        observedRepairAttempts={screen.observedRepairAttempts}
        hasWorkingVersion={screen.hasWorkingVersion}
        onRephrase={() => openCompose(editing, prompt)}
        onDismiss={goHome}
      />
    );
  } else {
    content = (
      <HomeScreen
        apps={apps}
        onOpen={onOpen}
        onFork={onFork}
        onDelete={onDelete}
        onHistory={onHistory}
        onPromptAgain={(app) => openCompose(app)}
        onCreate={() => openCompose()}
        onSettings={() => setScreen({ kind: 'settings' })}
        onOpenDevProbe={__DEV__ ? () => setScreen({ kind: 'dev' }) : undefined}
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
