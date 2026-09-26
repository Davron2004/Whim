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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, StatusBar, StyleSheet, Text, TouchableOpacity, View, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Diagnostic, GenerationEvent } from '@whim/contract';
import { APP_RECORDS } from '../../runtime/generated/app-records';
import { APP_BUNDLES } from '../../runtime/generated/app-bundles';
import { DEFAULT_THEME, RADIUS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import { log } from '../logging';
import { CHANNELS } from '../logging/channels';
import type { DiagnosticReason } from '../logging/diagnostic';
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
  refusedGenerateOutcome,
  retryBuildScreen,
  settleRefusedGenerate,
  startPendingBuild,
} from './build-lifecycle';
import { APP_CONTEXT_DESCRIPTION_MAX_CHARS, buildGenerateRequest, buildRewriteAppContext } from './generation-request';
import { seedFirstRun, SeedSpec } from './seed';
import { COPY, LEGAL_COPY } from './copy';
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
import ConsentScreen from './ConsentScreen';
import TermsScreen from './TermsScreen';
import AgeScreen from './AgeScreen';
import AppLinkMissingScreen from './AppLinkMissingScreen';
import UpdateRequiredScreen from './UpdateRequiredScreen';
import { parseAppLink } from './app-link';
import { schemeAndHostOf } from './scheme-host';
import { resolveAppLink, linkExitFor, PendingLinkHolder } from './link-routing';
import type { LinkExit } from './link-routing';
import ScreenBoundary from './ScreenBoundary';
import ScreenErrorFallback from './ScreenErrorFallback';
import { SCREEN_EXITS, frameEdgesFor } from './screen-exits';
import DevLogOverlay from './DevLogOverlay';
import { devLogOverlayEnabled } from './dev-log-view';
import RunDetailsSheet from './RunDetailsSheet';
import { runTimelineDevModeEnabled } from './run-timeline-view';
import { HomeGridSkeleton } from './flow-skeletons';
import {
  EMPTY_RUN_AGGREGATES,
  RUN_SIGNAL_TICK_MS,
  acceptClarifyQuestions,
  backFrom,
  buildBackAction,
  buildStep,
  clarifyLimitOf,
  clarifyStep,
  clarificationsFrom,
  composeStep,
  composeTextChanged,
  doneStep,
  isClarifySkip,
  planStep,
  stepAfterClarifyExchange,
  updatePlanRow,
  withAnswer,
  withDelivering,
  withKeepalive,
  withLimit,
  withPlan,
  withQuestions,
  withStreamEvent,
} from './prompt-flow';
import type { BuildScreen, ClarifyScreen, ComposeScreen, FlowLimit, FlowNotice, FlowQuestion, FlowScreen, PlanScreen, RunSignals } from './prompt-flow';
import { fallbackNotice, terminalFallbackOf } from './wire-fallback';
import { FlowRequests, onlyOnStep } from './flow-request';
import { SHELL_PALETTE } from './theme';
import { clearServerUrl, effectiveServerUrl, saveServerUrl, serverOverride } from './server-address';
import { probeServerHealth } from './server-probe';
import { ConnectivityLoop } from './connectivity';
import type { Connectivity } from './connectivity';
import { showOfflineIndicator, showServerUnreachableNotice } from './connectivity-ux';
import { loadHighlighting, saveHighlighting } from './highlighting';
import { getDeviceId, resetDeviceId } from './device-id';
import { errorDetailsEnabled, setErrorDetails } from './error-details';
import { GenerationClientError, clarifyPrompt, consentedClientOptions, generateApp, rewritePrompt } from './generation-client';
import type { ClientOptions, ConsentedClientOptions, GenerationStream } from './generation-client';
import { reportClientOptions } from './transport-shared';
import type { AppInfo } from './app-info';
import { installedAppInfo, installedInternalBuild } from './installed-app-info';
import ReportSheet from './ReportSheet';
import { consentStatus, grantConsent, outdatedGrantVersion, revokeConsent } from './ai-consent';
import { acceptTerms, termsStatus } from './terms-acceptance';
import { runAgeCheck, storedAgeGate, type AgeGate, type AgeHold, type SignificantUpdateSheet } from './age-check';
import { installedAgeSignal, installedSignificantUpdate } from './installed-age-signal';
import { activeLegalLanguage, chooseLegalLanguage, type LegalLanguage } from './legal-language';
import { deviceLocale as installedDeviceLocale } from './device-locale';
import { declineTarget, nextLegalStep } from './consent-flow';
import type { ConsentContinuation, LegalFlow } from './consent-flow';
import { REFUSAL_RULES, refusalText, retryAtOf, serviceRefusalOf } from './service-refusal';
import type { ServiceRefusal } from './service-refusal';
import { rewriteRefusalTarget } from './refusal-target';
import type { RefusalSentFrom } from './refusal-target';
import { useNoticeWindowClear } from './ServiceNotice';
import { errorReason, errorReasonCode, GENERIC_STREAM_ERROR } from './error-reason';
import { liveClientOptions } from './consent-options';
import { resolveOptions } from './resolve-options';
import { probeGateFor } from './probe-gate';
import { belowMinimumBuild } from './update-gate';

/** A prompt typed on a flow step the update screen replaced, and the app it was for (absent = a new
 *  app). */
interface HeldPrompt {
  readonly editing?: InstalledApp;
  readonly text: string;
}

type Screen =
  | { kind: 'home' }
  | { kind: 'app'; app: InstalledApp; record: AppRecord; source: string; engineAppId: string }
  | { kind: 'dev' }
  | { kind: 'settings' }
  | { kind: 'history'; app: InstalledApp }
  // An app link's id matched neither an installed app nor a pending build (design D15; spec
  // app-links "A link to an app that isn't on this phone shows a friendly screen").
  | { kind: 'link-missing' }
  // The update screen (request-envelope D5; spec app-update-gate): an `update_required` refusal, or
  // the launch-time check finding this build below its platform's minimum. `heldPrompt` is the
  // prompt typed on the flow step it replaced: `Not now` goes Home (D5), so the next compose for
  // the same app picks it back up rather than losing it. `updateNotice` is the plain-text notice
  // of a message this build can't use whose fallback opened the screen (beta-1 D16).
  | { kind: 'update-required'; heldPrompt?: HeldPrompt; updateNotice?: string }
  // The legal flow (legal-surface-v2 design D5; `consent-flow.ts`): the terms step, then the
  // ask-mode consent screen, each open in place of a data-sending action taken without a current
  // terms acceptance / consent grant. Both carry the flow (`LegalFlow`): the continuation to
  // resume, the screen the flow replaced (`returnTo`, read by `declineTarget`), and `refused` — a
  // `consent_required` refusal started it (request-envelope), not an entry point.
  // `age` comes first while the terms step is due (legal-surface-v2 D11; spec store-age-signals):
  // the store's age signal is being read (no `held`), or it held the user (`held`: why, which
  // picks the message). `outdated`: the stored acceptance is of another terms version.
  | ({ kind: 'age'; held?: AgeHold } & LegalFlow<Screen>)
  | ({ kind: 'terms'; outdated: boolean } & LegalFlow<Screen>)
  // The AI-data consent gate (design D1/D2/D5; spec ai-data-consent). `review` opens from
  // Settings' AI features row and shows the identical disclosure.
  // `outdatedFrom`: the stored grant's version when that grant is outdated.
  | ({ kind: 'consent'; mode: 'ask'; outdatedFrom?: number } & LegalFlow<Screen>)
  | { kind: 'consent'; mode: 'review' }
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
      /** A refused Retry's notice (design D9/D10): set only for the moment a live refusal is
       *  still showing on this exact screen — never resurrected from a hydrated ghost, since the
       *  retry window is not persisted (design D11: "the server stays authoritative"). */
      notice?: FlowNotice;
    };

/** The update screen in place of `from`, holding the prompt typed there when `from` is a flow step
 *  that has one, and showing `notice` when a fallback opened it. Pure, so it can run inside a
 *  `setScreen` updater. */
function updateScreenFrom(from: Screen, notice?: string): Screen {
  const shown = notice === undefined ? {} : { updateNotice: notice };
  if ((from.kind === 'compose' || from.kind === 'clarify' || from.kind === 'plan') && from.text !== '') {
    return { kind: 'update-required', heldPrompt: { editing: from.editing, text: from.text }, ...shown };
  }
  return { kind: 'update-required', ...shown };
}

/** Where the update screen may open when the user's current action did not ask for it — the
 *  launch-time check's verdict, or a build left running being refused: Home, or a prompt being
 *  typed. Anywhere else, above all a running mini-app, the user carries on, and their next AI
 *  action shows the screen. */
function updateMayInterrupt(screen: Screen): boolean {
  return screen.kind === 'home' || screen.kind === 'compose';
}

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

/** The taxonomy `errorReason()` intentionally scrubs off the screen, as named fields: error class,
 *  GenerationClientError kind/status/hint/requestId, message, stack. Never prompt text or generated
 *  source. `requestId` is the id of the request the error is about (request-envelope D6): the
 *  error's own, else `streamRequestId`, the id of the generation stream it happened on. */
function errorFields(err: unknown, streamRequestId?: string): Record<string, unknown> {
  const isErr = err instanceof Error;
  const clientError = err instanceof GenerationClientError ? err : undefined;
  return {
    errorClass: isErr ? err.constructor.name : typeof err,
    ...(clientError ? { kind: clientError.kind, status: clientError.status, hint: clientError.hint } : {}),
    requestId: clientError?.requestId ?? streamRequestId,
    message: isErr ? err.message : undefined,
    stack: isErr ? err.stack : undefined,
  };
}

/** Breadcrumb for a swallowed generation-path error, on the generation channel. */
function logGenError(stage: string, err: unknown, streamRequestId?: string): void {
  log.error(CHANNELS.gen, 'generation step failed', { stage, ...errorFields(err, streamRequestId) });
}

/** A recognised service refusal turned into the notice a step screen renders (design D9/D11/D12):
 *  the hint verbatim (or the phone's own text for the code, `refusalText`), the tone
 *  `REFUSAL_RULES` assigns its code, and — only when it carried a `Retry-After` — the re-enable
 *  moment. `ServiceNotice` derives the copy-table retry line from `retryAt` fresh on every render,
 *  so nothing here precomputes or caches that text. */
function noticeFrom(refusal: ServiceRefusal): FlowNotice {
  const retryAt = retryAtOf(refusal, Date.now());
  return {
    hint: refusalText(refusal),
    tone: REFUSAL_RULES[refusal.code].tone,
    ...(retryAt !== undefined ? { retryAt } : {}),
  };
}

/** Every service refusal is recorded through the logging seam with its code, status and which
 *  request it refused (`service-refusals` "The refusal is recoverable from the log"). */
function logServiceRefusal(request: 'clarify' | 'rewrite' | 'generate', refusal: ServiceRefusal): void {
  log.warn(CHANNELS.gen, 'service refusal', { request, code: refusal.code, status: refusal.status });
}

/** A reply this build can't use ended a request on its `update` fallback (beta-1 D16), recorded
 *  with the request it ended and its id — never the notice, which is the server's own text. (A
 *  `fail` fallback is recorded by the failure screen's own log record.) */
function logUpdateFallback(request: 'clarify' | 'rewrite' | 'generate', err: unknown, streamRequestId?: string): void {
  const clientError = err instanceof GenerationClientError ? err : undefined;
  log.warn(CHANNELS.gen, 'update fallback applied', {
    request,
    status: clientError?.status,
    requestId: clientError?.requestId ?? streamRequestId,
  });
}

/** Every failure screen this shell shows is ALSO recorded on the generation channel (prompt-flow
 *  "The failure is recoverable from the log"): the error class, message, stack and mapped kind,
 *  plus each diagnostic's `kind`/`symbol`/`message` — precisely the taxonomy the screen scrubs,
 *  since it may show nothing but a diagnostic's `hint`. A terminal `failure` event has no thrown
 *  error, so its own class name stands in for one and its `reason` for the message.
 *
 *  `reason` is the closed code (`DIAGNOSTIC_REASONS`), the one field of these the diagnostics
 *  upload may carry; the sentence the screen shows stays in `detail`, on the phone. A terminal
 *  failure's sentence is written from model output — a plan's screen names come from the user's
 *  prompt — so it never goes in a field the upload projects. */
function logGenFailureShown(input: {
  stage: string;
  reasonCode: DiagnosticReason;
  /** The sentence the failure screen shows. */
  reason: string;
  observedRepairAttempts: number;
  err?: unknown;
  /** The class name to record when nothing was thrown (the two stream-shaped failures). */
  failureClass?: string;
  diagnostics?: readonly Diagnostic[];
  /** The generation stream's request id, when the failure happened on an opened stream. */
  streamRequestId?: string;
}): void {
  log.error(CHANNELS.gen, 'failure screen shown', {
    stage: input.stage,
    reason: input.reasonCode,
    detail: input.reason,
    observedRepairAttempts: input.observedRepairAttempts,
    ...(input.err === undefined
      ? {
          errorClass: input.failureClass ?? 'GenerationFailure',
          requestId: input.streamRequestId,
          stack: undefined,
        }
      : errorFields(input.err, input.streamRequestId)),
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

/** `appInfo` reads the installed app's platform, version and build for the request envelope;
 *  `internalBuild` says whether this is an internal build (only those show and honour a
 *  server-address override, legal-surface-v2 D10); `deviceLocale` reads the phone's preferred
 *  locale, which picks the legal language until the user chooses one (legal-surface-v2 D6);
 *  `ageSignal` asks the store for its age signal before the terms step (legal-surface-v2 D11), and
 *  `significantUpdate` asks a supervised minor's guardian to acknowledge a terms change (beta-1
 *  D2; none on Android). All default to the native seam. Only a suite passes another (the
 *  launcher runner has no native module), to give the shell a build or a phone of its choosing. */
export default function LauncherRoot({
  appInfo = installedAppInfo,
  internalBuild,
  deviceLocale = installedDeviceLocale,
  ageSignal = installedAgeSignal,
  significantUpdate = installedSignificantUpdate,
}: Readonly<{
  appInfo?: () => AppInfo;
  internalBuild?: boolean;
  deviceLocale?: () => string | undefined;
  ageSignal?: () => Promise<unknown>;
  significantUpdate?: SignificantUpdateSheet;
}>) {
  // Read once: the installed binary can't change what kind of build it is while the process lives.
  const [internal] = useState(() => internalBuild ?? installedInternalBuild());
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
    <LauncherShell
      index={index}
      access={access}
      pending={pending}
      journal={journal}
      kv={kv}
      appInfo={appInfo}
      internalBuild={internal}
      deviceLocale={deviceLocale}
      ageSignal={ageSignal}
      significantUpdate={significantUpdate}
    />
  );
}

/**
 * The developer log surface: the affordance and the overlay it opens, GATED TOGETHER on the same
 * predicate the overlay gates itself on — the spec asks for no affordance in a shipping build,
 * not merely a dead route. It is a modal above the live screen rather than a `Screen` variant, so
 * a developer reads the log of the screen they are looking at without navigating away from it.
 */
function DevLogTools() {
  const [open, setOpen] = useState(false);
  if (!devLogOverlayEnabled(__DEV__)) {
    return null;
  }
  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        accessibilityLabel={DEV_LOG_LABEL}
        style={[styles.devLogBtn, { backgroundColor: SHELL_PALETTE.card, borderColor: SHELL_PALETTE.cardBorder }]}
      >
        <Text style={[TYPE_SCALE.eyebrow, { color: SHELL_PALETTE.textMuted }]}>{DEV_LOG_LABEL}</Text>
      </TouchableOpacity>
      <DevLogOverlay visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

/**
 * The consent screen's two modes (design D5), in one small switch — kept out of `LauncherShell`'s
 * own screen-kind chain so branching between them never adds to that function's own complexity.
 */
function ConsentScreenForShell({
  screen,
  onAskAgree,
  onAskDecline,
  onReviewTurnOn,
  onReviewTurnOff,
  onReviewClose,
  consentOn,
  language,
  onLanguageChange,
}: Readonly<{
  screen: Extract<Screen, { kind: 'consent' }>;
  onAskAgree: (continuation: ConsentContinuation) => void;
  onAskDecline: (returnTo: Screen) => void;
  onReviewTurnOn: () => void;
  onReviewTurnOff: () => void;
  onReviewClose: () => void;
  consentOn: boolean;
  language: LegalLanguage;
  onLanguageChange: (language: LegalLanguage) => void;
}>) {
  if (screen.mode === 'ask') {
    return (
      <ConsentScreen
        mode="ask"
        language={language}
        onLanguageChange={onLanguageChange}
        outdatedFrom={screen.outdatedFrom}
        refused={screen.refused}
        onAgree={() => onAskAgree(screen.continuation)}
        onClose={() => onAskDecline(screen.returnTo)}
      />
    );
  }
  return (
    <ConsentScreen
      mode="review"
      language={language}
      onLanguageChange={onLanguageChange}
      consentOn={consentOn}
      onAgree={onReviewTurnOn}
      onTurnOff={onReviewTurnOff}
      onClose={onReviewClose}
    />
  );
}

/** The legal flow's steps ahead of the consent screen: the store age check and the terms step. */
type PreConsentStep = Extract<Screen, { kind: 'age' | 'terms' }>;

function isPreConsentStep(screen: Screen): screen is PreConsentStep {
  return screen.kind === 'age' || screen.kind === 'terms';
}

/**
 * The age check and the terms step in one small switch, kept out of `LauncherShell`'s own
 * screen-kind chain like `ConsentScreenForShell`. Both leave through `onDecline` with the screen
 * the flow replaced; only the terms step can accept.
 */
function PreConsentStepForShell({
  screen,
  language,
  onLanguageChange,
  onTermsAccept,
  onDecline,
}: Readonly<{
  screen: PreConsentStep;
  language: LegalLanguage;
  onLanguageChange: (language: LegalLanguage) => void;
  onTermsAccept: (flow: LegalFlow<Screen>) => void;
  onDecline: (returnTo: Screen) => void;
}>) {
  if (screen.kind === 'age') {
    return (
      <AgeScreen
        language={language}
        onLanguageChange={onLanguageChange}
        held={screen.held}
        onClose={() => onDecline(screen.returnTo)}
      />
    );
  }
  return (
    <TermsScreen
      language={language}
      onLanguageChange={onLanguageChange}
      outdated={screen.outdated}
      onAccept={() => onTermsAccept(screen)}
      onClose={() => onDecline(screen.returnTo)}
    />
  );
}

function LauncherShell({
  index,
  access,
  pending,
  journal,
  kv,
  appInfo,
  internalBuild,
  deviceLocale,
  ageSignal,
  significantUpdate,
}: Readonly<{
  index: AppIndex;
  access: StoreAccess;
  pending: PendingBuildStore;
  journal: RunJournalStore;
  kv: KVBackend;
  appInfo: () => AppInfo;
  internalBuild: boolean;
  deviceLocale: () => string | undefined;
  ageSignal: () => Promise<unknown>;
  significantUpdate: SignificantUpdateSheet | undefined;
}>) {
  const palette = SHELL_PALETTE;
  // The language every legal screen and link uses (legal-surface-v2 D6): resolved once at launch
  // from the stored choice or the phone's language, and replaced when the user taps a switch.
  const [phoneLocale] = useState(deviceLocale);
  const [legalLanguage, setLegalLanguage] = useState<LegalLanguage>(() => activeLegalLanguage(kv, phoneLocale));
  const onLegalLanguageChange = (language: LegalLanguage) => {
    chooseLegalLanguage(kv, language);
    setLegalLanguage(language);
  };

  const [screen, setScreen] = useState<Screen>({ kind: 'home' });
  // A sender-landing (`neutral`-tone) notice on whichever step currently carries one clears the
  // instant its retry window ends (design D12: "A sender refusal clears when its window ends").
  // Leaving the step already clears it for free — the step's own constructor never carries a
  // `notice` forward — so this only ever needs to fire while `screen` itself is unchanged; the
  // reference check below is what keeps a stale timer from clearing a DIFFERENT refusal's notice
  // that has since replaced this one on the same step.
  const noticeOnScreen = 'notice' in screen ? screen.notice : undefined;
  useNoticeWindowClear(noticeOnScreen, () => {
    setScreen((prev) => {
      if (!('notice' in prev) || prev.notice !== noticeOnScreen) return prev;
      return { ...prev, notice: undefined };
    });
  });
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [pendingBuilds, setPendingBuilds] = useState<PendingBuildRecord[]>([]);
  const [ready, setReady] = useState(false);
  // Read by the mount-once app-link listener effect below, which cannot depend on `ready` without
  // resubscribing `Linking`'s event on every first-run tick.
  const readyRef = useRef(ready);
  readyRef.current = ready;
  // The override this build honours: always `undefined` in a store build (legal-surface-v2 D10).
  const [serverUrl, setServerUrl] = useState<string | undefined>(() => serverOverride(kv, { internalBuild }));
  const [highlighting, setHighlighting] = useState<boolean>(() => loadHighlighting(kv));
  const [errorDetailsShown, setErrorDetailsShown] = useState<boolean>(() => errorDetailsEnabled(kv));
  // The report sheet's target for the done-step and history-header entry points (design D13) —
  // `null` closes it. The orb's own entry point (inside a running mini-app) is a separate, local
  // state owned by `MiniAppView` itself, since it also drives that realm's `overlayOpen` back-
  // policy input.
  const [reportTarget, setReportTarget] = useState<InstalledApp | null>(null);

  // State, not a memo: Settings' "Make a new ID" replaces it, and every options memo below is keyed
  // on it, so the next request carries the new ID.
  const [deviceId, setDeviceId] = useState(() => getDeviceId(kv));
  // The one gate `clarifyPrompt`/`rewritePrompt`/`generateApp`/the connectivity probe read their
  // options through (design D2; spec ai-data-consent "Request options ... SHALL come from one
  // gate that yields nothing without a current grant"; spec terms-acceptance "The send gate
  // requires both a terms acceptance and a consent grant"): `null` unless the terms acceptance AND
  // AI-data consent are both CURRENT. `consentTick` has no other purpose than forcing this memo to
  // re-read `termsStatus(kv)`/`consentStatus(kv)` after `acceptTerms`/`grantConsent`/
  // `revokeConsent` mutate the store out from under it (a plain KV write is not itself a React
  // dependency).
  const [consentTick, setConsentTick] = useState(0);
  const clientOptions = useMemo<ConsentedClientOptions | null>(
    () => consentedClientOptions(termsStatus(kv), consentStatus(kv), effectiveServerUrl(kv, internalBuild), deviceId, appInfo),
    // consentTick/serverUrl stand in for the KV reads above (acceptTerms/grantConsent/revokeConsent/
    // saveServerUrl mutate `kv` directly, which is not itself a React dependency) — the same
    // "extra dep forces a re-read" idiom this file's other KV-backed memos and effects already use.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [consentTick, serverUrl, deviceId, kv, appInfo, internalBuild],
  );

  /** The options a data-sending entry point acts with, RIGHT NOW: the memo when it already reflects
   *  the current grant, or a fresh live read (`consent-options.ts`) when it does not yet — the gap
   *  `onConsentAskAgree` and `onTermsAccept` fall into, since the `consentTick` bump does not
   *  retire the memo until the render AFTER this call returns (spec ai-data-consent "After the user
   *  agrees, the action they started SHALL continue as if consent had already existed"). */
  const resolveClientOptions = (): ConsentedClientOptions | null =>
    resolveOptions(clientOptions, liveClientOptions(kv, deviceId, appInfo, internalBuild));

  // Plain `ClientOptions` for the report sheet's `sendReport` call (design D3 — reporting is the
  // ONE request that needs no AI-data consent and no terms acceptance, so this is never gated the
  // way `clientOptions` above is). It still reads the grant, for the consent version its envelope
  // names, so it is keyed on `consentTick` too.
  const reportOptions = useMemo<ClientOptions>(
    () => reportClientOptions(consentStatus(kv), effectiveServerUrl(kv, internalBuild), deviceId, appInfo),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [consentTick, serverUrl, deviceId, kv, appInfo, internalBuild],
  );

  const [connectivity, setConnectivity] = useState<Connectivity>('unknown');
  const connectivityLoopRef = useRef<ConnectivityLoop | null>(null);
  const connectivityEpoch = useRef(0);

  // Capture at request start. A response belongs to the address and consent session that sent
  // it, even if a detached generation outlives a Settings edit or a revoke/regrant cycle.
  const onlineForRequest = (options: ConsentedClientOptions): (() => void) => {
    const epoch = connectivityEpoch.current;
    return () => {
      if (epoch === connectivityEpoch.current && options.baseUrl === effectiveServerUrl(kv, internalBuild)) {
        connectivityLoopRef.current?.markOnline();
      }
    };
  };

  const invalidateConnectivity = () => {
    connectivityEpoch.current += 1;
    connectivityLoopRef.current?.stop();
    connectivityLoopRef.current = null;
  };

  // `clientOptions == null` leaves `connectivity` at its `'unknown'` default — no current AI-data
  // consent grant, so there is nothing to probe (spec ai-data-consent "Nothing is sent to the
  // server before consent is granted"), distinct from `'offline'` (probed and unreachable).
  // `clientOptions` is keyed on `consentTick` above (design D2), so granting consent starts a
  // fresh `ConnectivityLoop` here and revoking it tears the old one down through the SAME cleanup
  // that runs on an address change or unmount — one effect serves startup, grant and revoke alike.
  //
  // The launch-time update check (request-envelope D5) rides on this loop's own `/healthz` probe —
  // no request and no wait of its own. Only a minimum the probe actually read, above the installed
  // build, opens the update screen; a slow, failed or minimum-less probe leaves everything as it was.
  useEffect(() => {
    const decision = probeGateFor(clientOptions);
    if (decision.kind === 'idle') {
      connectivityLoopRef.current = null;
      setConnectivity('unknown');
      return undefined;
    }
    let live = true;
    const loop = new ConnectivityLoop({
      probe: async () => {
        const health = await probeServerHealth(decision.baseUrl);
        if (live && belowMinimumBuild(appInfo, health.minBuild)) {
          log.warn(CHANNELS.app, 'installed build is below the server minimum', { ...health.minBuild });
          setScreen((prev) => (updateMayInterrupt(prev) ? updateScreenFrom(prev) : prev));
        }
        return health.result;
      },
      publish: setConnectivity,
    });
    connectivityLoopRef.current = loop;
    loop.start();
    return () => {
      live = false;
      loop.stop();
      if (connectivityLoopRef.current === loop) connectivityLoopRef.current = null;
    };
  }, [clientOptions, appInfo]);

  // A breadcrumb for every connectivity transition, the same device-observability discipline as
  // the `serverUrl`-keyed sink-config effect above: this session state has no screen surface of
  // its own yet (offline-ux-surfaces, a later change reads it off this shell), so the seam is the
  // only place a transition is currently observable.
  useEffect(() => {
    log.debug(CHANNELS.app, 'connectivity state changed', { connectivity });
  }, [connectivity]);

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

  // The edit flow's resolved description (design "the edit flow's shared clarify/rewrite
  // `app.description`"), read directly by `onComposeContinue`/`openPlan` rather than through
  // whatever screen happens to be showing: `openCompose` resolves it asynchronously and a user who
  // taps Continue before it lands must still get it on the request that follows (task: the "about"
  // race). Keyed by the editing app's id so a resolution that lands late for an app the user has
  // since left can never apply to the one now in the flow. Cleared when the flow leaves (`goHome`).
  const aboutRef = useRef<{ id: string; about: string } | null>(null);
  const aboutFor = (editing?: InstalledApp): string | undefined =>
    editing != null && aboutRef.current?.id === editing.id ? aboutRef.current.about : undefined;

  // The prompt the update screen's `Not now` carried Home (`heldPrompt`), waiting for the next
  // compose opened for the same app — taken once, then gone.
  const heldPromptRef = useRef<HeldPrompt | null>(null);
  const takeHeldPrompt = (editing?: InstalledApp): string | undefined => {
    const held = heldPromptRef.current;
    if (held == null || held.editing?.id !== editing?.id) return undefined;
    heldPromptRef.current = null;
    return held.text;
  };

  // The home grid's per-app wait affordances (`app-busy.ts`): which app is opening, forking or
  // being deleted right now. A ref for the guard — two taps in one frame both read the same
  // `useState` value, so state alone could not refuse the second — plus a mirrored snapshot in
  // state, which is the only half the screens render.
  const appOps = useRef(new AppBusy()).current;
  const [appBusy, setAppBusy] = useState<AppBusyMap>({});

  // App links (design D15): the last link that arrived before first-run finished, and a stable
  // handle onto the latest `openAppLink` closure — refreshed every render below, the same
  // stable-identity idiom `onLeaveRunningRef`/`timelineRef` already keep, so the mount-once
  // `Linking` subscription (registered once, further down) always reaches the CURRENT `screen`/
  // `reportTarget` rather than the ones captured at mount.
  const pendingLinkHolder = useRef(new PendingLinkHolder()).current;
  const openAppLinkRef = useRef<(id: string) => void>(() => {});

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
      // `readyRef.current` set here too, not left to the next render's own `readyRef.current =
      // ready` mirroring assignment: the app-link listener effect reads the ref synchronously and could
      // otherwise re-hold a link that arrives in the same tick as `release()` below, right after
      // this effect already drained the holder — stuck forever with nothing left to release it.
      readyRef.current = true;
      // A link that arrived while first-run was still running (spec app-links "A link that
      // arrives before the launcher is ready waits") resolves now, exactly as it would on an
      // already-ready launcher. `openAppLinkRef.current`, not `openAppLink` directly — see the
      // ref's own doc comment.
      const heldId = pendingLinkHolder.release();
      if (heldId != null) openAppLinkRef.current(heldId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The app-link listener (design D15; spec app-links): registered ONCE — `Linking.getInitialURL`
  // for a cold start, `Linking`'s `url` event for one that arrives while the process runs. Both
  // funnel through the SAME rejection/hold/open handling, so a cold-start link and a warm one
  // behave identically. `openAppLink` (below, among the ghost-tile handlers) is referenced here
  // only through `openAppLinkRef`, which every render keeps pointed at the CURRENT closure — the
  // same "declared later, reached only through a ref/deferred closure" pattern `runContinuation`
  // already relies on for `onRetryPending`.
  useEffect(() => {
    const handleIncomingUrl = (url: string | null) => {
      if (!url) return;
      const id = parseAppLink(url);
      if (id == null) {
        log.warn(CHANNELS.app, 'app link rejected', schemeAndHostOf(url));
        return;
      }
      if (!readyRef.current) {
        pendingLinkHolder.hold(id);
        return;
      }
      openAppLinkRef.current(id);
    };
    Linking.getInitialURL().then(handleIncomingUrl);
    const sub = Linking.addEventListener('url', (event) => handleIncomingUrl(event.url));
    return () => sub.remove();
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
   *  OWN in-flight request and nothing else. The clarify exchange now starts the moment compose's
   *  primary action is tapped — the screen is already `clarify` (loading) by the time anything is
   *  in flight (C2), so it is leaving THAT step, never `compose`, that aborts the `'compose'`-
   *  labelled request (the internal slot name is unchanged; only which screen owns the wait is
   *  new). Compose itself never has a request of its own to cancel. */
  const leaveFlowStep = (kind: Screen['kind']) => {
    if (kind === 'clarify') {
      flowRequests.abort('compose');
    } else if (kind === 'plan') {
      flowRequests.abort('plan');
    }
  };

  const goHome = () => {
    leaveFlowStep(screen.kind);
    aboutRef.current = null;
    refresh();
    setScreen({ kind: 'home' });
  };

  /** The update screen's `Not now`, and system back: Home, carrying the prompt the screen held for
   *  the next compose on the same app. */
  const onUpdateNotNow = (heldPrompt: HeldPrompt | undefined) => {
    if (heldPrompt) heldPromptRef.current = heldPrompt;
    goHome();
  };

  /** A report refused `update_required`, or answered with an `update` fallback carrying `notice`,
   *  from any of its three sheets: the update screen replaces the screen the sheet sits on — only
   *  while that screen still shows, the same never-pull-back rule every other refusal follows. */
  const onReportUpdateRequired = (notice?: string) => {
    setReportTarget(null);
    setScreen((prev) =>
      prev.kind === 'done' || prev.kind === 'history' || prev.kind === 'app' ? updateScreenFrom(prev, notice) : prev,
    );
  };

  const onServerUrlChange = (url: string) => {
    const previous = effectiveServerUrl(kv, internalBuild);
    saveServerUrl(kv, url);
    if (effectiveServerUrl(kv, internalBuild) !== previous) invalidateConnectivity();
    setServerUrl(serverOverride(kv, { internalBuild }));
  };

  const onHighlightingChange = (enabled: boolean) => {
    saveHighlighting(kv, enabled);
    setHighlighting(enabled);
  };

  const onErrorDetailsChange = (on: boolean) => {
    setErrorDetails(kv, on);
    setErrorDetailsShown(on);
  };

  /** Settings' confirmed "Make a new ID": the stored ID is replaced, and the options memos (keyed on
   *  `deviceId`) rebuild, so every later request carries the new one. */
  const onResetDeviceId = () => {
    setDeviceId(resetDeviceId(kv));
  };

  const onUseDefaultServer = () => {
    const previous = effectiveServerUrl(kv, internalBuild);
    clearServerUrl(kv);
    if (effectiveServerUrl(kv, internalBuild) !== previous) invalidateConnectivity();
    setServerUrl(serverOverride(kv, { internalBuild }));
  };

  /** Forces `clientOptions` (and every other `termsStatus(kv)`/`consentStatus(kv)` read this render
   *  produces) to reflect an acceptance/grant/revoke that just happened — see the `clientOptions`
   *  memo's own doc comment. */
  const bumpConsent = () => {
    invalidateConnectivity();
    setConsentTick((t) => t + 1);
  };

  const onGrantConsent = () => {
    grantConsent(kv, new Date().toISOString());
    bumpConsent();
  };

  const onRevokeConsent = () => {
    revokeConsent(kv);
    bumpConsent();
  };

  const onAcceptTerms = () => {
    acceptTerms(kv, new Date().toISOString());
    bumpConsent();
  };

  // ── The legal flow: terms, then AI-data consent (design D1/D2/D5; legal-surface-v2 D5) ─────
  // Every data-sending entry point — the composer row, "Prompt again", the orb's change action,
  // history's "Change it from here", and Retry — calls `openWithConsent` instead of acting
  // directly. `onRetryPending` (defined below, among the ghost-tile handlers) is referenced here
  // only inside a closure that never runs before this render completes, so its declaration order
  // doesn't matter — the same pattern `onLeaveRunningRef.current = onLeaveRunning` already relies
  // on further down this component.

  /** What a gated action resumes once terms and consent are current: a compose continuation
   *  reopens the composer, scoped exactly as the entry point asked; a retry continuation re-runs
   *  the stored prompt on the SAME pending-build record, exactly as an unguarded Retry would; a resume
   *  continuation (a `consent_required` refusal) returns to the step that sent the request, as it
   *  was, for the user to send it again. */
  const runContinuation = (continuation: ConsentContinuation) => {
    if (continuation.kind === 'compose') {
      openCompose(continuation.editing);
    } else if (continuation.kind === 'resume') {
      setScreen(continuation.screen);
    } else if (continuation.kind === 'settings') {
      setScreen({ kind: 'settings' });
    } else {
      onRetryPending(continuation.record);
    }
  };

  /** The screen the legal flow shows next (`nextLegalStep`, read fresh from `kv`), carrying the
   *  flow unchanged, or `undefined` when the terms and consent are both current and the action may
   *  run. The one place any legal screen is built, so every path into the flow — an entry point,
   *  the terms step's `Accept`, a `consent_required` refusal — shows the same steps in the same
   *  order. `age` is the result of the age check that just ran; without one, the stored outcome
   *  decides whether a check is due. */
  const legalScreen = (flow: LegalFlow<Screen>, age: AgeGate = storedAgeGate(kv, new Date())): Screen | undefined => {
    const terms = termsStatus(kv);
    const consent = consentStatus(kv);
    const step = nextLegalStep(age, terms, consent, flow.refused);
    // Picked field by field: `flow` may be a legal screen itself, whose own `kind` and fields
    // must not ride along into the next step.
    const carried: LegalFlow<Screen> = { continuation: flow.continuation, returnTo: flow.returnTo, refused: flow.refused };
    if (step === 'age-check') return { kind: 'age', ...carried };
    if (step === 'age-blocked') return { kind: 'age', held: age === 'under-13' ? 'under-13' : 'minor-not-approved', ...carried };
    if (step === 'terms') return { kind: 'terms', outdated: terms.kind === 'outdated', ...carried };
    if (step === 'consent') return { kind: 'consent', mode: 'ask', outdatedFrom: outdatedGrantVersion(consent), ...carried };
    return undefined;
  };

  /** Moves the flow on: opens its next legal screen, or runs its continuation when nothing is left
   *  to ask. `age` is passed only by the age check, with the result it just derived. */
  const advanceLegalFlow = (flow: LegalFlow<Screen>, age?: AgeGate) => {
    const next = legalScreen(flow, age);
    if (next === undefined) runContinuation(flow.continuation);
    else setScreen(next);
  };

  // The age check (legal-surface-v2 D11; spec store-age-signals): while the checking screen shows,
  // ask the store, store only the outcome, and move the same flow on with its result — to the
  // terms step, or to the held message for that result. Leaving the screen first (`Back`) drops the answer, so a
  // late one never pulls the user back into the flow.
  // A guardian asked to acknowledge a terms change (beta-1 D2) is shown the updated-terms line in
  // the legal language active when the check starts; a ref, so switching language on the
  // checking screen doesn't start the check again.
  const checkingAge = screen.kind === 'age' && screen.held === undefined ? screen : undefined;
  const advanceLegalFlowRef = useRef(advanceLegalFlow);
  advanceLegalFlowRef.current = advanceLegalFlow;
  const updateLineRef = useRef(LEGAL_COPY[legalLanguage].termsUpdatedLine);
  updateLineRef.current = LEGAL_COPY[legalLanguage].termsUpdatedLine;
  useEffect(() => {
    if (checkingAge === undefined) return undefined;
    let current = true;
    const acknowledgment = significantUpdate === undefined ? undefined : { sheet: significantUpdate, description: updateLineRef.current };
    runAgeCheck(kv, ageSignal, () => new Date(), { significantUpdate: acknowledgment }).then((result) => {
      if (current) advanceLegalFlowRef.current(checkingAge, result);
    });
    return () => {
      current = false;
    };
  }, [checkingAge, kv, ageSignal, significantUpdate]);

  /** The one gate every data-sending entry point calls (spec ai-data-consent "The first action
   *  that would send data asks for consent at that moment"; spec terms-acceptance "Terms are
   *  accepted in their own step before the consent screen"): current terms and a current grant
   *  run the continuation right away; otherwise the terms step or the consent screen opens in the
   *  entry point's place, carrying the continuation and the screen it replaced (`returnTo`), so
   *  declining knows where to land (design D5). */
  const openWithConsent = (continuation: ConsentContinuation) => {
    advanceLegalFlow({ continuation, returnTo: screen, refused: false });
  };

  /**
   * The screen a refused request opens instead of landing as a notice, when its rule names one
   * (`REFUSAL_RULES[code].opens`, request-envelope D5/D7), or `undefined` for a refusal that lands
   * as a notice. `back` is the screen the request was sent from, exactly as it was — the typed
   * prompt, the answers and the plan rows included; `resume` is what agreeing continues. Each
   * caller applies its own `onlyOnStep` guard to the result, so a user who has already left the
   * step is never pulled onto this screen.
   *
   * `consent` opens the legal flow as a refused one: the terms step first when the terms aren't
   * current, then always the ask-mode consent screen; declining either returns to `back`. `update`
   * opens the update screen, holding the prompt typed on `back` for the next compose (its
   * `Not now` goes Home, request-envelope D5).
   */
  const refusalScreen = (refusal: ServiceRefusal, back: Screen, resume: ConsentContinuation): Screen | undefined => {
    const opens = REFUSAL_RULES[refusal.code].opens;
    if (opens === 'update') return updateScreenFrom(back);
    if (opens !== 'consent') return undefined;
    return legalScreen({ continuation: resume, returnTo: back, refused: true });
  };

  /** The terms step's `Accept`: records the acceptance, then moves the same flow on — to the
   *  consent screen when consent isn't current (or the flow is a refused one), otherwise straight
   *  to the action the user started (spec terms-acceptance "After `Accept`, the flow SHALL
   *  continue…"). */
  const onTermsAccept = (flow: LegalFlow<Screen>) => {
    onAcceptTerms();
    advanceLegalFlow(flow);
  };

  /** Ask mode's `Agree and continue`: grants, then resumes exactly the continuation that opened
   *  this screen (spec "After the user agrees, the action they started SHALL continue as if
   *  consent had already existed"). */
  const onConsentAskAgree = (continuation: ConsentContinuation) => {
    onGrantConsent();
    runContinuation(continuation);
  };

  /** Declining either legal screen (`Not now`, and hardware back — both routed through the
   *  screen's one `onClose`): grants and accepts nothing, and returns to whatever screen the flow
   *  replaced (design D5: Home for a running mini-app, since a torn-down realm is never resumed). */
  const onLegalDecline = (returnTo: Screen) => {
    setScreen(declineTarget<Screen>(returnTo));
  };

  /** Turning AI features on from Settings (spec terms-acceptance "One pass through the legal flow
   *  shows each legal screen at most once"; beta-1 D6, #104): the legal flow from its first due
   *  step, so the age check and the terms step when due, then the one consent screen. It ends back
   *  on Settings, and declining any step returns there too. */
  const onTurnOnAIFeatures = () => {
    advanceLegalFlow({ continuation: { kind: 'settings' }, returnTo: { kind: 'settings' }, refused: false });
  };

  /** Settings' AI features row: with AI features on, the consent screen in review mode, to keep
   *  them on or turn them off whatever the terms say; otherwise turning them on. */
  const onOpenAIFeatures = () => {
    if (consentStatus(kv).kind === 'granted') setScreen({ kind: 'consent', mode: 'review' });
    else onTurnOnAIFeatures();
  };

  /** Review mode with consent on: the plain-text action deletes the grant and returns to
   *  Settings — the connectivity effect above (keyed on `clientOptions`) cancels any scheduled
   *  probe and resets the state to unknown as a consequence, with no separate call needed here. */
  const onConsentReviewTurnOff = () => {
    onRevokeConsent();
    setScreen({ kind: 'settings' });
  };

  /** Review mode's `Keep AI features on` (consent on) and hardware back (either sub-state):
   *  nothing changes, just return to Settings. */
  const onConsentReviewClose = () => {
    setScreen({ kind: 'settings' });
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
    streamRequestId?: string,
  ): Screen => {
    const reasoned = errorReason(err);
    logGenFailureShown({ stage, reasonCode: errorReasonCode(err), reason: reasoned.reason, observedRepairAttempts: observed, err, streamRequestId });
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

  /** Opens compose, optionally scoped to a re-prompt. `about` (the edit flow's shared clarify/
   *  rewrite `app.description`) is resolved AFTER the screen is already showing — best effort,
   *  never blocking the field the user is about to type into — and lands directly in `aboutRef`,
   *  keyed by `editing.id`, rather than onto the screen: a user who taps Continue before it
   *  resolves must still get it on the clarify/rewrite request that follows (the "about" race), and
   *  `aboutRef` is read at request time regardless of which screen is showing when the read lands.
   *  Capped here too, not only where `buildRewriteAppContext` sends it (`generation-request.ts`'s
   *  `APP_CONTEXT_DESCRIPTION_MAX_CHARS` doc comment) — a cap enforced only on the read side is not
   *  a cap. A read that fails or finds no snapshot leaves `aboutRef` untouched for this id, which
   *  `aboutFor` already treats as "no description" — a degraded edit flow, never a blocked one. */
  const openCompose = (editing?: InstalledApp, text?: string) => {
    setScreen(composeStep(editing, text ?? takeHeldPrompt(editing) ?? ''));
    if (!editing) return;
    (async () => {
      let about: string | undefined;
      try {
        about = await access.activeDescription(editing);
      } catch (e) {
        log.debug(CHANNELS.app, 'edit description unavailable', { operation: 'openCompose', ...errorFields(e) });
        return;
      }
      if (about == null) return;
      aboutRef.current = { id: editing.id, about: about.trim().slice(0, APP_CONTEXT_DESCRIPTION_MAX_CHARS) };
    })();
  };

  const goBack = (from: FlowScreen) => {
    leaveFlowStep(from.kind);
    const target = backFrom(from);
    if (target === 'home') goHome();
    else if (target) setScreen(target);
  };

  /** Fetch the plan and show it: the step opens immediately under its row skeleton, and its own
   *  primary action stays busy until the rewrite response lands. `sentFrom` is the step whose OWN
   *  `Continue` fired this request — `'clarify'` from the clarify step's own action, `'compose'`
   *  when a zero-question exchange skips it and `onComposeContinue` opens plan directly from the
   *  loading `clarify` screen it built (never `prev.kind`, which would misattribute that skip's
   *  refusal landing to a clarify step the user never saw). */
  const openPlan = async (prev: ComposeScreen | ClarifyScreen, sentFrom: RefusalSentFrom) => {
    const options = resolveClientOptions();
    if (!options) return;
    const markOnline = onlineForRequest(options);
    const plan = planStep(prev);
    // Guarded like every other post-navigation write: this runs straight after the clarify await
    // on the compose path, and a user who has already left must not be pulled onto a plan step.
    setScreen(onlyOnStep<Screen, 'compose' | 'clarify'>(prev.kind, () => plan));
    const request = flowRequests.start('plan');
    try {
      const response = await rewritePrompt(
        options,
        plan.text,
        clarificationsFrom(plan.questions, plan.answers),
        // A re-prompt tells the rewrite which app it is changing, and what it currently is;
        // composing a new app sends neither. `aboutFor`, not `plan.about` — the description can
        // still resolve after the user has already moved past compose (the "about" race).
        buildRewriteAppContext(plan.editing, aboutFor(plan.editing)),
        request.controller.signal,
      );
      markOnline();
      if (request.cancelled) return;
      setScreen(onlyOnStep<Screen, 'plan'>('plan', (s) => withPlan(s, response)));
    } catch (e) {
      // A request the user walked away from fails as an abort: no failure screen, no breadcrumb.
      if (request.cancelled) return;
      // A reply this build can't use, whose fallback is `update` (beta-1 D16): the update screen,
      // with its notice, holding the prompt — and no build started. A `fail` fallback is the
      // generic failure below, whose reason is its notice.
      const fallback = terminalFallbackOf(e);
      if (fallback?.kind === 'update') {
        markOnline();
        logUpdateFallback('rewrite', e);
        const update = updateScreenFrom(plan, fallbackNotice(fallback));
        setScreen(onlyOnStep<Screen, 'plan'>('plan', () => update));
        return;
      }
      // A structured service refusal proves the server answered — proof of connectivity
      // equivalent to a successful dedicated probe (spec "A real generation or rewrite call
      // succeeding, and any service refusal those paths receive... SHALL be treated as proof of
      // connectivity").
      const refusal = serviceRefusalOf(e);
      if (refusal) markOnline();
      if (refusal) {
        // Never the failure screen (service-refusals "never opens the failure screen"): the
        // rewrite's landing is compose or clarify — whichever step's Continue sent it — for a
        // sender refusal, and always compose for a refusal about the words themselves. A refusal
        // that opens a screen of its own goes there, with that same step to come back to.
        logServiceRefusal('rewrite', refusal);
        const back = rewriteRefusalTarget(sentFrom, plan, refusal);
        const target =
          refusalScreen(refusal, back, { kind: 'resume', screen: back }) ??
          rewriteRefusalTarget(sentFrom, plan, refusal, noticeFrom(refusal));
        setScreen(onlyOnStep<Screen, 'plan'>('plan', () => target));
        return;
      }
      logGenError('rewrite failed', e);
      const failed = failure(plan.editing, plan.text, e, 'rewrite failed');
      setScreen(onlyOnStep<Screen, 'plan'>('plan', () => failed));
    } finally {
      flowRequests.release('plan', request);
    }
  };

  /** Where a clarify exchange that threw lands (an abort never gets here — the caller swallows it),
   *  or `'skip'` for a clarify `502`, which goes on to the plan step. Called outside any `setScreen`
   *  updater, since the failure screen's construction logs. */
  const clarifyThrewTo = (from: ComposeScreen, e: unknown, markOnline: () => void): Screen | 'skip' => {
    const back = composeStep(from.editing, from.text);
    // A reply this build can't use, whose fallback is `update` (beta-1 D16): the update screen,
    // with its notice, holding the typed prompt. A `fail` fallback is the failure below, whose
    // reason is its notice (it is never a clarify skip, which is a 502 alone).
    const fallback = terminalFallbackOf(e);
    if (fallback?.kind === 'update') {
      markOnline();
      logUpdateFallback('clarify', e);
      return updateScreenFrom(back, fallbackNotice(fallback));
    }
    // A structured service refusal proves the server answered (spec "A real generation or
    // rewrite call succeeding, and any service refusal those paths receive... SHALL be treated
    // as proof of connectivity") — checked regardless of `isClarifySkip`, since a refusal never
    // reads as one (that path is 502-only).
    const refusal = serviceRefusalOf(e);
    if (refusal) {
      markOnline();
      // Never the failure screen (service-refusals "never opens the failure screen"): a
      // clarify request's only sender is compose, and a refusal about the words themselves
      // lands there too, so the landing is always compose. A refusal that opens a screen of its
      // own goes there, with the compose step (the typed prompt intact) to come back to.
      logServiceRefusal('clarify', refusal);
      return refusalScreen(refusal, back, { kind: 'resume', screen: back }) ?? { ...from, notice: noticeFrom(refusal) };
    }
    if (isClarifySkip(e)) return 'skip';
    logGenError('clarify failed', e);
    return failure(from.editing, from.text, e, 'clarify failed');
  };

  /** compose → clarify, or straight past it when the exchange has nothing to ask. The clarify step
   *  opens IMMEDIATELY, under its own loading state — the wait is that screen, never a grey compose
   *  button (C2) — and the request that fills it in is fired straight after. A clarify `502` means
   *  "skip to the plan step", not a dead end (`isClarifySkip`). */
  const onComposeContinue = async (from: ComposeScreen) => {
    const options = resolveClientOptions();
    if (!options) return;
    const markOnline = onlineForRequest(options);
    const loading = clarifyStep(from);
    setScreen(loading);
    const request = flowRequests.start('compose');
    let questions: FlowQuestion[] = [];
    let limit: FlowLimit | undefined;
    try {
      const response = await clarifyPrompt(
        options,
        from.text,
        // The same context a rewrite would carry (name, collections, description) — so the
        // clarifier never re-asks what kind of app it is talking to. `aboutFor`, not
        // `from.about` — see `aboutRef`'s doc comment.
        buildRewriteAppContext(from.editing, aboutFor(from.editing)),
        request.controller.signal,
      );
      questions = acceptClarifyQuestions(response.questions);
      limit = clarifyLimitOf(response);
      // A resolved `clarifyPrompt` is a real server response — proof of connectivity equivalent
      // to a successful dedicated probe (spec "A real generation or rewrite call succeeding...").
      markOnline();
    } catch (e) {
      // The user left the loading clarify screen while this was in flight (back to compose, or
      // Home): the abort surfaces here as a plain `AbortError`, and it is swallowed — no failure
      // screen, no breadcrumb.
      if (request.cancelled) return;
      const landing = clarifyThrewTo(from, e, markOnline);
      if (landing !== 'skip') {
        setScreen(onlyOnStep<Screen, 'clarify'>('clarify', () => landing));
        return;
      }
    } finally {
      flowRequests.release('compose', request);
    }
    if (request.cancelled) return;
    if (limit) {
      // Clarify says this can't be built as asked (beta-1 D9): the step shows why and what could
      // be built instead, and nothing more happens until the user picks one.
      const shown = limit;
      setScreen(onlyOnStep<Screen, 'clarify'>('clarify', (s) => withLimit(s, shown)));
    } else if (stepAfterClarifyExchange(questions) === 'clarify') {
      setScreen(onlyOnStep<Screen, 'clarify'>('clarify', (s) => withQuestions(s, questions)));
    } else {
      // Zero questions (or a clarify skip): the loading clarify screen goes straight to the plan
      // step — its own skeleton replaces this one, so the wait reads as continuous, never as a
      // clarify screen that flashed empty. `'compose'`, not `loading.kind` (`'clarify'`) — it was
      // THIS Continue that sent the rewrite request (M3 review fix).
      await openPlan(loading, 'compose');
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

  /** The abort + record deletion behind an explicit cancel — reachable only from a Cancel chosen on
   *  a `building` ghost's quick actions (`onCancelPending`, below) and from the build screen's
   *  `Cancel build` while the build waits in line (`onCancelBuild`). Hardware back on the build
   *  screen no longer calls this (bug fix: it used to, and cancelled the whole run) — see
   *  `prompt-flow.ts#buildBackAction`. */
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
   * A refused `generateApp` call (design D10; `refusedGenerateOutcome` decides drop vs settle):
   * a fresh attempt still on its build screen is dropped exactly as a cancel drops it, and the
   * flow returns to `fromPlan` (when given) with the notice. Everything else — a detached
   * attempt, or any Retry — settles `failed` with the refusal's text (`refusalText`) as the
   * reason; a Retry additionally refreshes the failure screen it was launched from, with Retry
   * gated by the notice's own `retryAt`. A refusal that opens a screen of its own
   * (`refusalScreen`) opens it in place of either landing: back to the plan for a dropped attempt,
   * back to the refreshed failure screen (and its Retry) for a Retry. A detached attempt opens
   * nothing — the user is elsewhere; its ghost keeps the reason — except the update screen, which
   * opens where it interrupts nothing (`updateMayInterrupt`).
   */
  const handleGenerateRefusal = (
    attemptId: string,
    refusal: ServiceRefusal,
    isRetry: boolean,
    detached: boolean,
    fromPlan: PlanScreen | undefined,
    counts: RunTerminalCounts,
  ): void => {
    logServiceRefusal('generate', refusal);
    const notice = noticeFrom(refusal);
    const outcome = refusedGenerateOutcome(isRetry, detached);
    releaseLiveRef(attemptId);
    settleRefusedGenerate(pending, journal, attemptId, outcome, refusalText(refusal), counts);
    refresh();
    if (outcome === 'drop') {
      if (fromPlan) {
        const back: PlanScreen = { ...fromPlan, notice: undefined };
        const target = refusalScreen(refusal, back, { kind: 'resume', screen: back }) ?? { ...fromPlan, notice };
        setScreen(onlyOnStep<Screen, 'build'>('build', () => target));
      }
      return;
    }
    if (detached && REFUSAL_RULES[refusal.code].opens === 'update') {
      setScreen((prev) => (updateMayInterrupt(prev) ? updateScreenFrom(prev) : prev));
      return;
    }
    if (!isRetry) return;
    const updated = pending.get(attemptId);
    if (updated) {
      const back = failureFromRecord(updated);
      const target = refusalScreen(refusal, back, { kind: 'retry', record: updated }) ?? { ...back, notice };
      setScreen(onlyOnStep<Screen, 'build'>('build', () => target));
    }
  };

  /**
   * A generate request the server ended with something other than a failed build — an `update`
   * fallback or a service refusal — settled and routed; `false` for every other error, which the
   * caller settles as a failure (a `fail` fallback among them: its notice is the failure's reason).
   *
   * An `update` fallback (beta-1 D16) ends the build `failed` — nothing installed, nothing updated,
   * its ghost kept for a Retry, its reason the notice (else the update line) — and the update screen
   * shows the notice: in place of the build screen, or for a build left running only where it
   * interrupts nothing, like the update refusal. A refusal never opens the failure screen
   * (service-refusals); design D10's three-way split lives in `handleGenerateRefusal`. Either proves
   * the server answered (spec "…any service refusal those paths receive... SHALL be treated as
   * proof of connectivity").
   */
  const settleServerEnding = (
    e: unknown,
    ctl: NonNullable<typeof genRef.current>,
    attempt: { attemptId: string; isRetry: boolean; fromPlan?: PlanScreen; counts: RunTerminalCounts; streamRequestId?: string },
    markOnline: () => void,
  ): boolean => {
    const fallback = terminalFallbackOf(e);
    if (fallback?.kind === 'update') {
      markOnline();
      releaseGenRef(ctl);
      logUpdateFallback('generate', e, attempt.streamRequestId);
      const notice = fallbackNotice(fallback);
      const detached = ctl.detached;
      settleFailed(attempt.attemptId, notice ?? COPY.updateRequiredLine, [], attempt.counts);
      setScreen((prev) => (!detached || updateMayInterrupt(prev) ? updateScreenFrom(prev, notice) : prev));
      return true;
    }
    const refusal = serviceRefusalOf(e);
    if (!refusal) return false;
    markOnline();
    releaseGenRef(ctl);
    handleGenerateRefusal(attempt.attemptId, refusal, attempt.isRetry, ctl.detached, attempt.fromPlan, attempt.counts);
    return true;
  };

  /**
   * ONE generation attempt, end to end: the launcher id and its `building` record are written
   * BEFORE the request goes out (design D3/D4), the stream runs, and exactly one of three
   * settlements follows — delivered (record deleted, after the store and index are both written),
   * failed (record persisted with its payload, never deleted), or cancelled (record deleted by the
   * cancel path itself). The plan's `Build it` and a ghost's Retry are its only two entries, so
   * this stays the shell's single `generateApp` call site.
   *
   * `fromPlan` is the plan screen `Build it` was tapped from — carried ONLY so a fresh attempt
   * refused while still on the build screen can return to plan with every row exactly as it was
   * (design D9/D10); a Retry passes none, since a refused Retry never lands on plan.
   */
  const runAttempt = async (building: BuildScreen, reuseId?: string, fromPlan?: PlanScreen) => {
    const options = resolveClientOptions();
    if (!options) return;
    const markOnline = onlineForRequest(options);
    setScreen(building);

    const controller = new AbortController();
    const ctl = { controller, cancelled: false, detached: false };
    genRef.current = ctl;
    const editing = building.editing;
    // Declared outside the try so a throw mid-stream still knows what the device observed, and on
    // which request (the stream's `x-whim-request-id`, once it has opened).
    const counts: EventCounts = { stage: 0, token: 0, diagnostic: 0, repair: 0 };
    let stream: GenerationStream | undefined;

    // The id this attempt writes to, decided and persisted before the request exists: a new
    // install mints one, a rebuild's id IS the app it rebuilds, a retry reuses its record's.
    const attemptId = startPendingBuild(pending, { editing, text: building.text, reuseId });
    // The journal is created at the SAME moment as the record it is a sibling of
    // (`generation-run-journal` "A run journal is created alongside its pending-build record"),
    // and the attempt's derived signals start from the same instant the request does.
    journal.create(attemptId);
    const startedAt = Date.now();
    let signals: RunSignals = {
      startedAt,
      aggregates: EMPTY_RUN_AGGREGATES,
      lastTokenAt: null,
      lastThinkingAt: null,
      lastFrameAt: startedAt,
    };
    signalsRef.current = signals;
    // The keepalive comment frame (`: keepalive\n\n`, build-liveness B2) is transport noise, never
    // a `GenerationEvent` — it reaches here through `ClientOptions.onKeepalive`, not the stream
    // loop below, and moves ONLY the any-frame clock (`withKeepalive` never touches the journal).
    const onKeepalive = () => {
      signals = withKeepalive(signals, Date.now());
      signalsRef.current = signals;
    };
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

      // Only `stage` and `queued` ever reach UI state (never `token.text` or
      // `diagnostic.kind`/`symbol` — spec "Generation progress is shown without exposing
      // internals"); `result`/`failure` are held until the stream ends so the terminal-event
      // handling below stays in one place.
      stream = generateApp({ ...options, onKeepalive }, request, controller.signal);
      for await (const event of stream) {
        countEvent(counts, event);
        // The journal write and the signal fold for this event, in one place and at one clock
        // reading: `stage` journals immediately, `token` goes through the store's own ~5s
        // throttle, a `restart` voids the turn's counts, everything else writes nothing
        // (`build-lifecycle#journalStreamEvent`).
        signals = journalStreamEvent(journal, attemptId, signals, event, Date.now());
        signalsRef.current = signals;
        // `stage` moves the step and `queued` the place in line; any other event ends the
        // waiting state (`prompt-flow.ts#withStreamEvent`), and a token alone changes nothing.
        const next = withStreamEvent(live, event);
        if (next !== live) {
          live = next;
          liveRef.current = { id: attemptId, screen: live };
          setScreen((s) => (s.kind === 'build' ? withStreamEvent(s, event) : s));
        }
        if (event.type === 'result' || event.type === 'failure') terminal = event;
      }
      // The stream loop completed without throwing a transport-classified error — a real server
      // response, proof of connectivity equivalent to a successful dedicated probe (spec "A real
      // generation or rewrite call succeeding...").
      markOnline();

      if (ctl.cancelled) return; // explicit cancel (abortLiveAttempt) already deleted the record
      releaseGenRef(ctl);

      if (terminal == null) {
        // Stream ended with no terminal event and no cancel — a stream error, not a crash.
        log.error(CHANNELS.gen, 'stream ended with no terminal event', { ...counts, requestId: stream.requestId });
        logGenFailureShown({
          stage: 'stream ended with no terminal event',
          reasonCode: 'no_terminal_event',
          reason: GENERIC_STREAM_ERROR,
          observedRepairAttempts: counts.repair,
          failureClass: 'StreamEndedWithoutTerminalEvent',
          streamRequestId: stream.requestId,
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
          reasonCode: 'terminal_failure',
          reason: terminal.reason,
          observedRepairAttempts: counts.repair,
          failureClass: 'GenerationFailureEvent',
          diagnostics: terminal.diagnostics,
          streamRequestId: stream.requestId,
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
      const attempt = { attemptId, isRetry: reuseId !== undefined, fromPlan, counts: terminalCounts(), streamRequestId: stream?.requestId };
      if (settleServerEnding(e, ctl, attempt, markOnline)) return;
      releaseGenRef(ctl);
      logGenError('build failed', e, stream?.requestId);
      const reasoned = errorReason(e);
      settleFailed(attemptId, reasoned.reason, reasoned.diagnostics, terminalCounts());
      setScreen(failure(editing, building.text, e, 'build failed', counts.repair, attemptId, stream?.requestId));
    }
  };

  /** The approval gate's action — the first moment a generation request is sent. */
  const onBuildIt = async (from: PlanScreen) => {
    await runAttempt(buildStep(from), undefined, from);
  };

  /** `Leave it running`: back to the shell WITHOUT cancelling — the run finishes and its result
   *  is still delivered, it just no longer takes over the screen. Its record stays `building`, so
   *  the grid keeps showing the ghost for as long as the stream is in flight. */
  const onLeaveRunning = () => {
    const ctl = genRef.current;
    if (ctl) ctl.detached = true;
    goHome();
  };

  /** `Cancel build`, offered on the build screen while the build waits in line (beta-1 D8): the
   *  request is aborted and the attempt deleted, exactly as a ghost's Cancel does — no ghost is
   *  left behind — and the user lands on Home. */
  const onCancelBuild = () => {
    abortLiveAttempt();
    goHome();
  };

  /** The limit step's `Build <alternative> instead` (beta-1 D9): the alternative becomes the prompt
   *  and clarify is asked about it afresh — its own questions, never the old ones. Nothing is built
   *  until the user approves a plan, as always. */
  const onBuildInstead = async (from: ClarifyScreen) => {
    if (!from.limit) return;
    await onComposeContinue(composeStep(from.editing, from.limit.alternative));
  };

  // `onBuildBack` reads the latest `timeline`/`onLeaveRunning` through refs so its identity never
  // changes: a dependency on either would hand `BuildStep` a new callback on every render, including
  // the once-a-second liveness tick, and `BuildStep` would re-register its back listener each tick.
  // That re-registration was the old bug: the build screen's listener was always the newest, ran
  // ahead of the sheet's, and cancelled the run instead of closing the sheet.
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;
  const onLeaveRunningRef = useRef(onLeaveRunning);
  onLeaveRunningRef.current = onLeaveRunning;

  /** Hardware back on the build screen (bug fix — see `BuildStep.tsx`'s header comment and
   *  `prompt-flow.ts#buildBackAction`): NEVER cancels. Closes the details sheet if it is open;
   *  otherwise defers to `onLeaveRunning`, the exact action the "Leave it running" button performs.
   *  The hook binds once per mount through a ref regardless of handler identity; `useCallback` here
   *  is kept for render stability only, not for the listener's registration count. Cancellation
   *  stays reachable only from other explicit affordances (a ghost tile's own Cancel,
   *  `onCancelPending` below). */
  const onBuildBack = useCallback(() => {
    if (buildBackAction(timelineRef.current !== null) === 'close-sheet') {
      setTimeline(null);
      return;
    }
    onLeaveRunningRef.current();
  }, []);

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

  /** Cancel from a `building` ghost's quick actions: `abortLiveAttempt`'s abort + delete, without
   *  taking the user off the grid. The one remaining reachable path to cancellation — the build
   *  screen's own hardware back no longer takes this route (`prompt-flow.ts#buildBackAction`). */
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

  /** The side effect of an arriving link's safe exit (design D15; spec app-links "An arriving link
   *  leaves the current screen through that screen's own safe exit") — no screen assignment; the
   *  caller (`openAppLink`) sets the resolved target right after. Cancelling whatever compose/plan
   *  request the CURRENT screen owns applies unconditionally (a no-op off those two steps), the
   *  same way `goHome` always does it. `'leave-build'` additionally detaches the live attempt so it
   *  keeps streaming (exactly `onLeaveRunning`, without ALSO navigating home first — the caller is
   *  about to navigate somewhere more specific). `'close-overlay'` also clears the host-level
   *  report sheet, mirroring `back-policy.ts`'s `overlayOpen` precedent: never forwarded, never
   *  counted toward anything else. */
  const leaveForLink = (exit: LinkExit) => {
    leaveFlowStep(screen.kind);
    aboutRef.current = null;
    if (exit === 'leave-build') {
      const ctl = genRef.current;
      if (ctl) ctl.detached = true;
    } else if (exit === 'close-overlay') {
      setReportTarget(null);
    }
  };

  /** The one entry point every arriving app link resolves through (design D15): a link to the
   *  app already open is left exactly as it is (spec "A link to the app that is already open SHALL
   *  leave it as it is"); otherwise the current screen takes its safe exit, and the link's target
   *  opens through the SAME handlers a tile tap already uses (`onOpen`/`onOpenPending`) — so it
   *  opens "exactly as a tap on its tile does" by construction, never a second code path that could
   *  drift from the first. Reads `index`/`pending` directly rather than the `apps`/`pendingBuilds`
   *  React state, which can still be mount-time-stale the ONE time this fires before first render
   *  settles (the "waits" release, above). */
  const openAppLink = (id: string) => {
    if (screen.kind === 'app' && screen.app.id === id) return;
    const resolution = resolveAppLink(id, index.list(), pending.list());
    leaveForLink(linkExitFor(reportTarget != null ? 'sheet' : screen.kind));
    if (resolution.kind === 'open') {
      onOpen(resolution.app);
    } else if (resolution.kind === 'missing') {
      setScreen({ kind: 'link-missing' });
    } else {
      onOpenPending(resolution.record);
    }
  };
  openAppLinkRef.current = openAppLink;

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
        // Retry is a data-sending action (spec ai-data-consent "The first action that would send
        // data asks for consent at that moment") — gated the same way as the other four entry
        // points, through `openWithConsent`.
        onRephrase: () => openWithConsent({ kind: 'retry', record: ghost }),
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

  /** Home's developer-probe entry, offered only where the dev log tools are. Decided here rather than
   *  inside `renderScreenContent`, whose complexity budget goes to the screen kinds. */
  const onOpenDevProbe = devLogOverlayEnabled(__DEV__) ? () => setScreen({ kind: 'dev' }) : undefined;

  /** The ready-gated screen switch, pulled out of `LauncherShell`'s own body (a nested
   *  closure sonarjs's cognitive-complexity rule assesses separately) purely to keep the
   *  count of `Screen` kinds this shell can render from ever competing with `LauncherShell`'s
   *  own control flow for the same budget — adding a `Screen` member costs this function one
   *  branch, never the other. */
  const renderScreenContent = (): React.ReactNode => {
    if (screen.kind === 'app') {
      return (
        <MiniAppView
          key={screen.app.id}
          record={screen.record}
          bundleSource={screen.source}
          engineAppId={screen.engineAppId}
          theme={DEFAULT_THEME}
          onExit={goHome}
          onVersions={() => onHistory(screen.app)}
          onChangeIt={() => openWithConsent({ kind: 'compose', editing: screen.app })}
          installedApp={screen.app}
          access={access}
          reportOptions={reportOptions}
          onUpdateRequired={onReportUpdateRequired}
          legalLanguage={legalLanguage}
        />
      );
    } else if (screen.kind === 'dev') {
      return <DevProbeScreen onExit={goHome} />;
    } else if (screen.kind === 'settings') {
      return (
        <SettingsScreen
          onBack={goHome}
          internalBuild={internalBuild}
          serverUrl={serverUrl}
          onServerUrlChange={onServerUrlChange}
          onUseDefaultServer={onUseDefaultServer}
          highlighting={highlighting}
          onHighlightingChange={onHighlightingChange}
          consentStatus={consentStatus(kv)}
          canProbe={clientOptions != null}
          onOpenAIFeatures={onOpenAIFeatures}
          errorDetails={errorDetailsShown}
          onErrorDetailsChange={onErrorDetailsChange}
          deviceId={deviceId}
          onResetDeviceId={onResetDeviceId}
          legalLanguage={legalLanguage}
          deviceLocale={phoneLocale}
        />
      );
    } else if (isPreConsentStep(screen)) {
      return (
        <PreConsentStepForShell
          screen={screen}
          language={legalLanguage}
          onLanguageChange={onLegalLanguageChange}
          onTermsAccept={onTermsAccept}
          onDecline={onLegalDecline}
        />
      );
    } else if (screen.kind === 'consent') {
      return (
        <ConsentScreenForShell
          screen={screen}
          onAskAgree={onConsentAskAgree}
          onAskDecline={onLegalDecline}
          onReviewTurnOn={onTurnOnAIFeatures}
          onReviewTurnOff={onConsentReviewTurnOff}
          onReviewClose={onConsentReviewClose}
          consentOn={consentStatus(kv).kind === 'granted'}
          language={legalLanguage}
          onLanguageChange={onLegalLanguageChange}
        />
      );
    } else if (screen.kind === 'history') {
      return (
        <>
          <HistoryScreen
            app={screen.app}
            access={access}
            onBack={goHome}
            onChangeIt={(app) => openWithConsent({ kind: 'compose', editing: app })}
            onReport={() => setReportTarget(screen.app)}
          />
          <ReportSheet
            app={reportTarget}
            access={access}
            options={reportOptions}
            legalLanguage={legalLanguage}
            onClose={() => setReportTarget(null)}
            onUpdateRequired={onReportUpdateRequired}
          />
        </>
      );
    } else if (screen.kind === 'link-missing') {
      return <AppLinkMissingScreen onBackToApps={goHome} />;
    } else if (screen.kind === 'update-required') {
      const held = screen.heldPrompt;
      return <UpdateRequiredScreen notice={screen.updateNotice} onNotNow={() => onUpdateNotNow(held)} />;
    } else if (screen.kind === 'compose') {
      const from = screen;
      return (
        <ComposeStep
          text={from.text}
          notice={from.notice}
          serverUnreachable={showServerUnreachableNotice(connectivity, clientOptions != null)}
          editing={from.editing != null}
          editingName={from.editing?.name}
          onChangeText={(text) => setScreen(composeTextChanged(from, text))}
          onContinue={() => onComposeContinue(from)}
          onBack={() => goBack(from)}
        />
      );
    } else if (screen.kind === 'clarify') {
      const from = screen;
      return (
        <ClarifyStep
          prompt={from.text}
          questions={from.questions}
          answers={from.answers}
          loading={from.loading}
          startedAt={from.startedAt}
          notice={from.notice}
          limit={from.limit}
          editing={from.editing != null}
          editingName={from.editing?.name}
          onAnswer={(id, change) => setScreen(withAnswer(from, id, change))}
          onContinue={() => openPlan(from, 'clarify')}
          onBuildInstead={() => onBuildInstead(from)}
          onBack={() => goBack(from)}
        />
      );
    } else if (screen.kind === 'plan') {
      const from = screen;
      return (
        <PlanStep
          rows={from.rows}
          loading={from.loading}
          startedAt={from.startedAt}
          notice={from.notice}
          editing={from.editing != null}
          editingName={from.editing?.name}
          onChangeRow={(rowIndex, text) => setScreen(updatePlanRow(from, rowIndex, text))}
          onBuild={() => onBuildIt(from)}
          onBack={() => goBack(from)}
        />
      );
    } else if (screen.kind === 'build') {
      const from = screen;
      return (
        <>
          <BuildStep
            stage={from.stage}
            delivering={from.delivering}
            queuedPosition={from.queuedPosition}
            onCancel={onCancelBuild}
            signals={signalsRef.current}
            now={Date.now()}
            editing={from.editing != null}
            editingName={from.editing?.name}
            onBack={onBuildBack}
            onShowDetails={onShowDetails}
          />
          <RunDetailsSheet
            open={timeline !== null}
            entries={timeline}
            devMode={timelineDevMode}
            onClose={() => setTimeline(null)}
          />
        </>
      );
    } else if (screen.kind === 'done') {
      const from = screen;
      return (
        <>
          <DoneStep
            app={from.app}
            onOpen={() => onOpen(from.app)}
            onBackToApps={goHome}
            onReport={() => setReportTarget(from.app)}
          />
          <ReportSheet
            app={reportTarget}
            access={access}
            options={reportOptions}
            legalLanguage={legalLanguage}
            onClose={() => setReportTarget(null)}
            onUpdateRequired={onReportUpdateRequired}
          />
        </>
      );
    } else if (screen.kind === 'failure') {
      return (
        <FailureScreen
          reason={screen.reason}
          diagnostics={screen.diagnostics}
          observedRepairAttempts={screen.observedRepairAttempts}
          hasWorkingVersion={screen.hasWorkingVersion}
          notice={screen.notice}
          journal={failureJournal}
          attemptStarted={screen.journalId != null}
          devMode={timelineDevMode}
          {...failureActions(screen)}
        />
      );
    } else {
      return (
        <HomeScreen
          apps={apps}
          pending={pendingBuilds}
          onOpen={onOpen}
          onFork={onFork}
          onDelete={onDelete}
          appBusy={appBusy}
          onHistory={onHistory}
          onPromptAgain={(app) => openWithConsent({ kind: 'compose', editing: app })}
          onCreate={() => openWithConsent({ kind: 'compose' })}
          onSettings={() => setScreen({ kind: 'settings' })}
          onOpenDevProbe={onOpenDevProbe}
          offline={showOfflineIndicator(connectivity)}
          onOpenPending={onOpenPending}
          onCancelPending={onCancelPending}
          onDismissPending={onDismissPending}
        />
      );
    }
  };

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
  } else {
    content = renderScreenContent();
  }

  // The boundary wraps the screen switch's `content` and NOTHING above it (design D1): a screen
  // that throws loses its own subtree, while the safe-area frame and the status-bar inset — the
  // blank-screen failure mode this exists to remove — still render. `screen.kind` is both the
  // failing-screen identifier in the log record and the reset key, so navigating away and back
  // re-attempts a screen that failed once.
  const exit = SCREEN_EXITS[screen.kind];
  return (
    <HighlightingProvider enabled={highlighting}>
      <SafeAreaView edges={frameEdgesFor(screen.kind)} style={[styles.root, { backgroundColor: palette.bg }]}>
        <StatusBar barStyle={statusBarStyle} />
        <ScreenBoundary
          screen={screen.kind}
          FallbackComponent={ScreenErrorFallback}
          onLeave={exit.back === 'root' ? undefined : goHome}
        >
          {content}
        </ScreenBoundary>
        <DevLogTools />
      </SafeAreaView>
    </HighlightingProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: { flex: 1, padding: SPACING.lg },
  // The details view is `RunDetailsSheet` (build-liveness B5) — a bottom sheet anchored to its
  // own edge, not an absolutely-positioned overlay sized off this component's styles.
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
