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
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Linking, StatusBar, StyleSheet, Text, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Diagnostic, GenerationEvent } from '@whim/contract';
import { APP_RECORDS } from '../../runtime/generated/app-records';
import { APP_BUNDLES } from '../../runtime/generated/app-bundles';
import { RADIUS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import { hideLaunchScreen as nativeHideLaunchScreen } from '../launch-screen';
import { log } from '../logging';
import { CHANNELS } from '../logging/channels';
import type { DiagnosticReason } from '../logging/diagnostic';
import type { AppRecord } from '../bridge';
import { createPersistentStore } from '../version-store';
import { createMmkvBackend } from '../version-store/fs/mmkv-backend';
import type { KVBackend } from '../version-store/fs/kv-fs';
import { copyStorage, deleteStorage, peekAppliedSchema } from '../storage-engine';
import { HighlightingProvider } from '../ui/whim-prose/WhimProse';
import { ToastHost, useToast, type ToastApi } from '../ui/Toast';
import { haptics } from '../haptics';
import { useTokens, type ShellTokens } from '../ui/tokens';
import { AppIndex, InstalledApp } from './app-index';
import { AppBusy, runAppOp } from './app-busy';
import { runFork } from './fork-op';
import type { AppBusyMap } from './app-busy';
import { StoreAccess, type ForkOptions } from './store-access';
import { DataCopyJournal } from './data-copy-journal';
import { AttemptInFlight, PendingBuildStore } from './pending-builds';
import type { PendingAttemptLease, PendingBuildFailure, PendingBuildRecord, PendingBuildView, PendingFailureCause, PendingFailureRemedy } from './pending-builds';
import { JOURNAL_KEY, RunJournalStore } from './run-journal';
import type { RunJournalEntry, RunTerminalCounts } from './run-journal';
import {
  deliverAndSettleIfOwned,
  dropPendingBuild,
  hydratedDiagnostics,
  journalStreamEvent,
  refusedGenerateOutcome,
  retryBuildScreen,
  startPendingBuild,
  stillNeedsUpdate,
} from './build-lifecycle';
import { APP_CONTEXT_DESCRIPTION_MAX_CHARS, buildGenerateRequest, buildRewriteAppContext } from './generation-request';
import { seedFirstRun, SeedSpec } from './seed';
import { COPY, LEGAL_COPY, changedTitle, crashFixWords, readyTitle } from './copy';
import { ORB_DISC, ORB_TARGET, ORB_TARGET_EDGE } from './orb-geometry';
import HomeScreen from './HomeScreen';
import { MiniAppStage, type MiniAppLaunch } from './MiniAppView';
import DevProbeScreen from './DevProbeScreen';
import SettingsScreen from './SettingsScreen';
import AdvancedScreen from './AdvancedScreen';
import NativeStack, { type StackEntry } from './NativeStack';
import HistoryScreen from './HistoryScreen';
import { DescribePage } from './DescribePage';
import { PlanPage } from './PlanPage';
import { FirstRunSheet } from './FirstRunSheet';
import { MakingSheet, type SheetContent } from './MakingSheet';
import { runningVersion, WhimReportPage, WhimSheet, type RunningVersion } from './WhimSheet';
import { listVersions } from './history-logic';
import MakingPage from './MakingPage';
import ReadyPage from './ReadyPage';
import FailurePage from './FailurePage';
import { failureCauseOf, failureKindOf } from './failure-kind';
import { attemptName } from './grid-composition';
import ConsentScreen from './ConsentScreen';
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
import { useSystemBack } from './use-system-back';
import DevLogOverlay from './DevLogOverlay';
import { devLogOverlayEnabled } from './dev-log-view';
import { repairAttemptsIn, runTimelineDevModeEnabled } from './run-timeline-view';
import { HomeSkeleton } from './HomeSkeleton';
import { toastClearance } from './ComposerBar';
import { useHomeLive } from './use-home-live';
import { PendingPurgeStore, completeInterruptedPurges, completePurge } from './pending-purge';
import { PurgeWindows } from './soft-delete';
import type { TileIdentity } from './tile-identity';
import {
  EMPTY_RUN_AGGREGATES,
  RUN_SIGNAL_TICK_MS,
  acceptClarifyQuestions,
  backToDescribe,
  clarificationsFrom,
  clarifyLimitOf,
  delegatedAnswers,
  describeStep,
  describeTextChanged,
  isClarifySkip,
  makingStep,
  missingRequest,
  pageKeyOf,
  planStep,
  readyStep,
  retrying,
  updatePlanRow,
  withAnswer,
  withDelivering,
  withKeepalive,
  withLimit,
  withPlan,
  withProblem,
  withQuestions,
  withStreamEvent,
  workingTitleFromPrompt,
} from './prompt-flow';
import type { DescribeScreen, FlowLimit, FlowNotice, FlowQuestion, FlowScreen, MakingScreen, PlanProblem, PlanScreen, RunSignals } from './prompt-flow';
import { fallbackNotice, terminalFallbackOf } from './wire-fallback';
import { PROTOCOL_LEVEL } from './wire-headers';
import { FlowRequests, onlyOnStep } from './flow-request';
import { SHELL_PALETTE } from './theme';
import {
  acknowledgeOwnServer,
  chooseServer,
  effectiveServerUrl,
  loadServerUrl,
  ownServerAcknowledged,
  saveServerUrl,
  serverChoice,
  serverOverride,
  type ServerChoice,
} from './server-address';
import { versionLabel, type SessionProbe } from './settings-sections';
import { probeServerHealth } from './server-probe';
import { ConnectivityLoop } from './connectivity';
import type { Connectivity } from './connectivity';
import { isNetworkFailure, showOfflineIndicator, showServerUnreachableNotice } from './connectivity-ux';
import { appIsForeground, useAppForeground } from './use-app-foreground';
import { FlowDrafts, draftKey } from './flow-draft';
import { loadHighlighting } from './highlighting';
import { sweepRetiredKeys } from './retired-keys';
import { getDeviceId, resetDeviceId } from './device-id';
import { errorDetailsEnabled, setErrorDetails } from './error-details';
import { GenerationClientError, clarifyPrompt, consentedClientOptions, generateApp, rewritePrompt } from './generation-client';
import type { ClientOptions, ConsentedClientOptions, GenerationStream } from './generation-client';
import { reportClientOptions } from './transport-shared';
import type { AppInfo } from './app-info';
import { installedAppInfo } from './installed-app-info';
import ReportScreen from './ReportScreen';
import { consentStatus, grantConsent, outdatedGrantVersion, revokeConsent } from './ai-consent';
import { acceptTerms, termsStatus } from './terms-acceptance';
import { runAgeCheck, storedAgeGate, type AgeGate, type AgeHold, type SignificantUpdateSheet } from './age-check';
import { installedAgeSignal, installedSignificantUpdate } from './installed-age-signal';
import { activeLegalLanguage, chooseLegalLanguage, type LegalLanguage } from './legal-language';
import { deviceLocale as installedDeviceLocale } from './device-locale';
import { consentGrantDue, declineTarget, nextLegalStep } from './consent-flow';
import type { ConsentContinuation, LegalFlow } from './consent-flow';
import { REFUSAL_RULES, refusalRemedy, refusalText, retryAtOf, serviceRefusalOf } from './service-refusal';
import type { ServiceRefusal } from './service-refusal';
import { useNoticeWindowClear } from './ServiceNotice';
import { errorReason, errorReasonCode, errorRemedy, errorRephraseHelps, GENERIC_STREAM_ERROR } from './error-reason';
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

/** History, and `from`: where it was opened — Home's sheet, or the orb over the running app — and
 *  so where leaving it returns. */
type HistoryScreenState = { kind: 'history'; app: InstalledApp; from: 'home' | 'app' };

/** The Whim sheet's pages over a running app: its menu, and Report a problem pushed inside it. */
type WhimSheetPage = 'menu' | 'report';

type Screen =
  | { kind: 'home' }
  // `tappedAt`: when the tile was tapped (`Date.now()`), for the tap-to-first-paint record.
  // `versionId`: the version the running bundle is, once read. `sheet`: the Whim sheet's page, while
  // it is open over the app.
  | {
      kind: 'app';
      app: InstalledApp;
      record: AppRecord;
      source: string;
      engineAppId: string;
      tappedAt: number;
      versionId?: string;
      sheet?: WhimSheetPage;
    }
  | { kind: 'dev' }
  | { kind: 'settings' }
  // Pushed over Settings on the native stack.
  | { kind: 'advanced' }
  | HistoryScreenState
  // Pushed over the screen it was opened from (`from`), where leaving returns: History, for the
  // version the user is on, or Settings, for a problem with no particular app (`app` null).
  | { kind: 'report'; app: InstalledApp | null; from: { kind: 'settings' } | HistoryScreenState }
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
  // The making sheet's pages (describe, plan, making, ready), shaped and sequenced by
  // `prompt-flow.ts` and drawn in the sheet over Home. `editing` absent = a new app (the home
  // composer); present = change mode, on one app.
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
      /** Whether describing the app differently could get past this failure — the failure
       *  screen's rephrase advice (`FailurePageProps.rephraseHelps`). */
      rephraseHelps: boolean;
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
      /** An `interrupted` record's page: Whim closed under the run, or the person stopped it. */
      interrupted?: 'closed' | 'stopped';
      /** What ended the run, as its record stores it (`PendingBuildFailure.cause`). */
      cause?: PendingFailureCause;
      /** A record an `update` fallback ended, while this build still needs that update. */
      needsUpdate?: true;
    };

type AppScreen = Extract<Screen, { kind: 'app' }>;

/** The making sheet's pages a change can show over its running app: its Describe and Plan, and the
 *  Failure page of a change that failed while the app ran. Making never does: a change made from the
 *  running app collapses into the orb. */
function overApp(screen: Screen): screen is Extract<Screen, { kind: 'describe' | 'plan' | 'failure' }> {
  return screen.kind === 'describe' || screen.kind === 'plan' || screen.kind === 'failure';
}

/** The running app a change's page sits over (`overApp`): the app the Whim sheet sent the change from,
 *  or whose failed change the toast's See why opened (`under`), while the page is for that app. The
 *  app keeps running under the sheet, and the shell is laid out as over the app. `null` anywhere else. */
function appUnder(screen: Screen, under: AppScreen | null): AppScreen | null {
  if (under === null || !overApp(screen)) return null;
  return screen.editing?.id === under.app.id ? under : null;
}

/** Where a change to the running app `on` stands, for this launch of it. */
interface ChangeOver {
  /** The change being made. */
  changing?: PendingBuildRecord;
  /** The change that failed while this launch ran, unless discarded. */
  failed?: PendingBuildRecord;
  /** The entry a change landed on while this launch ran: the app itself, or the continuation a change
   *  sent from behind its tip forks onto. Reload opens it. */
  landed?: InstalledApp;
  /** Another app finished while this launch ran. */
  finished: boolean;
}

/** Something that happened while one launch ran: `appId` and `at` (its `tappedAt`) name the launch. */
interface LaunchMark {
  appId: string;
  at: number;
}

const marksLaunch = (mark: LaunchMark | null, on: AppScreen): boolean => mark?.appId === on.app.id && mark.at === on.tappedAt;

function changeOver(
  on: AppScreen | null,
  records: readonly PendingBuildView[],
  discarded: (rec: PendingBuildRecord) => boolean,
  landed: (LaunchMark & { entry: InstalledApp }) | null,
  finished: LaunchMark | null,
): ChangeOver {
  if (on === null) return { finished: false };
  const changes = records.map((view) => view.record).filter((rec) => rec.editingAppId === on.app.id);
  return {
    changing: changes.find((rec) => rec.state === 'building' && !discarded(rec)),
    failed: changes.find((rec) => rec.state === 'failed' && rec.updatedAt >= on.tappedAt && !discarded(rec)),
    ...(landed !== null && marksLaunch(landed, on) ? { landed: landed.entry } : {}),
    finished: marksLaunch(finished, on),
  };
}

/** What the orb shows (system.md §7.1 Orb, §9 Changing in use), most recent first: a change being
 *  made (its stream's sampled activity), a change that failed, a change that landed, another app
 *  that finished, else rest. */
function orbOver(change: ChangeOver, activity: Readonly<Record<string, number>>): MiniAppLaunch['orb'] {
  if (change.changing !== undefined) return { state: 'changing', activity: activity[change.changing.id] ?? 0 };
  if (change.failed !== undefined) return { state: 'failed', activity: 0 };
  if (change.landed !== undefined) return { state: 'ready', activity: 0 };
  return { state: change.finished ? 'finished' : 'rest', activity: 0 };
}

/** How far above the bottom safe area a toast keeps clear: of the orb over a running app, of the
 *  composer on Home. */
function toastOffset(kind: Screen['kind']): number {
  return kind === 'app' ? ORB_CLEARANCE : toastClearance(kind);
}

/** The screens the native stack shows (design-system-v1 D6): Home at its root, then Settings and
 *  what it pushes (Advanced, AI features — the consent screen in review mode — and Report), and
 *  History with its Report. */
type StackScreen =
  | Extract<Screen, { kind: 'home' | 'settings' | 'advanced' | 'history' | 'report' }>
  | Extract<Screen, { kind: 'consent'; mode: 'review' }>;

/** The sheets the shell presents over Home: the making flow (its describe, plan, making, ready and
 *  failure pages), the first-run ask in place of the data-sending action (the terms step, or the
 *  ask-mode consent step), and the store age check while it runs, which shows nothing at all. */
function isSheetScreen(screen: Screen): boolean {
  switch (screen.kind) {
    case 'describe':
    case 'plan':
    case 'making':
    case 'ready':
    case 'failure':
    case 'terms':
      return true;
    case 'consent':
      return screen.mode === 'ask';
    case 'age':
      return screen.held === undefined;
    default:
      return false;
  }
}

/** The native stack under `screen`, root first: Home, then each screen pushed on the way to it.
 *  A sheet is presented over Home, which stays under it. `null` for a screen that isn't on the
 *  stack: a running app and the full screens, which are drawn in its place. */
function stackFor(screen: Screen): readonly StackScreen[] | null {
  const home = { kind: 'home' } as const;
  // The first-run ask and the age check sit over the screen they replaced (Settings, History) and
  // over Home when that screen has no place on the stack.
  if (screen.kind === 'terms' || screen.kind === 'age' || (screen.kind === 'consent' && screen.mode === 'ask')) {
    return screen.kind === 'age' && screen.held !== undefined ? null : (stackFor(screen.returnTo) ?? [home]);
  }
  if (screen.kind === 'home' || isSheetScreen(screen)) return [home];
  if (screen.kind === 'settings' || screen.kind === 'history') return [home, screen];
  if (screen.kind === 'advanced' || (screen.kind === 'consent' && screen.mode === 'review')) {
    return [home, { kind: 'settings' }, screen];
  }
  if (screen.kind === 'report') return [...(stackFor(screen.from) ?? []), screen];
  return null;
}

/** The native header's title; none on Home and History, which draw their own header. */
function stackTitle(on: StackScreen): string | undefined {
  switch (on.kind) {
    case 'settings':
      return COPY.settingsTitle;
    case 'advanced':
      return COPY.settingsAdvancedSectionTitle;
    case 'consent':
      return COPY.settingsAISectionTitle;
    case 'report':
      return COPY.reportScreenTitle;
    default:
      return undefined;
  }
}

/** Whether a stack screen draws from the token module, following the phone's appearance; the
 *  consent screen still draws the fixed light v2 palette (`theme.ts`). Its header and the status bar
 *  follow whichever the screen on top draws. History follows the phone wherever it was opened from:
 *  it is a host screen, never the frame of the app it was opened over. */
function schemeFollowing(on: StackScreen): boolean {
  return on.kind === 'home' || on.kind === 'settings' || on.kind === 'advanced' || on.kind === 'report' || on.kind === 'history';
}

/** Whether the shell's frame (the status-bar strip above a screen drawn without the native stack)
 *  and the status bar's content follow the phone's scheme: they take the colours of the screen they
 *  frame — the token `bg` over a running app, the Home skeleton (`ready` false) and a scheme-following
 *  stack screen on `top`; the light v2 palette over a screen still drawn in it (the dev probe, the
 *  age hold, the missing link, the update screen). */
function frameFollowsScheme(screen: Screen, top: StackScreen | undefined, ready: boolean): boolean {
  if (top !== undefined) return schemeFollowing(top);
  return screen.kind === 'app' || !ready;
}

/** The frame's colours: over an open app those of the settings its realm was delivered with
 *  (`appFrame`, `null` before the delivery), else the phone's `live` tokens or the light v2 palette. */
function shellFrame(screen: Screen, top: StackScreen | undefined, ready: boolean, live: ShellTokens, appFrame: ShellTokens | null) {
  if (!frameFollowsScheme(screen, top, ready)) return { background: SHELL_PALETTE.bg, barStyle: 'dark-content' as const };
  const t = screen.kind === 'app' && appFrame !== null ? appFrame : live;
  return { background: t.colors.bg, barStyle: t.barStyle };
}

/** The update screen in place of `from`, holding the prompt typed there when `from` is a flow step
 *  that has one, and showing `notice` when a fallback opened it. Pure, so it can run inside a
 *  `setScreen` updater. */
function updateScreenFrom(from: Screen, notice?: string): Screen {
  const shown = notice === undefined ? {} : { updateNotice: notice };
  if ((from.kind === 'describe' || from.kind === 'plan') && from.text !== '') {
    return { kind: 'update-required', heldPrompt: { editing: from.editing, text: from.text }, ...shown };
  }
  return { kind: 'update-required', ...shown };
}

/** Where the update screen may open when the user's current action did not ask for it — the
 *  launch-time check's verdict, or a build left running being refused: Home, or a prompt being
 *  described. Anywhere else, above all a running mini-app, the user carries on, and their next AI
 *  action shows the screen. */
function updateMayInterrupt(screen: Screen): boolean {
  return screen.kind === 'home' || screen.kind === 'describe';
}

/** The developer affordance that opens the dev log overlay. A mechanism word, deliberately not in
 *  `copy.ts` — the same standing `DevProbeScreen`'s and the overlay's own labels have. */
const DEV_LOG_LABEL = 'Logs';

/** How far above the bottom safe area the orb's disc reaches: a toast over a running app sits its own
 *  gap above that (system.md §7.1 Toast, "12 pt above whatever floats"). */
const ORB_CLEARANCE = ORB_TARGET_EDGE + (ORB_TARGET + ORB_DISC) / 2;

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

/** A generation attempt's error as its Failure page says it (system.md §8): a request no server
 *  answered is a lost connection, which rewording never fixes; any other error as `errorReason`
 *  words it. */
function attemptErrorReason(err: unknown): { reason: string; diagnostics: readonly { hint: string }[] } {
  return isNetworkFailure(err) ? { reason: COPY.failureConnection, diagnostics: [] } : errorReason(err);
}

function attemptRephraseHelps(err: unknown): boolean {
  return !isNetworkFailure(err) && errorRephraseHelps(err);
}

function attemptRemedy(err: unknown): PendingFailureRemedy | undefined {
  return isNetworkFailure(err) ? { kind: 'retry' } : errorRemedy(err);
}

function attemptCause(err: unknown): { cause?: PendingFailureCause } {
  return isNetworkFailure(err) ? { cause: 'connection' } : {};
}

/** What a failed record keeps beside its reason: what gets past it, and what ended the run. */
type FailureTerms = Pick<PendingBuildFailure, 'remedy' | 'cause'>;

/** `appInfo` reads the installed app's platform, version and build for the request envelope;
 *  `deviceLocale` reads the phone's preferred
 *  locale, which picks the legal language until the user chooses one (legal-surface-v2 D6);
 *  `ageSignal` asks the store for its age signal before the terms step (legal-surface-v2 D11), and
 *  `significantUpdate` asks a supervised minor's guardian to acknowledge a terms change (beta-1
 *  D2; none on Android); `hideLaunchScreen` ends the native launch screen's cold-start hold once
 *  the first screen has painted. All default to the native seam. Only a suite passes another (the
 *  launcher runner has no native module), to give the shell a build or a phone of its choosing. */
export default function LauncherRoot({
  appInfo = installedAppInfo,
  deviceLocale = installedDeviceLocale,
  ageSignal = installedAgeSignal,
  significantUpdate = installedSignificantUpdate,
  hideLaunchScreen = nativeHideLaunchScreen,
}: Readonly<{
  appInfo?: () => AppInfo;
  deviceLocale?: () => string | undefined;
  ageSignal?: () => Promise<unknown>;
  significantUpdate?: SignificantUpdateSheet;
  hideLaunchScreen?: () => void;
}>) {
  // Construct the persistent host services once (device native modules — lazy under the hood).
  // The device id, server address and highlighting flag all read from the SAME `whim.launcher`
  // KVBackend instance the installed-apps index uses (one MMKV instance, several consumers).
  const { index, access, pending, journal, kv, purges } = useMemo(() => {
    const launcherKv: KVBackend = createMmkvBackend('whim.launcher');
    sweepRetiredKeys(launcherKv);
    const idx = new AppIndex(launcherKv);
    const store = createPersistentStore(createMmkvBackend('whim-version-store'));
    const acc = new StoreAccess({
      store,
      index: idx,
      deleteStorage: (appId) => deleteStorage({ appId }),
      // The data copy and its crash journal (copy-app-data D2/D3), the journal on the same backend.
      copyStorage,
      copyJournal: new DataCopyJournal(launcherKv),
    });
    return {
      index: idx,
      access: acc,
      pending: new PendingBuildStore(launcherKv),
      // The run journal rides on the SAME backend instance as the pending record it is a sibling
      // key of (design D1), under the same single-writer discipline.
      journal: new RunJournalStore(launcherKv),
      kv: launcherKv,
      // Delete and Discard wait out their Undo window on markers in the same KV (D16).
      purges: new PendingPurgeStore(launcherKv),
    };
  }, []);

  return (
    <LauncherShell
      index={index}
      access={access}
      pending={pending}
      journal={journal}
      purges={purges}
      kv={kv}
      appInfo={appInfo}
      deviceLocale={deviceLocale}
      ageSignal={ageSignal}
      significantUpdate={significantUpdate}
      hideLaunchScreen={hideLaunchScreen}
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
  // Above the navigation bar the app draws under (edge to edge on every Android version).
  const bottomInset = useSafeAreaInsets().bottom;
  if (!devLogOverlayEnabled(__DEV__)) {
    return null;
  }
  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        accessibilityLabel={DEV_LOG_LABEL}
        style={[styles.devLogBtn, { bottom: bottomInset + SPACING.md, backgroundColor: SHELL_PALETTE.card, borderColor: SHELL_PALETTE.cardBorder }]}
      >
        <Text style={[TYPE_SCALE.eyebrow, { color: SHELL_PALETTE.textMuted }]}>{DEV_LOG_LABEL}</Text>
      </TouchableOpacity>
      <DevLogOverlay visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** While the store age check runs it shows nothing, so Android back is the way out: it cancels the
 *  check, as `Back` on the age screen did. Mounted only for the length of the check. */
function AgeCheckBack({ onLeave }: Readonly<{ onLeave: () => void }>) {
  useSystemBack(onLeave);
  return null;
}

/** The ask the first-run sheet makes: the terms step, or the ask-mode consent step. */
type FirstRunAsk = Extract<Screen, { kind: 'terms' }> | Extract<Screen, { kind: 'consent'; mode: 'ask' }>;

function firstRunAskOf(screen: Screen): FirstRunAsk | null {
  if (screen.kind === 'terms') return screen;
  return screen.kind === 'consent' && screen.mode === 'ask' ? screen : null;
}

/**
 * Whether `page` is a page whose forward action has not been taken yet. A second tap on the same
 * page lands before React has drawn the next one, and a busy action ignores taps (system.md Button):
 * it would otherwise send a second request, or start a second run. Every page the machine moves to
 * is a new object.
 */
function useFirstTake() {
  const taken = useRef<object | null>(null);
  const firstTake = (page: object): boolean => {
    if (taken.current === page) return false;
    taken.current = page;
    return true;
  };
  return { firstTake };
}

/** What the first-run sheet needs of the current terms and consent state. */
interface FirstRunHostProps {
  ask: FirstRunAsk | null;
  language: LegalLanguage;
  onLanguageChange: (language: LegalLanguage) => void;
  /** The stored consent grant's version when it is outdated. */
  outdatedFrom: number | undefined;
  /** Whether the ask also needs the consent grant recorded (see `grantDue`). */
  consentDue: (ask: FirstRunAsk) => boolean;
  onAgree: (ask: FirstRunAsk) => void;
  onDecline: (returnTo: Screen) => void;
}

/** An ask with what the store said of the consent grant as it opened. */
interface OpenedAsk {
  ask: FirstRunAsk;
  consentDue: boolean;
  outdatedFrom: number | undefined;
}

/**
 * The first-run sheet (design-system-v1 16.2) in place of the data-sending action that opened it. It
 * is shown while the machine is on the terms or ask-mode consent step; closing it keeps showing the
 * ask that was open for the length of the sheet's exit, so it never animates out blank. The grant's
 * state is read once, as the ask opens: agreeing records the grant, and the sheet must leave reading
 * as it did when the person agreed, not as the store reads a moment later.
 */
function FirstRunHost({ ask, language, onLanguageChange, outdatedFrom, consentDue, onAgree, onDecline }: Readonly<FirstRunHostProps>) {
  const [kept, setKept] = useState<OpenedAsk | null>(null);
  const shown = ask !== null && kept?.ask !== ask ? { ask, consentDue: consentDue(ask), outdatedFrom } : kept;
  if (shown !== kept) setKept(shown);
  if (shown === null) return null;
  return (
    <FirstRunSheet
      visible={ask !== null}
      language={language}
      onLanguageChange={onLanguageChange}
      termsDue={shown.ask.kind === 'terms'}
      consentDue={shown.consentDue}
      termsOutdated={shown.ask.kind === 'terms' && shown.ask.outdated}
      outdatedFrom={shown.outdatedFrom}
      refused={shown.ask.refused}
      onAgree={() => onAgree(shown.ask)}
      onClose={() => onDecline(shown.ask.returnTo)}
    />
  );
}

/** How long an open waits on History's pop to Home when the stack never says the pop finished: past
 *  any push or pop UIKit or Android draws (19f3 measured them well under 0.5 s). */
const POP_FALLBACK_MS = 1000;

/** How long an open waits on reading the app back before it fails as an unreadable app does (the
 *  alert, then wherever that open's caller goes on a failure): a read that never settles must not hold
 *  a tile busy, or History over the app (whose second Back waits on that open), for good. */
const OPEN_READ_TIMEOUT_MS = 10_000;

/** `read`, or a rejection once `ms` have passed without it. A read that settles later is dropped. */
function readWithin<T>(read: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(COPY.appOpenTimedOut)), ms);
  });
  return Promise.race([read, late]).finally(() => clearTimeout(timer));
}

function LauncherShell({
  index,
  access,
  pending,
  journal,
  purges,
  kv,
  appInfo,
  deviceLocale,
  ageSignal,
  significantUpdate,
  hideLaunchScreen,
}: Readonly<{
  index: AppIndex;
  access: StoreAccess;
  pending: PendingBuildStore;
  journal: RunJournalStore;
  purges: PendingPurgeStore;
  kv: KVBackend;
  appInfo: () => AppInfo;
  deviceLocale: () => string | undefined;
  ageSignal: () => Promise<unknown>;
  significantUpdate: SignificantUpdateSheet | undefined;
  hideLaunchScreen: () => void;
}>) {
  const palette = SHELL_PALETTE;
  const tokens = useTokens();
  // The settings an open app's frame is held to from its delivery (`MiniAppStage`), `null` before it.
  const [appFrame, setAppFrame] = useState<ShellTokens | null>(null);
  // The language every legal screen and link uses (legal-surface-v2 D6): resolved once at launch
  // from the stored choice or the phone's language, and replaced when the user taps a switch.
  const [phoneLocale] = useState(deviceLocale);
  const [legalLanguage, setLegalLanguage] = useState<LegalLanguage>(() => activeLegalLanguage(kv, phoneLocale));
  const onLegalLanguageChange = (language: LegalLanguage) => {
    chooseLegalLanguage(kv, language);
    setLegalLanguage(language);
  };

  const [screen, setScreen] = useState<Screen>({ kind: 'home' });
  // What is on screen now, for a run that settles later: its closure holds the screen it started on.
  const screenKindRef = useRef(screen.kind);
  useEffect(() => {
    screenKindRef.current = screen.kind;
  }, [screen.kind]);
  // The running app a change's pages sit over: it stays open under them (`appUnder`), and closing them
  // returns to it. Dropped once the screen leaves those pages.
  const [under, setUnder] = useState<AppScreen | null>(null);
  useEffect(() => {
    if (!overApp(screen)) setUnder(null);
  }, [screen]);
  const running = screen.kind === 'app' ? screen : appUnder(screen, under);
  // The same, for a run or a toast that acts later than the render it was started from.
  const runningRef = useRef(running);
  runningRef.current = running;
  // A change that landed while this launch of its app ran, and the entry it landed on: the orb's dot and
  // the Whim sheet's Reload row stay until the app opens again, by Reload or otherwise.
  const [landed, setLanded] = useState<(LaunchMark & { entry: InstalledApp }) | null>(null);
  // Another app that finished while this launch ran: the orb's dot, until the app opens again.
  const [finished, setFinished] = useState<LaunchMark | null>(null);
  // The words in the Whim sheet's send area, for the app they were typed over. Held here, above the
  // sheet's content, which a text-size change builds again.
  const [whimWords, setWhimWords] = useState<{ appId: string; text: string } | null>(null);
  // The Whim sheet's reading of the running app's versions, for the opening it was read in (`at`, the
  // launch's `tappedAt`): the running version, and whether a newer one is current.
  const [whimVersions, setWhimVersions] = useState<{ at: number; version: RunningVersion | null; newVersion: boolean } | null>(null);
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
  const [pendingBuilds, setPendingBuilds] = useState<PendingBuildView[]>([]);
  const [ready, setReady] = useState(false);
  // Read by the mount-once app-link listener effect below, which cannot depend on `ready` without
  // resubscribing `Linking`'s event on every first-run tick.
  const readyRef = useRef(ready);
  readyRef.current = ready;
  // The override every request follows: `undefined` until the user has acknowledged that their
  // own server is their responsibility (design D20), whatever an earlier build saved.
  const [serverUrl, setServerUrl] = useState<string | undefined>(() => serverOverride(kv));
  const [ownServerAck, setOwnServerAck] = useState<boolean>(() => ownServerAcknowledged(kv));
  // Advanced's chosen server row; Whim's server keeps the saved address (`server-address.ts`).
  const [chosenServer, setChosenServer] = useState<ServerChoice>(() => serverChoice(kv));
  // The session probe's latest answer and the address it went to: Advanced shows it under the
  // address field rather than sending a probe of its own (#130).
  const [lastProbe, setLastProbe] = useState<SessionProbe | null>(null);
  const [highlighting] = useState<boolean>(() => loadHighlighting(kv));
  const [errorDetailsShown, setErrorDetailsShown] = useState<boolean>(() => errorDetailsEnabled(kv));

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
    () => consentedClientOptions(termsStatus(kv), consentStatus(kv), effectiveServerUrl(kv), deviceId, appInfo),
    // consentTick/serverUrl stand in for the KV reads above (acceptTerms/grantConsent/revokeConsent/
    // saveServerUrl mutate `kv` directly, which is not itself a React dependency) — the same
    // "extra dep forces a re-read" idiom this file's other KV-backed memos and effects already use.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [consentTick, serverUrl, deviceId, kv, appInfo],
  );

  /** The options a data-sending entry point acts with, RIGHT NOW: the memo when it already reflects
   *  the current grant, or a fresh live read (`consent-options.ts`) when it does not yet — the gap
   *  `onConsentAskAgree` and `onTermsAccept` fall into, since the `consentTick` bump does not
   *  retire the memo until the render AFTER this call returns (spec ai-data-consent "After the user
   *  agrees, the action they started SHALL continue as if consent had already existed"). */
  const resolveClientOptions = (): ConsentedClientOptions | null =>
    resolveOptions(clientOptions, liveClientOptions(kv, deviceId, appInfo));

  // Plain `ClientOptions` for the report sheet's `sendReport` call (design D3 — reporting is the
  // ONE request that needs no AI-data consent and no terms acceptance, so this is never gated the
  // way `clientOptions` above is). It still reads the grant, for the consent version its envelope
  // names, so it is keyed on `consentTick` too.
  const reportOptions = useMemo<ClientOptions>(
    () => reportClientOptions(consentStatus(kv), effectiveServerUrl(kv), deviceId, appInfo),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [consentTick, serverUrl, deviceId, kv, appInfo],
  );

  const [connectivity, setConnectivity] = useState<Connectivity>('unknown');
  const connectivityLoopRef = useRef<ConnectivityLoop | null>(null);
  const connectivityEpoch = useRef(0);

  // Capture at request start. A response belongs to the address and consent session that sent
  // it, even if a detached generation outlives a Settings edit or a revoke/regrant cycle.
  const connectivityOfRequest = (options: ConsentedClientOptions) => {
    const epoch = connectivityEpoch.current;
    return (act: (loop: ConnectivityLoop) => void): void => {
      if (epoch === connectivityEpoch.current && options.baseUrl === effectiveServerUrl(kv)) {
        const loop = connectivityLoopRef.current;
        if (loop) act(loop);
      }
    };
  };
  const onlineForRequest = (options: ConsentedClientOptions): (() => void) => {
    const inSession = connectivityOfRequest(options);
    return () => inSession((loop) => loop.markOnline());
  };
  // A request that got no answer at all is the strongest sign the connection is gone: the loop
  // confirms it with a probe and turns offline, and the notice follows.
  const failureForRequest = (options: ConsentedClientOptions): ((error: unknown, abandoned?: boolean) => void) => {
    const inSession = connectivityOfRequest(options);
    return (error, abandoned = false) => {
      if (!abandoned && isNetworkFailure(error)) inSession((loop) => loop.noteNetworkFailure());
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
  // The launch-time update check (request-envelope D5) rides on this loop's own `/health` probe —
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
    // The update check is a launch-time one: the first probe that reads a minimum decides it, so
    // a later probe (a return to the foreground, a retry) never brings back an update screen the
    // person has dismissed.
    let minimumRead = false;
    const loop = new ConnectivityLoop({
      probe: async () => {
        const health = await probeServerHealth(decision.baseUrl);
        // A later probe that finds what the last one found leaves the screens as they are.
        if (live) {
          setLastProbe((prev) => (prev?.address === decision.baseUrl && prev.result === health.result
            ? prev
            : { address: decision.baseUrl, result: health.result }));
        }
        const firstMinimum = !minimumRead && health.minBuild !== undefined;
        if (firstMinimum) minimumRead = true;
        if (live && firstMinimum && belowMinimumBuild(appInfo, health.minBuild)) {
          log.warn(CHANNELS.app, 'installed build is below the server minimum', { ...health.minBuild });
          setScreen((prev) => (updateMayInterrupt(prev) ? updateScreenFrom(prev) : prev));
        }
        return health.result;
      },
      publish: setConnectivity,
      foreground: appIsForeground(),
    });
    connectivityLoopRef.current = loop;
    loop.start();
    return () => {
      live = false;
      loop.stop();
      if (connectivityLoopRef.current === loop) connectivityLoopRef.current = null;
    };
  }, [clientOptions, appInfo]);

  // The loop touches the network only while the app is in the foreground, and a return to it
  // re-checks. Applied to every loop the effect above builds (it runs first).
  const appForeground = useAppForeground();
  useEffect(() => {
    connectivityLoopRef.current?.setForeground(appForeground);
  }, [clientOptions, appInfo, appForeground]);

  // A breadcrumb for every connectivity transition, the same device-observability discipline as
  // the `serverUrl`-keyed sink-config effect above: this session state has no screen surface of
  // its own yet (offline-ux-surfaces, a later change reads it off this shell), so the seam is the
  // only place a transition is currently observable.
  useEffect(() => {
    log.debug(CHANNELS.app, 'connectivity state changed', { connectivity });
  }, [connectivity]);

  /** How many tiles the grid is known to be about to show — the skeleton's exact count. Read
   *  synchronously from the index at mount, before first-run seeding resolves. An app whose purge is
   *  armed is about to be removed by the launch sweep, so it is not a cell to promise. */
  const knownAppCount = useMemo(() => index.list().filter((a) => !purges.has('app', a.id)).length, [index, purges]);

  // Tracks the in-flight generation's abort controller, the caller's own cancellation intent, and
  // whether the user left it running (generation-client's abort contract: the caller must track
  // intent itself rather than infer it from the stream's output, since an abort and an unrelated
  // truncated stream look identical). Cleared once the generation settles.
  type GenerationControl = { controller: AbortController; cancelled: boolean; detached: boolean };
  const genRef = useRef<GenerationControl | null>(null);

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
  // handle onto the latest `openAppLink` closure — refreshed every render below, so the mount-once
  // `Linking` subscription (registered once, further down) always reaches the CURRENT `screen`
  // rather than the one captured at mount.
  const pendingLinkHolder = useRef(new PendingLinkHolder()).current;
  const openAppLinkRef = useRef<(id: string) => void>(() => {});

  type LiveAttempt = {
    id: string;
    lease: PendingAttemptLease;
    screen: MakingScreen;
    signals: RunSignals;
    ctl: GenerationControl;
    /** A Try again's record and journal as they were before it: what a Stop brings back. */
    retrySnapshot: AttemptSnapshot | undefined;
  };
  // Every active attempt keeps its own reattachment state. `liveRef` names the one selected by
  // the current build screen, so background frames can update their own journal without replacing
  // the selected run's progress or controls.
  const liveAttemptsRef = useRef(new Map<string, LiveAttempt>()).current;
  const liveRef = useRef<LiveAttempt | null>(null);

  // The live attempt's derived-signal state (design D6): its start time, the cumulative counts
  // folded from its stream and the arrival that the heartbeat measures quiet from. A REF, not
  // state, because it moves on every token — re-rendering per token is exactly the cadence this
  // change refuses. The Making page's clock moves on the tick below instead, and the journal is
  // never read to produce any of it.
  const signalsRef = useRef<RunSignals | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (screen.kind !== 'making') return undefined;
    const timer = setInterval(() => setTick((t) => t + 1), RUN_SIGNAL_TICK_MS);
    return () => clearInterval(timer);
  }, [screen.kind]);

  // The shell's one toast host is mounted above this component's own render, so its API reaches
  // the shell through `ToastBridge`: a run that delivers with the sheet closed says so on Home.
  const toastRef = useRef<ToastApi | null>(null);

  /** Whether the timeline shows the developer counts, decided once — never a bare `__DEV__` check
   *  (decision #60(c)). */
  const timelineDevMode = runTimelineDevModeEnabled(__DEV__);

  const refresh = () => {
    setApps(index.list());
    setPendingBuilds(pending.listCurrent());
  };

  // Delete and Discard hide at once and purge when their Undo window ends (design D16). The windows
  // outlive Home (a delete is not undone by opening Settings); the markers outlive the process.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const purgeWindows = useMemo(
    () =>
      new PurgeWindows({
        purges,
        complete: (marker) => completePurge({ purges, index, access, pending, journal }, marker),
        changed: () => refreshRef.current(),
        failed: (marker, e) =>
          log.error(CHANNELS.app, 'purge did not complete', { kind: marker.kind, appId: marker.id, ...errorFields(e) }),
      }),
    [purges, index, access, pending, journal],
  );
  useEffect(() => () => purgeWindows.dispose(), [purgeWindows]);

  // A change to the running app: being made, or failed while this launch of it ran (a discarded one is
  // gone as far as the person is concerned).
  const runningChange = changeOver(running, pendingBuilds, (rec) => purges.hidesAttempt(rec), landed, finished);

  // The view of the attempts running right now: which wait for a spot, how hard each stream works.
  // Home's tiles read it, and so do the Making page's ember and the orb, each for its own run only.
  const liveView = useHomeLive(screen.kind === 'home' || screen.kind === 'making' || runningChange.changing !== undefined, () => [...liveAttemptsRef.values()]);
  const orb = orbOver(runningChange, liveView.activity);

  /** The installed apps and the attempts a person can reach: those whose purge is armed are gone as far
   *  as a link or a tile is concerned (an attempt only for the run its Discard named). */
  const reachableApps = () => index.list().filter((a) => !purges.has('app', a.id));
  const reachableAttempts = () =>
    pending.listCurrent().map((view) => view.record).filter((r) => !purges.hidesAttempt(r));

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
      // Before any app can open: a data copy a closed process left unfinished becomes no copy, or
      // the complete one it committed (copy-app-data D2). A copy that cannot be settled now keeps
      // its record for the next launch.
      try {
        await access.sweepDataCopies();
      } catch (e) {
        log.error(CHANNELS.app, 'data-copy sweep failed', { operation: 'sweep', ...errorFields(e) });
      }
      // A delete or a discard a closed process had not finished is finished now, before the grid is
      // first drawn; one that cannot be finished keeps its marker (and stays hidden) for next time.
      await completeInterruptedPurges({ purges, index, access, pending, journal });
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

  /** The version the app opened at `tappedAt` runs, once read, kept on that launch's screen. */
  const noteRunningVersion = (tappedAt: number, versionId: string | null) => {
    if (versionId === null) return;
    setScreen((s) => (s.kind === 'app' && s.tappedAt === tappedAt ? { ...s, versionId } : s));
    setUnder((u) => (u?.tappedAt === tappedAt ? { ...u, versionId } : u));
  };

  /** Reads `app`'s current bundle for the launch tapped at `tappedAt` and hands that launch to `show`;
   *  the version it runs is read right behind the bundle, on the app's serial store queue (so no
   *  write lands between the two), and after it, so neither the opening nor the busy tile waits for it.
   *  A bundle read past `OPEN_READ_TIMEOUT_MS` rejects, and nothing shows when it settles. */
  const launchApp = async (app: InstalledApp, tappedAt: number, show: (launch: AppScreen) => void) => {
    const bundleRead = access.activeBundle(app);
    const versionRead = access.activeId(app).catch(() => null);
    const source = await readWithin(bundleRead, OPEN_READ_TIMEOUT_MS);
    show({ kind: 'app', app, record: app.record, source, engineAppId: access.engineAppId(app), tappedAt });
    versionRead.then((versionId) => noteRunningVersion(tappedAt, versionId));
  };

  /** An app that could not be opened: the user gets the alert; the class/message/stack of what
   *  actually failed is only recoverable from the seam (host-observability "The alert paths now log"). */
  const openFailed = (e: unknown) => {
    log.error(CHANNELS.app, 'installed-app action failed', { operation: 'open', ...errorFields(e) });
    Alert.alert('Could not open this app', (e as Error)?.message ?? String(e));
  };

  /** The pop History's own Back starts when History was opened from Home: the shell asks for it, so
   *  UIKit animates it, and an app opening meanwhile would unmount the stack mid-pop (react-native-screens
   *  then keeps the unfinished pop in the stack it recycles, and the next Home it shows is blank for good,
   *  iOS). It ends when the stack says its move finished (`NativeStack`'s `onSettled`), or after
   *  `POP_FALLBACK_MS` should that never come. A push the platform is still drawing finishes first and
   *  says so too (Android back during History's push): that word is the push's, not the pop's, so the
   *  hold waits for one more per push in flight (`waits`). `latest` numbers what waits on it: only the
   *  last one goes. */
  const stackPop = useRef<{ settled: Promise<void>; end: () => void; waits: number; latest: number } | null>(null);
  /** Pushes the platform is drawing and has not yet said it finished. */
  const stackPushes = useRef({ depth: 0, drawing: 0 });
  const startStackPop = () => {
    if (stackPop.current !== null) return;
    let release!: () => void;
    const settled = new Promise<void>((resolve) => { release = resolve; });
    const end = () => {
      clearTimeout(timer);
      if (stackPop.current === pop) stackPop.current = null;
      release();
    };
    const timer = setTimeout(end, POP_FALLBACK_MS);
    const pop = { settled, end, waits: 1 + stackPushes.current.drawing, latest: 0 };
    stackPop.current = pop;
  };
  /** The stack finished a move it was drawing: the oldest push in flight, else the pop. */
  const onStackSettled = () => {
    const pushes = stackPushes.current;
    pushes.drawing = Math.max(0, pushes.drawing - 1);
    const pop = stackPop.current;
    if (pop === null) return;
    pop.waits -= 1;
    if (pop.waits <= 0) pop.end();
  };
  useEffect(() => () => {
    // The shell is gone: nothing that waits on the pop may run.
    const pop = stackPop.current;
    if (pop === null) return;
    pop.latest = -1;
    pop.end();
  }, []);
  /** Waits out that pop, if one runs: whether what waited may still go once it has finished — `false`
   *  when something else arrived after it, which goes instead (two opens never both land). */
  const stackPopOver = (): Promise<boolean> => {
    const pop = stackPop.current;
    if (pop === null) return Promise.resolve(true);
    pop.latest += 1;
    const turn = pop.latest;
    return pop.settled.then(() => pop.latest === turn);
  };

  /** The tile's tap: busy from the tap until the mini-app screen replaces the grid or the open
   *  fails (`app-launcher` "Opening an app shows an immediate busy affordance" — a tap MUST NOT
   *  read as unregistered while the active bundle is being read). `onFailed` runs after a failed
   *  open's alert, for a caller that must not stay where it is. An open arriving while History's
   *  pop to Home runs (a tile, the "is ready" toast) is busy from the tap and waits for the pop to
   *  finish; it is dropped when something else arrived after it, or the person left Home meanwhile. */
  const onOpen = (app: InstalledApp, onFailed?: () => void): Promise<boolean> => {
    const tappedAt = Date.now();
    const holding = stackPop.current !== null;
    return runAppOp(appOps, setAppBusy, app.id, 'open', async () => {
      if (holding && !((await stackPopOver()) && screenKindRef.current === 'home')) return;
      try {
        await launchApp(app, tappedAt, setScreen);
      } catch (e) {
        openFailed(e);
        onFailed?.();
      }
    });
  };

  /** Reload (the toast's, or the Whim sheet's row): the running app opens again on the version that is
   *  now current, in place — a new launch, so a fresh WebView and realm (`MiniAppStage`), with nothing
   *  in between: no Home, no closed frame. A change that landed on a continuation opens that entry
   *  instead, and so does `landedOn`, the entry a toast named (the app opened again since, it runs
   *  behind that entry). A launch the person has left meanwhile is not reopened; one whose bundle
   *  cannot be read keeps running as it was. */
  const reloadRunning = async (landedOn?: InstalledApp): Promise<void> => {
    if (running === null) return;
    const from = running;
    const target = landedOn ?? runningChange.landed ?? from.app;
    const app = index.get(target.id) ?? target;
    const tappedAt = Date.now();
    // The Whim sheet Reload was pressed in starts closing at the press, not once the bundle is read.
    setScreen((s) => (s.kind === 'app' && s.tappedAt === from.tappedAt && s.sheet !== undefined ? { ...s, sheet: undefined } : s));
    await runAppOp(appOps, setAppBusy, app.id, 'open', async () => {
      try {
        await launchApp(app, tappedAt, replacing(from));
      } catch (e) {
        openFailed(e);
      }
    });
  };
  /** Puts a new launch in the place of `from`, wherever it still is: on screen, or under a sheet. */
  const replacing = (from: AppScreen) => (next: AppScreen) => {
    setScreen((s) => (s.kind === 'app' && s.tappedAt === from.tappedAt ? next : s));
    setUnder((u) => (u?.tappedAt === from.tappedAt ? next : u));
  };
  const reloadRef = useRef(reloadRunning);
  reloadRef.current = reloadRunning;

  /** Make a copy, from the current version or History's `versionId`: busy for that app while it runs.
   *  Resolves the new entry, or `null` when a copy (or an open) of the app is already running; rejects
   *  when the copy could not be made, with nothing created (`StoreAccess.fork`'s error surface), for
   *  Home or History to say so in a toast. */
  const onFork = (app: InstalledApp, opts: ForkOptions, versionId?: string): Promise<InstalledApp | null> =>
    runFork(
      (work) => runAppOp(appOps, setAppBusy, app.id, 'fork', work),
      async () => {
        const made = await access.fork(app, versionId, opts);
        refresh();
        return made;
      },
      (e) => log.error(CHANNELS.app, 'installed-app action failed', { operation: 'fork', ...errorFields(e) }),
    );

  const onHistory = (app: InstalledApp, from: 'home' | 'app') => {
    setScreen({ kind: 'history', app, from });
  };

  /** A native pop of History (a swipe): Home, and from there back into the app it was opened over,
   *  reopened at whatever version is now current (a restore there may have moved it). Home at once:
   *  the platform has already popped it, and its pops must find the machine off it (`NativeStack.tsx`). */
  const leaveHistory = (app: InstalledApp, from: 'home' | 'app') => {
    goHome();
    if (from === 'app') onOpen(index.get(app.id) ?? app);
  };

  /** History's own Back and system back, when it was opened over an app: History stays until that app
   *  has opened again and replaces it in one step; Home only when it cannot be opened, never stranded on
   *  History. Never Home first: going Home pops the stack, which UIKit animates, and the app opening
   *  would unmount the stack mid-pop. react-native-screens then keeps the unfinished pop in the stack it
   *  recycles, and the next Home it shows is blank for good (iOS). So a second Back while that app is
   *  already opening does nothing: the open in flight replaces History, or fails to Home with its alert
   *  (a read past `OPEN_READ_TIMEOUT_MS` among them). Home only when the app is busy with something
   *  else (a copy). */
  const backFromHistoryToApp = (app: InstalledApp) => {
    if (appOps.opFor(app.id) === 'open') return;
    onOpen(index.get(app.id) ?? app, goHome)
      .then((opened) => {
        if (!opened) goHome();
      })
      .catch(() => undefined);
  };

  /** History's own Back and system back, when it was opened from Home: a pop the shell asks for, which
   *  an open arriving meanwhile waits out (`stackPop`). A swipe has already popped and leaves through
   *  `leaveHistory`. */
  const backFromHistoryToHome = () => {
    startStackPop();
    goHome();
  };

  /** History's own Back and system back, for where it was opened from. */
  const historyBack = (on: HistoryScreenState) => (on.from === 'app' ? () => backFromHistoryToApp(on.app) : backFromHistoryToHome);

  /** Delete and Discard hide at once and complete when their Undo toast ends (`soft-delete.ts`):
   *  Home calls the `Settle` pair then. An Undo answers whether it restored everything. */
  const onDelete = (app: InstalledApp) => purgeWindows.armApp(app);
  const onUndoDelete = (app: InstalledApp) => purgeWindows.undo('app', app.id);
  const onSettleDelete = (app: InstalledApp) => {
    purgeWindows.finish('app', app.id).catch(() => undefined);
  };
  const onDiscard = (recs: readonly PendingBuildRecord[]) => recs.forEach((rec) => purgeWindows.armAttempt(rec));
  const onUndoDiscard = (recs: readonly PendingBuildRecord[]) =>
    recs.map((rec) => purgeWindows.undo('attempt', rec.id)).every(Boolean);
  const onSettleDiscard = (recs: readonly PendingBuildRecord[]) => {
    recs.forEach((rec) => {
      purgeWindows.finish('attempt', rec.id).catch(() => undefined);
    });
  };

  /** "Customize tile": the override is stored host-side and wins over the assigned tile. */
  const onCustomizeTile = (app: InstalledApp, tile: TileIdentity) => {
    index.setTileOverride(app.id, tile);
    refresh();
  };
  const onResetTile = (app: InstalledApp) => {
    index.clearTileOverride(app.id);
    refresh();
  };

  /** The session's making-sheet drafts (`flow-draft.ts`): the page left on Describe or Plan, with its
   *  words, answers and plan edits, one for a new app and one per app being changed. */
  const drafts = useRef(new FlowDrafts()).current;
  const [composerDraft, setComposerDraft] = useState<string | undefined>(undefined);
  const syncComposerDraft = () => setComposerDraft(drafts.composerWords());

  /** The leave-handler half of the flow's cancellation pattern: leaving a page cancels its OWN
   *  in-flight request and nothing else. Describe never has one; Plan owns the clarify exchange (the
   *  `'compose'` slot) and the rewrite (the `'plan'` slot), both aborted when the sheet is left, so an
   *  abandoned request neither moves a screen nor shows a failure. */
  const leaveFlowStep = (kind: Screen['kind']) => {
    if (kind === 'plan') {
      flowRequests.abort('compose');
      flowRequests.abort('plan');
    }
  };

  /** Leaving a draft page by any route (close, scrim, drag, back, a link, a screen that replaces
   *  it) aborts what it has in flight and keeps what the person had, to come back to from the composer. */
  const keepDraft = (from: Screen) => {
    leaveFlowStep(from.kind);
    if (from.kind === 'describe' || from.kind === 'plan') {
      drafts.keep(from);
      syncComposerDraft();
    }
  };

  const goHome = () => {
    keepDraft(screen);
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
   *  from the Report screen or the running app's sheet: the update screen replaces the screen the
   *  report sits on — only while that screen still shows, the same never-pull-back rule every other
   *  refusal follows. */
  const onReportUpdateRequired = (notice?: string) => {
    setScreen((prev) => (prev.kind === 'report' || prev.kind === 'app' ? updateScreenFrom(prev, notice) : prev));
  };

  /** After a write that may have moved where requests go: when it did, the connectivity session
   *  restarts and diagnostics waiting to upload are dropped, so a record about one server never
   *  reaches another (design D20). */
  const afterServerWrite = (previous: string) => {
    if (effectiveServerUrl(kv) === previous) return;
    invalidateConnectivity();
    log.diagnostics.discard();
  };

  const onServerUrlChange = (url: string) => {
    const previous = effectiveServerUrl(kv);
    saveServerUrl(kv, url);
    afterServerWrite(previous);
    setServerUrl(serverOverride(kv));
  };

  const onErrorDetailsChange = (on: boolean) => {
    setErrorDetails(kv, on);
    setErrorDetailsShown(on);
  };

  /** Advanced's confirmed "Make a new ID": the stored ID is replaced, and the options memos (keyed on
   *  `deviceId`) rebuild, so every later request carries the new one. */
  const onResetDeviceId = () => {
    setDeviceId(resetDeviceId(kv));
  };

  /** Advanced's server rows: Whim's server keeps the saved address, unread; your own server reads
   *  it again, with nothing to confirm once acknowledged. */
  const onChooseServer = (choice: ServerChoice) => {
    const previous = effectiveServerUrl(kv);
    chooseServer(kv, choice);
    afterServerWrite(previous);
    setChosenServer(serverChoice(kv));
    setServerUrl(serverOverride(kv));
  };

  /** Advanced's confirmed "Use your own server": records the acknowledgement and chooses it, so a
   *  saved address is honoured from now on. */
  const onAcknowledgeOwnServer = () => {
    const previous = effectiveServerUrl(kv);
    acknowledgeOwnServer(kv);
    chooseServer(kv, 'own');
    afterServerWrite(previous);
    setOwnServerAck(true);
    setChosenServer(serverChoice(kv));
    setServerUrl(serverOverride(kv));
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
  // History’s "Change it", and Retry — calls `openWithConsent` instead of acting
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
      openCompose(continuation.editing, continuation.text);
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

  /** Whether the flow began on the AI features review screen (the one flow that continues to
   *  Settings), which showed the whole disclosure and whose "Turn on AI features" is the consent
   *  itself (#104): its consent step grants rather than showing the disclosure a second time. */
  const reviewedConsent = (flow: LegalFlow<Screen>): boolean => flow.continuation.kind === 'settings';

  /** Moves the flow on: opens its next legal screen, or runs its continuation when nothing is left
   *  to ask. `age` is passed only by the age check, with the result it just derived. */
  const advanceLegalFlow = (flow: LegalFlow<Screen>, age?: AgeGate) => {
    const next = legalScreen(flow, age);
    if (next === undefined) {
      runContinuation(flow.continuation);
    } else if (next.kind === 'consent' && reviewedConsent(flow)) {
      onGrantConsent();
      runContinuation(flow.continuation);
    } else {
      setScreen(next);
    }
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

  /** Whether `ask` also needs the consent grant recorded: it is not current, or the server refused it
   *  again. When only the terms are due the stored grant is left exactly as it is. */
  const grantDue = (ask: FirstRunAsk): boolean => consentGrantDue(consentStatus(kv), ask.refused);

  /** The first-run sheet's `Agree to send descriptions`: the two acts on purpose, each recorded as it
   *  always was with its own version — the terms acceptance when it was due, and the consent grant
   *  when it is not current (or a `consent_required` refusal asked again) — then the action the
   *  user started continues as if both had always been there (spec ai-data-consent "After the user
   *  agrees, the action they started SHALL continue as if consent had already existed"). */
  const onFirstRunAgree = (ask: FirstRunAsk) => {
    if (ask.kind === 'terms') onAcceptTerms();
    if (grantDue(ask)) onGrantConsent();
    runContinuation(ask.continuation);
  };

  /** Declining the legal flow (`Not now`, close, and hardware back — all routed through the
   *  sheet's or screen's one `onClose`): grants and accepts nothing, and returns to whatever screen the flow
   *  replaced (design D5: Home for a running mini-app, since a torn-down realm is never resumed). */
  const onLegalDecline = (returnTo: Screen) => {
    setScreen(declineTarget<Screen>(returnTo));
  };

  /** Turning AI features on from their review screen (spec terms-acceptance "One pass through the
   *  legal flow shows each legal screen at most once"; beta-1 D6, #104): the legal flow from its
   *  first due step, so the age check and the terms step when due; the review screen was the one
   *  consent screen (`reviewedConsent`). It ends back on Settings, and declining any step returns
   *  there too. */
  const onTurnOnAIFeatures = () => {
    advanceLegalFlow({ continuation: { kind: 'settings' }, returnTo: { kind: 'settings' }, refused: false });
  };

  /** Settings' AI features row: the consent screen in review mode, pushed on the stack, to keep
   *  them on or turn them off whatever the terms say, or to turn them on. */
  const onOpenAIFeatures = () => {
    setScreen({ kind: 'consent', mode: 'review' });
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

  // ── The making sheet's flow (design-system-v1 D15) ─────────────────────────────────────────
  // describe → plan → making → ready | failure. Every forward move is gated by the page's one
  // action and carries its requests; every backward move is immediate. The pages never touch
  // fetch, StoreAccess or AbortController — all of that lives here.

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
    const reasoned = attemptErrorReason(err);
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
      rephraseHelps: attemptRephraseHelps(err),
      ...attemptCause(err),
    };
  };

  /** A storage-degraded terminal outcome is generic on screen. The record and journal identities
   * are carried independently: the failure is discardable when its record read-back verified, but
   * a timeline is named only after a terminal journal read-back verified too. */
  const genericAttemptFailure = (
    editing: InstalledApp | undefined,
    prompt: string,
    stage: string,
    observed: number,
    recordId?: string,
    journalId?: string,
    pendingId?: string,
  ): Screen => ({
    ...failure(editing, prompt, new Error(GENERIC_STREAM_ERROR), stage, observed),
    ...(recordId != null ? { recordId } : {}),
    ...(journalId != null ? { journalId } : {}),
    ...(pendingId != null ? { pendingId } : {}),
  });

  const { firstTake } = useFirstTake();

  /** Opens the making sheet, optionally scoped to one app being changed: on the draft the person left
   *  for it (a plan page comes back as it was, with its answers and edits; its missing requests are
   *  sent again), or on a fresh describe page. `about` (change mode's shared clarify/rewrite
   *  `app.description`) is resolved AFTER the sheet is already showing — best effort, never
   *  blocking the field the user is about to type into — and lands directly in `aboutRef`, keyed by
   *  `editing.id`, rather than onto the screen: a user who taps Continue before it resolves must
   *  still get it on the clarify/rewrite request that follows (the "about" race), and `aboutRef` is
   *  read at request time regardless of which page is showing when the read lands. Capped here too,
   *  not only where `buildRewriteAppContext` sends it (`generation-request.ts`'s
   *  `APP_CONTEXT_DESCRIPTION_MAX_CHARS` doc comment) — a cap enforced only on the read side is not
   *  a cap. A read that fails or finds no snapshot leaves `aboutRef` untouched for this id, which
   *  `aboutFor` already treats as "no description" — a degraded change flow, never a blocked one. */
  const openCompose = (requested?: InstalledApp, text?: string) => {
    // The app as it is now: a draft kept for it carries the app as it was when the draft was kept (a
    // new version, a new name, a customised tile), and the plan's requests must send the current one.
    // An app that has gone takes its draft with it and leaves nothing to change: the page that opens
    // is the new-app one, as the composer opens it.
    const editing = reachableApps().find((app) => app.id === requested?.id);
    if (requested && !editing) drafts.clear(draftKey({ editing: requested }));
    // A change of this app is already being made: that run shows, rather than a second change that
    // would replace it.
    if (editing && pending.hasLiveAttempt(editing.id)) {
      showRunInFlight(editing.id, editing);
      return;
    }
    const kept = text === undefined ? drafts.reopen(editing, editing) : undefined;
    const opened = kept ?? describeStep(editing, text ?? takeHeldPrompt(editing) ?? '');
    setScreen(opened);
    if (opened.kind === 'plan') resumePlan(opened);
    if (editing) readAbout(editing, 'openCompose');
  };

  /** Reads what `editing` currently is (its description) into `aboutRef`, in the background. */
  const readAbout = (editing: InstalledApp, operation: string) => {
    (async () => {
      let about: string | undefined;
      try {
        about = await access.activeDescription(editing);
      } catch (e) {
        log.debug(CHANNELS.app, 'edit description unavailable', { operation, ...errorFields(e) });
        return;
      }
      if (about == null) return;
      aboutRef.current = { id: editing.id, about: about.trim().slice(0, APP_CONTEXT_DESCRIPTION_MAX_CHARS) };
    })();
  };

  /** The plan page's header back: Describe, with the words kept and this plan to come back to. Aborts
   *  what the page had in flight (and so the draft is kept only as far as it landed). */
  const backToDescribePage = (from: PlanScreen) => {
    leaveFlowStep('plan');
    setScreen(backToDescribe(from));
  };

  /** A request-failure on the plan page that is not a refusal and not an update: stays on the page
   *  with the sentence and Try again (spec "A connection problem before any run ... SHALL NOT open
   *  the failure page"). A request no server answered says so as a connection problem. */
  const planProblem = (request: 'clarify' | 'rewrite', e: unknown): ((s: PlanScreen) => PlanScreen) => {
    logGenError(`${request} failed`, e);
    const problem: PlanProblem = isNetworkFailure(e)
      ? { request, reason: COPY.planOffline, offline: true }
      : { request, reason: errorReason(e).reason };
    return (current) => withProblem(current, problem);
  };

  /** Where a clarify or rewrite refusal, `update` fallback or refused `consent_required` lands: back
   *  on Describe with the words (the request was sent from its Continue), carrying the notice, or on
   *  the screen the refusal opens of its own. `undefined` when `e` is neither. A refusal proves the
   *  server answered. Called outside any `setScreen` updater, since the failure screen's construction
   *  logs. */
  const refusalLandingOf = (from: PlanScreen, request: 'clarify' | 'rewrite', e: unknown, markOnline: () => void): Screen | undefined => {
    const back = describeStep(from.editing, from.text);
    // A reply this build can't use, whose fallback is `update` (beta-1 D16): the update screen, with
    // its notice, holding the typed prompt. A `fail` fallback is no landing here (see `planProblem`).
    const fallback = terminalFallbackOf(e);
    if (fallback?.kind === 'update') {
      markOnline();
      logUpdateFallback(request, e);
      return updateScreenFrom(back, fallbackNotice(fallback));
    }
    const refusal = serviceRefusalOf(e);
    if (!refusal) return undefined;
    markOnline();
    // Never the failure screen (service-refusals "never opens the failure screen"): the page the
    // words were sent from. A refusal that opens a screen of its own goes there, with Describe (the
    // typed prompt intact) to come back to.
    logServiceRefusal(request, refusal);
    return refusalScreen(refusal, back, { kind: 'resume', screen: back }) ?? { ...back, notice: noticeFrom(refusal) };
  };

  /** Asks the clarify questions for `plan` (its page is already showing, loading), then — at once, with
   *  every question delegated — has the plan written. A clarify `502` means "no questions", not a dead
   *  end (`isClarifySkip`). */
  const askQuestions = async (plan: PlanScreen) => {
    const options = resolveClientOptions();
    if (!options) return;
    const markOnline = onlineForRequest(options);
    const requestFailed = failureForRequest(options);
    const request = flowRequests.start('compose');
    let questions: FlowQuestion[] = [];
    let limit: FlowLimit | undefined;
    try {
      const response = await clarifyPrompt(
        options,
        plan.text,
        // The same context a rewrite would carry (name, collections, description) — so the
        // clarifier never re-asks what kind of app it is talking to. `aboutFor`, not a copy on the
        // screen — see `aboutRef`'s doc comment.
        buildRewriteAppContext(plan.editing, aboutFor(plan.editing)),
        request.controller.signal,
      );
      questions = acceptClarifyQuestions(response.questions);
      limit = clarifyLimitOf(response);
      // A resolved `clarifyPrompt` is a real server response — proof of connectivity equivalent
      // to a successful dedicated probe (spec "A real generation or rewrite call succeeding...").
      markOnline();
    } catch (e) {
      // The sheet was left while this was in flight: the abort surfaces here as a plain
      // `AbortError`, and it is swallowed — no failure, no breadcrumb.
      if (request.cancelled) return;
      requestFailed(e);
      const landing = refusalLandingOf(plan, 'clarify', e, markOnline);
      if (landing) {
        setScreen(onlyOnStep<Screen, 'plan'>('plan', () => landing));
        return;
      }
      if (!isClarifySkip(e)) {
        setScreen(onlyOnStep<Screen, 'plan'>('plan', planProblem('clarify', e)));
        return;
      }
    } finally {
      flowRequests.release('compose', request);
    }
    if (request.cancelled) return;
    if (limit) {
      // Clarify says this can't be made as asked (beta-1 D9): the page shows why and what could be
      // made instead, and nothing more happens until the person picks one.
      const shown = limit;
      setScreen(onlyOnStep<Screen, 'plan'>('plan', (s) => withLimit(s, shown)));
      return;
    }
    const asked = withQuestions(plan, questions);
    setScreen(onlyOnStep<Screen, 'plan'>('plan', (s) => withQuestions(s, questions)));
    await writePlan(asked);
  };

  /** Has the plan written: the rewrite goes out at once with every question delegated (`decide:
   *  true`), whatever the person has answered meanwhile — the plan's rows must not depend on, or
   *  restate, an answer; the answers travel on to making as `clarifications`. */
  const writePlan = async (plan: PlanScreen) => {
    const options = resolveClientOptions();
    if (!options) return;
    const markOnline = onlineForRequest(options);
    const requestFailed = failureForRequest(options);
    const request = flowRequests.start('plan');
    try {
      const response = await rewritePrompt(
        options,
        plan.text,
        clarificationsFrom(plan.questions, delegatedAnswers(plan.questions)),
        // A change tells the rewrite which app it is changing, and what it currently is; making a
        // new app sends neither. `aboutFor`, not a copy on the screen — the description can still
        // resolve after the person has already moved past Describe (the "about" race).
        buildRewriteAppContext(plan.editing, aboutFor(plan.editing)),
        request.controller.signal,
      );
      markOnline();
      if (request.cancelled) return;
      setScreen(onlyOnStep<Screen, 'plan'>('plan', (s) => withPlan(s, response)));
    } catch (e) {
      // A request the user walked away from fails as an abort: no failure, no breadcrumb.
      if (request.cancelled) return;
      requestFailed(e);
      const landing = refusalLandingOf(plan, 'rewrite', e, markOnline);
      setScreen(onlyOnStep<Screen, 'plan'>('plan', landing ? () => landing : planProblem('rewrite', e)));
    } finally {
      flowRequests.release('plan', request);
    }
  };

  /** Sends the request a restored or retried plan page is missing: the clarify exchange (which then
   *  has the plan written), or just the plan. A page with nothing missing sends nothing. */
  const resumePlan = (plan: PlanScreen, request: 'clarify' | 'rewrite' | null = missingRequest(plan)) => {
    const missing = request;
    if (missing === null) return;
    const loading = retrying(plan, missing);
    setScreen(onlyOnStep<Screen, 'plan'>('plan', () => loading));
    if (missing === 'clarify') askQuestions(loading).catch((e) => logGenError('clarify continuation failed', e));
    else writePlan(loading).catch((e) => logGenError('rewrite continuation failed', e));
  };

  /** Describe's Continue: back to the plan page this one was reached back from while the words are
   *  unchanged, otherwise the plan page opens IMMEDIATELY, under its own loading state — the wait is
   *  that page, never a grey Continue — and the one clarify request that fills it in goes out
   *  straight after. */
  const onDescribeContinue = async (from: DescribeScreen) => {
    if (!resolveClientOptions() || !firstTake(from)) return;
    if (from.kept) {
      setScreen(from.kept);
      resumePlan(from.kept);
      return;
    }
    const plan = planStep(from);
    setScreen(plan);
    await askQuestions(plan);
  };

  /** A settling attempt releases ONLY the refs that still point at ITSELF. Two attempts can
   *  overlap — closing the sheet on one and then a Retry or a new build — and the newer one has
   *  already overwritten both refs. Clearing the older attempt's way would strand the newer one:
   *  unstoppable (Stop on its page would see no live run) and with its `building` ghost tapping into
   *  the "no live run to reattach to" branch forever. */
  const releaseGenRef = (ctl: NonNullable<typeof genRef.current>) => {
    if (genRef.current === ctl) genRef.current = null;
  };
  const releaseLiveRef = (lease: PendingAttemptLease) => {
    if (liveAttemptsRef.get(lease.id)?.lease === lease) liveAttemptsRef.delete(lease.id);
    if (liveRef.current?.lease === lease) liveRef.current = null;
  };
  const whenLiveAttemptOwns = (lease: PendingAttemptLease, complete: (selected: boolean) => void) => {
    if (liveAttemptsRef.get(lease.id)?.lease === lease) complete(liveRef.current?.lease === lease);
  };
  const whenDeliverySettles = (
    lease: PendingAttemptLease,
    delivered: InstalledApp | undefined,
    complete: (delivered: InstalledApp, selected: boolean) => void,
  ) => {
    if (delivered) whenLiveAttemptOwns(lease, (selected) => complete(delivered, selected));
  };
  const isSelectedLiveAttempt = (lease: PendingAttemptLease): boolean => liveRef.current?.lease === lease;
  const recordAttemptKeepalive = (attemptId: string, lease: PendingAttemptLease, signals: RunSignals): RunSignals | undefined => {
    if (!pending.isCurrentAttempt(lease)) return undefined;
    const currentLive = liveAttemptsRef.get(attemptId);
    if (currentLive?.lease !== lease) return undefined;
    const nextSignals = withKeepalive(signals, Date.now());
    currentLive.signals = nextSignals;
    if (isSelectedLiveAttempt(lease)) signalsRef.current = nextSignals;
    return nextSignals;
  };
  const recordAttemptFrame = (
    attemptId: string,
    lease: PendingAttemptLease,
    signals: RunSignals,
    counts: EventCounts,
    event: GenerationEvent,
  ): RunSignals | undefined => {
    if (!pending.isCurrentAttempt(lease)) return undefined;
    const currentLive = liveAttemptsRef.get(attemptId);
    if (currentLive?.lease !== lease) return undefined;
    countEvent(counts, event);
    const at = Date.now();
    const nextSignals = journalStreamEvent(journal, attemptId, signals, event, at);
    currentLive.signals = nextSignals;
    const selected = isSelectedLiveAttempt(lease);
    if (selected) signalsRef.current = nextSignals;
    const nextScreen = withStreamEvent(currentLive.screen, event, at);
    if (nextScreen !== currentLive.screen) {
      currentLive.screen = nextScreen;
      if (selected) setScreen((previous) => (previous.kind === 'making' ? withStreamEvent(previous, event, at) : previous));
    }
    return nextSignals;
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
    terms: FailureTerms = {},
    retrySnapshot?: AttemptSnapshot,
    lease?: PendingAttemptLease,
  ): TerminalSettlement => {
    if (lease && !pending.isCurrentAttempt(lease)) return 'unresolved';
    if (lease) releaseLiveRef(lease);
    const { remedy, cause } = terms;
    // `observed` is the end-of-stream flush: the final cumulative counts (closing the last throttle
    // window, which no aggregate entry can) and how many `diagnostic` events went past. Only the
    // loop that watched the stream can supply them, so they are threaded in rather than re-derived.
    try {
      // A retry that ended before anything of it was journaled (the request never reached the
      // server, or was refused) erases nothing: the earlier run's journal comes back and the retry's
      // ending is added to it, without counts of its own, so its timeline still reads (and the
      // missing counts tell `endingRepairAttempts` the earlier run's repairs are not this ending's).
      const keepsEarlierRun = keepEarlierRun(id, retrySnapshot);
      journal.appendTerminal(id, { failure: { reason, diagnostics }, ...(keepsEarlierRun ? {} : observed) });
      pending.setFailed(id, {
        reason,
        ...(diagnostics.length > 0 ? { diagnostics: diagnostics.map((diagnostic) => diagnostic.hint).join('\n') } : {}),
        ...(remedy ? { remedy } : {}),
        ...(cause ? { cause } : {}),
      }, 'verified');
      const saved = pending.get(id);
      if (saved?.state !== 'failed' || saved.failure?.reason !== reason || saved.journalUnavailable === true) {
        throw new Error('terminal pending record did not verify');
      }
      refresh();
      if (lease) pending.releaseAttempt(lease);
      return 'persisted';
    } catch (persistenceError) {
      log.warn(CHANNELS.gen, 'terminal attempt state did not persist', {
        operation: 'settle-failed-attempt',
        thrown: persistenceError instanceof Error ? 'error' : 'non-error',
      });
      return retrySnapshot
        ? recoverRetryAfterTerminalPersistenceFailure(id, retrySnapshot, observed, remedy, lease)
        : persistGenericTerminalFailure(id, observed, remedy, lease);
    }
  };

  /** Stop, from the Making page or a tile being made (`prompt-flow` "Stop SHALL end the run at once
   *  and leave a stopped tile"): the request is aborted at once and the attempt stays on Home as a
   *  stopped tile, with its journal, to try again or discard. A change has no tile of its own: its
   *  app simply stays as it was, so a stopped change leaves nothing behind. Never reached from back
   *  or from closing the sheet, which leave the run going.
   *
   *  Delivery wins: once the stream has ended with a result and the install is under way, Stop does
   *  nothing (returns false). Stopping then would leave the installed app AND a stopped record under
   *  the same id, and a Try again on that record would write into the delivered app. */
  const stopLiveAttempt = (live: LiveAttempt): boolean => {
    if (live.screen.delivering) return false;
    live.ctl.cancelled = true;
    live.ctl.controller.abort();
    releaseGenRef(live.ctl);
    releaseLiveRef(live.lease);
    const record = pending.get(live.id);
    if (record?.editingAppId != null) {
      dropStoppedChange(live, record);
    } else {
      try {
        pending.stop(live.id);
        pending.releaseAttempt(live.lease);
      } catch (error) {
        log.warn(CHANNELS.gen, 'stopped attempt did not persist', { operation: 'stop-attempt', ...errorFields(error) });
        dropAttempt(live.id);
      }
      keepEarlierRunOnStop(live);
    }
    refresh();
    return true;
  };

  /** A stopped change leaves nothing behind. When storage keeps its record or journal anyway, the run
   *  still ends: its lease goes (the next change of the app starts), its record is settled stopped (so
   *  nothing shows it being made) and its leftovers are purged as a Discard's are. */
  const dropStoppedChange = (live: LiveAttempt, record: PendingBuildRecord) => {
    try {
      dropAttempt(live.id);
    } catch (error) {
      log.warn(CHANNELS.gen, 'stopped change could not be removed', { operation: 'stop-change', ...errorFields(error) });
    }
    pending.releaseAttempt(live.lease);
    if (!purgeLeftover(record)) return;
    try {
      pending.stop(live.id);
    } catch (error) {
      log.warn(CHANNELS.gen, 'stopped change could not be settled', { operation: 'stop-change', ...errorFields(error) });
    }
  };

  /** A run storage would not fully remove (a removal that threw, or said it removed and did not): its
   *  purge is armed as a Discard arms one, so nothing shows the run from now on and the next launch
   *  removes what is left (`completeInterruptedPurges`, which spares a later run of the same id).
   *  Whether anything was left. */
  const purgeLeftover = (run: PendingBuildRecord): boolean => {
    if (pending.get(run.id) == null && journal.get(run.id) == null) return false;
    try {
      purges.armAttempt(run);
    } catch (error) {
      log.warn(CHANNELS.gen, 'leftover attempt purge could not be armed', { operation: 'purge-leftover', ...errorFields(error) });
    }
    return true;
  };

  /** A Try again stopped before it journaled anything keeps the earlier run's "What happened", as a
   *  retry that ended that way does (`keepEarlierRun`). One that cannot come back leaves the stopped
   *  tile with its journal marked unavailable, never a borrowed one. */
  const keepEarlierRunOnStop = (live: LiveAttempt) => {
    if (pending.get(live.id)?.stopped !== true) return;
    try {
      if (keepEarlierRun(live.id, live.retrySnapshot)) pending.setJournalAvailability(live.id, 'verified');
    } catch (error) {
      log.warn(CHANNELS.gen, 'earlier run did not come back after a stop', { operation: 'keep-earlier-run', ...errorFields(error) });
    }
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
    retrySnapshot?: AttemptSnapshot;
    lease: PendingAttemptLease;
    /** Set when rewording can't get past the ending: a stream cut partway. */
    remedy?: PendingFailureRemedy;
    /** Set for a stream cut partway. */
    cause?: PendingFailureCause;
  }) => {
    const selected = isSelectedLiveAttempt(input.lease);
    const settlement = settleFailed(
      input.attemptId,
      input.reason,
      input.hints,
      input.counts,
      { remedy: input.remedy, cause: input.cause },
      input.retrySnapshot,
      input.lease,
    );
    const terminalPersisted = settlement === 'persisted';
    const genericRecordPersisted = settlement === 'generic-pair' || settlement === 'generic-record';
    const genericJournalPersisted = settlement === 'generic-pair';
    const retainedVolatile = settlement === 'retained';
    const failureReason = terminalPersisted ? input.reason : GENERIC_STREAM_ERROR;
    const failureHints = terminalPersisted ? input.hints : [];
    if (!selected) return;
    setScreen({
      kind: 'failure',
      editing: input.editing,
      prompt: input.prompt,
      reason: failureReason,
      diagnostics: failureHints,
      // A persistence failure cannot claim this retry's terminal payload exists. If restoration
      // brought back the prior record, it remains available from its ghost after Back.
      ...((terminalPersisted || genericRecordPersisted) ? { recordId: input.attemptId } : {}),
      ...(retainedVolatile ? { pendingId: input.attemptId } : {}),
      ...((terminalPersisted || genericJournalPersisted) ? { journalId: input.attemptId } : {}),
      observedRepairAttempts: input.observed,
      // The app being edited already has a working version installed; a brand-new app has none.
      hasWorkingVersion: input.editing != null,
      // A terminal `failure` offers rephrasing; a stream cut partway never does (prompt-flow "A
      // dropped connection SHALL never suggest rewording").
      rephraseHelps: input.remedy == null,
      ...(terminalPersisted && input.cause ? { cause: input.cause } : {}),
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
  const showUnpersistedGenerateRefusal = (
    settlement: TerminalSettlement,
    attemptId: string,
    detached: boolean,
    selected: boolean,
    editing: InstalledApp | undefined,
    prompt: string,
    observedRepairAttempts: number,
  ) => {
    if (detached || !selected) return;
    const ids = genericSettlementIds(settlement, attemptId);
    setScreen(genericAttemptFailure(
      editing,
      prompt,
      'refused generation state was not persisted',
      observedRepairAttempts,
      ids.recordId,
      ids.journalId,
      ids.pendingId,
    ));
  };

  type GenerateSettlementAttempt = {
    attemptId: string;
    isRetry: boolean;
    fromPlan?: PlanScreen;
    counts: RunTerminalCounts;
    streamRequestId?: string;
    retrySnapshot?: AttemptSnapshot;
    editing: InstalledApp | undefined;
    prompt: string;
    observedRepairAttempts: number;
    lease: PendingAttemptLease;
  };

  const handleGenerateRefusal = (
    refusal: ServiceRefusal,
    ctl: NonNullable<typeof genRef.current>,
    attempt: GenerateSettlementAttempt,
  ): void => {
    const {
      attemptId,
      isRetry,
      fromPlan,
      counts,
      retrySnapshot,
      editing,
      prompt,
      observedRepairAttempts,
      lease,
    } = attempt;
    const detached = ctl.detached;
    const selected = isSelectedLiveAttempt(lease);
    logServiceRefusal('generate', refusal);
    const notice = noticeFrom(refusal);
    const outcome = refusedGenerateOutcome(isRetry, detached);
    if (outcome === 'drop') {
      if (!pending.isCurrentAttempt(lease)) return;
      releaseLiveRef(lease);
      dropAttempt(attemptId);
      refresh();
      if (selected && fromPlan) {
        const back: PlanScreen = { ...fromPlan, notice: undefined };
        const target = refusalScreen(refusal, back, { kind: 'resume', screen: back }) ?? { ...fromPlan, notice };
        setScreen(onlyOnStep<Screen, 'making'>('making', () => target));
      }
      return;
    }
    const settlement = settleFailed(
      attemptId,
      refusalText(refusal),
      [],
      counts,
      { remedy: refusalRemedy(refusal) },
      retrySnapshot,
      lease,
    );
    if (settlement !== 'persisted') {
      showUnpersistedGenerateRefusal(settlement, attemptId, detached, selected, editing, prompt, observedRepairAttempts);
      return;
    }
    if (selected && detached && REFUSAL_RULES[refusal.code].opens === 'update') {
      setScreen((prev) => (updateMayInterrupt(prev) ? updateScreenFrom(prev) : prev));
      return;
    }
    if (!isRetry || !selected) return;
    const updated = pending.get(attemptId);
    if (updated) {
      const back = failureFromRecord(updated);
      const target = refusalScreen(refusal, back, { kind: 'retry', record: updated }) ?? { ...back, notice };
      setScreen(onlyOnStep<Screen, 'making'>('making', () => target));
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
    attempt: GenerateSettlementAttempt,
    markOnline: () => void,
  ): boolean => {
    const fallback = terminalFallbackOf(e);
    if (fallback?.kind === 'update') {
      const selected = isSelectedLiveAttempt(attempt.lease);
      markOnline();
      releaseGenRef(ctl);
      logUpdateFallback('generate', e, attempt.streamRequestId);
      const notice = fallbackNotice(fallback);
      const detached = ctl.detached;
      const settlement = settleFailed(attempt.attemptId, notice ?? COPY.updateRequiredLine, [], attempt.counts, {
        remedy: { kind: 'update', protocolLevel: PROTOCOL_LEVEL },
      }, attempt.retrySnapshot, attempt.lease);
      const ids = genericSettlementIds(settlement, attempt.attemptId);
      const genericFailure = settlement === 'persisted' ? undefined : genericAttemptFailure(
        attempt.editing,
        attempt.prompt,
        'update fallback state was not persisted',
        attempt.observedRepairAttempts,
        ids.recordId,
        ids.journalId,
        ids.pendingId,
      );
      if (selected) {
        setScreen((prev) => (!detached || updateMayInterrupt(prev)
          ? genericFailure ?? updateScreenFrom(prev, notice)
          : prev));
      }
      return true;
    }
    const refusal = serviceRefusalOf(e);
    if (!refusal) return false;
    markOnline();
    releaseGenRef(ctl);
    handleGenerateRefusal(refusal, ctl, attempt);
    return true;
  };

  const settleUnexpectedAttemptFailure = (input: {
    error: unknown;
    ctl: NonNullable<typeof genRef.current>;
    attemptId: string;
    isRetry: boolean;
    fromPlan: PlanScreen | undefined;
    terminalCounts: () => RunTerminalCounts;
    streamRequestId: string | undefined;
    markOnline: () => void;
    editing: InstalledApp | undefined;
    prompt: string;
    observedRepairAttempts: number;
    retrySnapshot: AttemptSnapshot | undefined;
    lease: PendingAttemptLease;
  }) => {
    if (input.ctl.cancelled || !pending.isCurrentAttempt(input.lease)) return;
    const selected = isSelectedLiveAttempt(input.lease);
    const attempt = {
      attemptId: input.attemptId,
      isRetry: input.isRetry,
      fromPlan: input.fromPlan,
      counts: input.terminalCounts(),
      streamRequestId: input.streamRequestId,
      retrySnapshot: input.retrySnapshot,
      lease: input.lease,
      editing: input.editing,
      prompt: input.prompt,
      observedRepairAttempts: input.observedRepairAttempts,
    };
    if (settleServerEnding(input.error, input.ctl, attempt, input.markOnline)) return;
    releaseGenRef(input.ctl);
    logGenError('build failed', input.error, input.streamRequestId);
    const reasoned = attemptErrorReason(input.error);
    const settlement = settleFailed(
      input.attemptId,
      reasoned.reason,
      reasoned.diagnostics,
      input.terminalCounts(),
      { remedy: attemptRemedy(input.error), ...attemptCause(input.error) },
      input.retrySnapshot,
      input.lease,
    );
    const terminalPersisted = settlement === 'persisted';
    const ids = genericSettlementIds(settlement, input.attemptId);
    if (selected) {
      setScreen(terminalPersisted
        ? failure(
          input.editing,
          input.prompt,
          input.error,
          'build failed',
          input.observedRepairAttempts,
          input.attemptId,
          input.streamRequestId,
        )
        : genericAttemptFailure(
          input.editing,
          input.prompt,
          'build failed',
          input.observedRepairAttempts,
          ids.recordId,
          ids.journalId,
          ids.pendingId,
        ));
    }
  };

  type AttemptSnapshot = { pending: string | null | undefined; journal: string | null | undefined };
  type TerminalSettlement = 'persisted' | 'generic-pair' | 'generic-record' | 'restored' | 'retained' | 'unresolved';

  const genericSettlementIds = (settlement: TerminalSettlement, id: string): { recordId?: string; journalId?: string; pendingId?: string } => {
    if (settlement === 'generic-pair') return { recordId: id, journalId: id };
    if (settlement === 'generic-record') return { recordId: id };
    return settlement === 'retained' ? { pendingId: id } : {};
  };

  const currentPendingIds = (): string[] => kv.getAllKeys()
    .flatMap((key) => key.startsWith('pending:') ? [key.slice('pending:'.length)] : []);

  const partialPendingIds = (known: ReadonlySet<string>): string[] => {
    try {
      return currentPendingIds().filter((id) => !known.has(id));
    } catch (readError) {
      log.warn(CHANNELS.gen, 'attempt setup recovery could not read pending records', {
        operation: 'find-partial-attempt',
        thrown: readError instanceof Error ? 'error' : 'non-error',
      });
      return [];
    }
  };

  const sameRaw = (key: string, expected: string | null | undefined): boolean =>
    expected == null ? kv.getString(key) == null : kv.getString(key) === expected;

  const writeRaw = (key: string, value: string | null | undefined): boolean => {
    try {
      if (value == null) kv.delete(key);
      else kv.set(key, value);
      return sameRaw(key, value);
    } catch (error) {
      log.warn(CHANNELS.gen, 'attempt snapshot write did not persist', {
        operation: 'restore-attempt-snapshot',
        thrown: error instanceof Error ? 'error' : 'non-error',
      });
      return false;
    }
  };

  const guardJournalAssociation = (id: string): boolean => {
    try {
      pending.setJournalAvailability(id, 'unavailable');
      return pending.get(id)?.journalUnavailable === true;
    } catch (error) {
      log.warn(CHANNELS.gen, 'journal association guard did not persist', {
        operation: 'guard-journal-association',
        thrown: error instanceof Error ? 'error' : 'non-error',
      });
      return false;
    }
  };

  /** The retry journaled nothing of its own, and the record it reused had a journal that was its
   *  verified report: one marked unavailable stays so, never borrowed back. */
  const retryLeftNoTrace = (id: string, previous: AttemptSnapshot): boolean => {
    if (previous.journal == null || previous.journal === '[]' || previous.pending == null) return false;
    try {
      const record = JSON.parse(previous.pending) as { journalUnavailable?: unknown };
      return record.journalUnavailable !== true && kv.getString(JOURNAL_KEY(id)) === '[]';
    } catch (error) {
      log.warn(CHANNELS.gen, 'earlier attempt record is unreadable', { operation: 'keep-earlier-run', ...errorFields(error) });
      return false;
    }
  };

  /** Whether the earlier run's journal is back under the attempt's id, under the association guard
   *  the settlement's verified write then clears; throws when it should be and is not. */
  const keepEarlierRun = (id: string, previous: AttemptSnapshot | undefined): boolean => {
    if (previous == null || !retryLeftNoTrace(id, previous)) return false;
    if (!(guardJournalAssociation(id) && writeRaw(JOURNAL_KEY(id), previous.journal))) throw new Error('earlier journal did not restore');
    return true;
  };

  /** A best-effort terminal fallback uses the established generic stream error, which is all a
   * storage-failed settlement can honestly persist. The journal and record are attempted and
   * verified independently. A readable record without a matching readable terminal report still
   * remains a truthful failed ghost; its timeline is withheld rather than borrowing stale data. */
  const persistGenericTerminalFailure = (
    id: string,
    observed: RunTerminalCounts,
    remedy?: PendingFailureRemedy,
    lease?: PendingAttemptLease,
  ): TerminalSettlement => {
    if (lease && !pending.isCurrentAttempt(lease)) return 'unresolved';
    let recordPersisted = false;
    try {
      pending.setFailed(id, {
        reason: GENERIC_STREAM_ERROR,
        ...(remedy ? { remedy } : {}),
      }, 'unavailable');
      const record = pending.get(id);
      recordPersisted = record?.state === 'failed'
        && record.failure?.reason === GENERIC_STREAM_ERROR
        && record.journalUnavailable === true;
    } catch (fallbackError) {
      log.warn(CHANNELS.gen, 'generic failed record did not persist', {
        operation: 'persist-generic-failed-record',
        thrown: fallbackError instanceof Error ? 'error' : 'non-error',
      });
    }
    refresh();
    if (recordPersisted) {
      if (lease) pending.releaseAttempt(lease);
      return 'generic-record';
    }
    if (lease && pending.retainFailed(lease, { reason: GENERIC_STREAM_ERROR, ...(remedy ? { remedy } : {}) })) {
      pending.releaseAttempt(lease);
      refresh();
      return 'retained';
    }
    refresh();
    return 'unresolved';
  };

  /** A retry can return to its exact old pair only when both siblings verified. If its old pending
   * record cannot return, the ended retry gets one independent generic terminal-record fallback;
   * a failed fallback is left unclaimed, because no persisted lifecycle state can then be proved. */
  const recoverRetryAfterTerminalPersistenceFailure = (
    id: string,
    previous: AttemptSnapshot,
    observed: RunTerminalCounts,
    remedy?: PendingFailureRemedy,
    lease?: PendingAttemptLease,
  ): TerminalSettlement => {
    if (lease && !pending.isCurrentAttempt(lease)) return 'unresolved';
    const journalKey = JOURNAL_KEY(id);
    const journalReady = sameRaw(journalKey, previous.journal) || guardJournalAssociation(id) && writeRaw(journalKey, previous.journal);
    if (journalReady && writeRaw(`pending:${id}`, previous.pending) && sameRaw(journalKey, previous.journal)) {
      refresh();
      if (lease) pending.releaseAttempt(lease);
      return 'restored';
    }
    return persistGenericTerminalFailure(id, observed, remedy, lease);
  };

  const recoverFailedSetup = (
    reuseId: string | undefined,
    attemptId: string | undefined,
    previous: AttemptSnapshot | undefined,
    knownPendingIds: ReadonlySet<string>,
  ) => {
    const restoredId = reuseId ?? attemptId;
    if (restoredId != null && reuseId != null && previous) {
      const journalReady = sameRaw(JOURNAL_KEY(restoredId), previous.journal)
        || guardJournalAssociation(restoredId) && writeRaw(JOURNAL_KEY(restoredId), previous.journal);
      if (journalReady && writeRaw(`pending:${restoredId}`, previous.pending) && sameRaw(JOURNAL_KEY(restoredId), previous.journal)) {
        refresh();
      } else {
        persistGenericTerminalFailure(restoredId, { aggregates: EMPTY_RUN_AGGREGATES, observedDiagnostics: 0 });
      }
      return;
    }
    for (const id of partialPendingIds(knownPendingIds)) {
      if (guardJournalAssociation(id)) writeRaw(JOURNAL_KEY(id), undefined);
      try {
        pending.delete(id);
      } catch (error) {
        log.warn(CHANNELS.gen, 'partial attempt cleanup did not persist', {
          operation: 'clean-partial-attempt',
          thrown: error instanceof Error ? 'error' : 'non-error',
        });
      }
    }
    refresh();
  };

  const beginPendingAttempt = (
    building: MakingScreen,
    editing: InstalledApp | undefined,
    reuseId: string | undefined,
    ctl: NonNullable<typeof genRef.current>,
  ): { id: string; lease: PendingAttemptLease; retrySnapshot?: AttemptSnapshot } | undefined => {
    let previous: AttemptSnapshot | undefined;
    let snapshotAvailable = false;
    let knownPendingIds: Set<string> | undefined;
    let attemptId: string | undefined;
    try {
      knownPendingIds = new Set(currentPendingIds());
      if (reuseId != null) previous = {
        pending: kv.getString(`pending:${reuseId}`),
        journal: kv.getString(JOURNAL_KEY(reuseId)),
      };
      snapshotAvailable = true;
      attemptId = startPendingBuild(pending, { editing, text: building.text, reuseId });
      if (pending.get(attemptId)?.journalUnavailable !== true) throw new Error('pending journal guard did not verify');
      // The journal is created at the SAME moment as the record it is a sibling of
      // (`generation-run-journal` "A run journal is created alongside its pending-build record"),
      // and the attempt's derived signals start from the same instant the request does.
      journal.create(attemptId);
      if (kv.getString(JOURNAL_KEY(attemptId)) !== '[]') throw new Error('empty journal did not verify');
      pending.setJournalAvailability(attemptId, 'verified');
      if (pending.get(attemptId)?.journalUnavailable === true) throw new Error('pending journal marker did not clear');
      const lease = pending.activateAttempt(attemptId);
      return { id: attemptId, lease, ...(reuseId != null ? { retrySnapshot: previous } : {}) };
    } catch (setupError) {
      if (setupError instanceof AttemptInFlight) {
        releaseGenRef(ctl);
        showRunInFlight(setupError.id, editing);
        return undefined;
      }
      log.warn(CHANNELS.gen, 'attempt setup failed', {
        operation: 'start-pending-build',
        thrown: setupError instanceof Error ? 'error' : 'non-error',
      });
      releaseGenRef(ctl);
      if (snapshotAvailable) recoverFailedSetup(reuseId, attemptId, previous, knownPendingIds!);
      setScreen(failure(editing, building.text, new Error(GENERIC_STREAM_ERROR), 'attempt setup failed'));
      return undefined;
    }
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
  /** The running app a change to `editing` is made under: the app runs under the sheet the change was
   *  sent from (the Whim sheet's plan, or its failed change's Try again). `null` for a new app, or a
   *  change made from Home or History. */
  const runningUnder = (editing: InstalledApp | undefined): AppScreen | null =>
    running !== null && running.app.id === editing?.id ? running : null;

  /** A started attempt takes over the screen with its Making page — unless it is a change made under
   *  its running app (`over`): then the sheet collapses into the orb, which follows the run, and the
   *  run never takes the screen (its ending is the orb's and a toast's; it starts detached). */
  const showStartedAttempt = (live: LiveAttempt, over: AppScreen | null) => {
    if (over !== null) {
      setScreen({ ...over, sheet: undefined });
      return;
    }
    liveRef.current = live;
    signalsRef.current = live.signals;
    setScreen(live.screen);
  };

  /** An attempt asked for an id whose run is still being made (`AttemptInFlight`): it never replaces
   *  that run, whose record, journal and stream stay its own. The run in progress shows instead, as
   *  Details on its tile would: the app it changes, when it runs under the sheet, else its Making page. */
  const showRunInFlight = (id: string, editing: InstalledApp | undefined) => {
    const over = runningUnder(editing);
    const live = liveAttemptsRef.get(id);
    if (over !== null) setScreen({ ...over, sheet: undefined });
    else if (live) reattach(live);
    else goHome();
  };

  const runAttempt = async (opening: MakingScreen, reuseId?: string, fromPlan?: PlanScreen) => {
    const options = resolveClientOptions();
    if (!options) return;
    const markOnline = onlineForRequest(options);
    const requestFailed = failureForRequest(options);

    const editing = opening.editing;
    const over = runningUnder(editing);
    const controller = new AbortController();
    const ctl = { controller, cancelled: false, detached: over !== null };
    genRef.current = ctl;
    // Declared outside the try so a throw mid-stream still knows what the device observed, and on
    // which request (the stream's `x-whim-request-id`, once it has opened).
    const counts: EventCounts = { stage: 0, token: 0, diagnostic: 0, repair: 0 };
    let stream: GenerationStream | undefined;

    // The id this attempt writes to, decided and persisted before the request exists: a new
    // install mints one, a rebuild's id IS the app it rebuilds, a retry reuses its record's.
    const startedAttempt = beginPendingAttempt(opening, editing, reuseId, ctl);
    if (startedAttempt == null) return;
    const { id: attemptId, lease, retrySnapshot } = startedAttempt;
    // The page opens as this run's: keyed by its own journal id from its first frame, so it never
    // shows another's and never remounts when the run gets its id.
    const startedAt = Date.now();
    const building: MakingScreen = { ...opening, runId: attemptId, stepSince: startedAt };
    let signals: RunSignals = {
      startedAt,
      aggregates: EMPTY_RUN_AGGREGATES,
      lastTokenAt: null,
      lastThinkingAt: null,
      lastFrameAt: startedAt,
    };
    const live: LiveAttempt = { id: attemptId, lease, screen: building, signals, ctl, retrySnapshot };
    liveAttemptsRef.set(attemptId, live);
    showStartedAttempt(live, over);
    // The keepalive comment frame (`: keepalive\n\n`, build-liveness B2) is transport noise, never
    // a `GenerationEvent` — it reaches here through `ClientOptions.onKeepalive`, not the stream
    // loop below, and moves ONLY the any-frame clock (`withKeepalive` never touches the journal).
    const onKeepalive = () => {
      signals = recordAttemptKeepalive(attemptId, lease, signals) ?? signals;
    };
    /** What the terminal entry flushes, read at the instant the stream ends: the final cumulative
     *  counts (the throttle's last window has no later arrival to close it) and the diagnostics
     *  tally. Numbers only — the same redaction rule every journal entry lives under. */
    const terminalCounts = (): RunTerminalCounts => ({
      aggregates: signals.aggregates,
      observedDiagnostics: counts.diagnostic,
    });
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
        const nextSignals = recordAttemptFrame(attemptId, lease, signals, counts, event);
        if (!nextSignals) return;
        signals = nextSignals;
        if (event.type === 'result' || event.type === 'failure') terminal = event;
      }
      // The stream loop completed without throwing a transport-classified error — a real server
      // response, proof of connectivity equivalent to a successful dedicated probe (spec "A real
      // generation or rewrite call succeeding...").
      if (!pending.isCurrentAttempt(lease)) return;
      markOnline();

      if (ctl.cancelled) return; // an explicit Stop (stopLiveAttempt) already settled the record
      releaseGenRef(ctl);

      if (terminal == null) {
        // Stream ended with no terminal event and no cancel: the connection was cut partway (a
        // server always ends a run it still serves with one), not a crash and not the words.
        log.error(CHANNELS.gen, 'stream ended with no terminal event', { ...counts, requestId: stream.requestId });
        logGenFailureShown({
          stage: 'stream ended with no terminal event',
          reasonCode: 'no_terminal_event',
          reason: COPY.failureConnection,
          observedRepairAttempts: counts.repair,
          failureClass: 'StreamEndedWithoutTerminalEvent',
          streamRequestId: stream.requestId,
        });
        showStreamFailure({
          attemptId,
          editing,
          prompt: building.text,
          reason: COPY.failureConnection,
          remedy: { kind: 'retry' },
          cause: 'connection',
          hints: [],
          observed: counts.repair,
          counts: terminalCounts(),
          retrySnapshot,
          lease,
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
          retrySnapshot,
          lease,
        });
        return;
      }

      // The stream ended with a deliverable result: the terminal entry is written HERE, at the end
      // of the stream and before delivery starts, carrying no failure field.
      if (!pending.isCurrentAttempt(lease)) return;
      const currentLive = liveAttemptsRef.get(attemptId);
      if (currentLive?.lease !== lease) return;
      journal.appendTerminal(attemptId, terminalCounts());
      const deliveringAt = Date.now();
      currentLive.screen = withDelivering(currentLive.screen, deliveringAt);
      if (liveRef.current?.lease === lease) {
        setScreen((s) => (s.kind === 'making' ? withDelivering(s, deliveringAt) : s));
      }
      // Store first, index second, pending record deleted LAST (design D5) — a process death
      // anywhere inside this await leaves the record behind to surface as `interrupted`.
      const run = pending.get(attemptId);
      const delivered = await deliverAndSettleIfOwned(pending, {
        access,
        appId: attemptId,
        editing,
        text: building.text,
        wire: terminal.app,
        summary: terminal.summary,
      }, () => pending.isCurrentAttempt(lease));
      // Delivery landed: the attempt's journal becomes the delivered app's retained last-run
      // report, under the id the app NOW has (a behind-tip rebuild delivers onto a fork, whose id
      // is not the attempt's). After the delivery, never before it — a death in between loses the
      // report and nothing else (design D5).
      // The delivery stands even when storage keeps the run's record or journal: those are purged.
      whenDeliverySettles(lease, delivered, (installed, selected) => {
        try {
          journal.moveToLastRun(attemptId, installed.id);
        } catch (error) {
          log.warn(CHANNELS.gen, 'delivered run journal could not be moved', { operation: 'move-last-run', ...errorFields(error) });
        }
        pending.releaseAttempt(lease);
        releaseLiveRef(lease);
        if (run !== null) purgeLeftover(run);
        refresh();
        if (selected && !ctl.detached) {
          setScreen((s) => (s.kind === 'making' ? readyStep(s, installed) : s));
          return;
        }
        // A change that lands while its app runs reloads nothing: the toast, the orb's dot and the
        // Whim sheet's row offer Reload. The app is the one the change was sent for (`editing`): sent
        // from behind its tip, the change lands on a continuation (`installed`), which Reload opens.
        // Another app finishing over it marks the orb with the same dot.
        const open = runningRef.current;
        if (open !== null && (open.app.id === installed.id || open.app.id === editing?.id)) {
          changeLanded(open, installed);
          return;
        }
        if (open !== null) {
          setFinished({ appId: open.app.id, at: open.tappedAt });
          return;
        }
        // Delivered with the sheet closed: Home says so, and opens it from the toast.
        if (screenKindRef.current === 'home') {
          toastRef.current?.show({ message: readyTitle(installed.name), action: { label: COPY.actionOpen, onPress: () => onOpen(installed) } });
        }
      });
    } catch (error) {
      requestFailed(error, ctl.cancelled);
      settleUnexpectedAttemptFailure({
        error,
        ctl,
        attemptId,
        isRetry: reuseId !== undefined,
        fromPlan,
        terminalCounts,
        streamRequestId: stream?.requestId,
        markOnline,
        editing,
        prompt: building.text,
        observedRepairAttempts: counts.repair,
        retrySnapshot,
        lease,
      });
    }
  };

  /** The approval gate's action — the first moment a generation request is sent. The draft is
   *  spent: the words are now a run, and the composer stops offering to continue them. A tap that
   *  cannot send (no current options) takes nothing, so the page's `Make it` is there for the next. */
  const onBuildIt = async (from: PlanScreen) => {
    if (!resolveClientOptions() || !firstTake(from)) return;
    drafts.clear(draftKey(from));
    syncComposerDraft();
    await runAttempt(makingStep(from), undefined, from);
  };

  /** The Making page is left with its run going: the run stops taking over the screen. The page's
   *  own run is detached as well as `genRef`'s, since once its stream ended it is no longer
   *  `genRef`'s, and a delivery still under way must then say it is ready on Home rather than land
   *  on a page that is gone. */
  const detachSelectedRun = () => {
    for (const ctl of [genRef.current, liveRef.current?.ctl]) {
      if (ctl) ctl.detached = true;
    }
  };

  /** Closing the sheet on Making: back to the shell WITHOUT cancelling — the run finishes and its
   *  result is still delivered, it just no longer takes over the screen. Its record stays `building`, so
   *  the grid keeps showing the ghost for as long as the stream is in flight. */
  const onLeaveRunning = () => {
    detachSelectedRun();
    goHome();
  };

  /** Stop on the Making page, in line or making: the run ends at once, its stopped tile stays on
   *  Home, and the sheet closes onto it. Once delivery started the page shows no Stop, and a tap
   *  that still arrives leaves the page as it is, so the delivery lands on Ready. */
  const onStopMaking = () => {
    const live = liveRef.current;
    if (live && !stopLiveAttempt(live)) return;
    goHome();
  };

  /** The limit page's `Make that instead` (beta-1 D9): the alternative becomes the prompt and clarify
   *  is asked about it afresh — its own questions, never the old ones. Nothing is made until the
   *  person approves a plan, as always. */
  const onBuildInstead = async (from: PlanScreen) => {
    if (!from.limit) return;
    await onDescribeContinue(describeStep(from.editing, from.limit.alternative));
  };

  /** "Try again" on a plan page that could not reach the server: sends the request it was missing. */
  const onPlanTryAgain = (from: PlanScreen) => {
    if (from.problem) resumePlan(from, from.problem.request);
  };

  // ── Ghost-tile handlers (design D7) ────────────────────────────────────────────────────────
  // The grid's four entry points into a pending-build record. Chain-3's tiles bind them;
  // `handoff/ghost-handlers.md` is their contract.

  /** The failure page for a `failed`/`interrupted` record, hydrated from what was PERSISTED — no
   *  live stream is involved, so the repair tries are the ones its verified journal recorded, never
   *  invented, and an `interrupted` record (which never carried a payload, because nothing failed)
   *  says whether Whim closed under it or the person stopped it. */
  /** The repair tries of the ending a record shows. A retry that journaled nothing of its own ends the
   *  earlier run's restored journal with a terminal that carries no counts (`keepEarlierRun`): that
   *  ending tried no repairs, whatever the earlier run's were. */
  const endingRepairAttempts = (entries: readonly RunJournalEntry[]): number => {
    const ending = entries.filter((entry) => entry.kind === 'terminal').at(-1);
    return ending != null && ending.aggregates == null ? 0 : repairAttemptsIn(entries);
  };

  const failureFromRecord = (rec: PendingBuildRecord): Screen => {
    const view = pending.readCurrent(rec.id);
    const current = view?.record ?? rec;
    const edited = current.editingAppId ? index.get(current.editingAppId) : null;
    const journalReadable = view?.durability !== 'volatile' && current.journalUnavailable !== true;
    const interrupted = current.state === 'interrupted' ? { interrupted: current.stopped ? 'stopped' as const : 'closed' as const } : {};
    const cause = failureCauseOf(current.failure);
    return {
      kind: 'failure',
      ...(edited ? { editing: edited } : {}),
      prompt: current.prompt,
      reason: current.failure?.reason ?? COPY.interruptedBuildReason,
      diagnostics: hydratedDiagnostics(current.failure),
      observedRepairAttempts: journalReadable ? endingRepairAttempts(journal.get(current.id) ?? []) : 0,
      hasWorkingVersion: edited != null,
      // A record that names a remedy is one rewording can't get past (`PendingFailureRemedy`), and
      // neither is an interruption (no failure payload, as `reason` reads it): the app closed, the
      // request was never the problem.
      rephraseHelps: current.failure != null && current.failure.remedy == null,
      pendingId: current.id,
      ...interrupted,
      ...(cause ? { cause } : {}),
      ...(stillNeedsUpdate(current, PROTOCOL_LEVEL) ? { needsUpdate: true as const } : {}),
      ...(journalReadable ? { journalId: current.id } : {}),
    };
  };

  /** Tap a ghost. `building` reattaches to the run's own build-progress screen — the stream is
   *  still in this shell's closure, so this is a screen-state change and no new request is sent;
   *  reattaching also un-detaches it, so its done step lands as if the user had never left.
   *  `failed`/`interrupted` opens the hydrated failure screen instead, a record an `update` fallback
   *  ended among them: while this build still needs that update, its page reads "needs a newer Whim". */
  const onOpenPending = (rec: PendingBuildRecord) => {
    const current = pending.readCurrent(rec.id)?.record ?? rec;
    if (current.state !== 'building') {
      setScreen(failureFromRecord(current));
      return;
    }
    const live = liveAttemptsRef.get(current.id);
    if (!live) {
      log.warn(CHANNELS.gen, 'building ghost has no live run to reattach to', { pendingId: current.id });
      return;
    }
    reattach(live);
  };

  /** A live run's own Making page again, un-detached, so its ending lands as if it was never left. */
  const reattach = (live: LiveAttempt) => {
    liveRef.current = live;
    genRef.current = live.ctl;
    live.ctl.detached = false;
    signalsRef.current = live.signals;
    setScreen(live.screen);
  };

  /** Stop from a tile being made: `stopLiveAttempt`, without taking the person off the grid (and
   *  nothing at all once its delivery started). A `building` record with no run left in this
   *  process has nothing to stop and is dropped. */
  const onCancelPending = (rec: PendingBuildRecord) => {
    const current = pending.readCurrent(rec.id)?.record ?? rec;
    const live = liveAttemptsRef.get(current.id);
    if (live) {
      stopLiveAttempt(live);
      return;
    }
    dropAttempt(current.id);
    refresh();
  };

  /** Discard on a Failure page: the page closes, onto Home or onto the running app it was over, and the
   *  attempt goes the way Home's Discard sends it (`soft-delete.ts`), hidden at once and purged, record
   *  and journal, when the "Discarded" toast's 6 s Undo ends. A discard that cannot be armed changes
   *  nothing: the page stays. */
  const onDiscardFromFailure = (rec: PendingBuildRecord) => {
    try {
      onDiscard([rec]);
    } catch (error) {
      log.warn(CHANNELS.gen, 'discard could not be armed', { operation: 'discard-pending', ...errorFields(error) });
      return;
    }
    if (running === null) goHome();
    else setScreen(running);
    haptics.play('warning');
    toastRef.current?.show({
      message: COPY.discardedToast,
      action: {
        label: COPY.toastUndo,
        onPress: () => {
          if (!onUndoDiscard([rec])) toastRef.current?.show({ message: COPY.undoTooLateToast });
        },
      },
      onEnd: () => onSettleDiscard([rec]),
    });
  };

  /** Retry from a hydrated failure screen: a NEW generation from the record's stored prompt,
   *  reusing the same launcher id, so the ghost the user is looking at is the one that resolves. */
  const onRetryPending = (rec: PendingBuildRecord) => {
    const current = pending.readCurrent(rec.id)?.record ?? rec;
    const edited = current.editingAppId ? index.get(current.editingAppId) : null;
    runAttempt(retryBuildScreen(current, edited ?? undefined), current.id).catch((error) => {
      logGenError('retry continuation failed', error);
      setScreen(failure(
        edited ?? undefined,
        current.prompt,
        new Error(GENERIC_STREAM_ERROR),
        'retry continuation failed',
      ));
    });
  };

  /** The side effect of an arriving link's safe exit (design D15; spec app-links "An arriving link
   *  leaves the current screen through that screen's own safe exit") — no screen assignment; the
   *  caller (`openAppLink`) sets the resolved target right after. Cancelling whatever compose/plan
   *  request the CURRENT screen owns applies unconditionally (a no-op off those two steps), the
   *  same way `goHome` always does it. `'leave-build'` additionally detaches the live attempt so it
   *  keeps streaming (exactly `onLeaveRunning`, without ALSO navigating home first — the caller is
   *  about to navigate somewhere more specific). */
  const leaveForLink = (exit: LinkExit) => {
    keepDraft(screen);
    aboutRef.current = null;
    if (exit === 'leave-build') detachSelectedRun();
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
    if (stackPop.current !== null) {
      // History's pop to Home runs: the link lands once it has finished, from wherever the shell is then.
      stackPopOver()
        .then((go) => {
          if (go) openAppLinkRef.current(id);
        })
        .catch(() => undefined);
      return;
    }
    if (screen.kind === 'app' && screen.app.id === id) return;
    const resolution = resolveAppLink(id, reachableApps(), reachableAttempts());
    leaveForLink(linkExitFor(screen.kind));
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
    () => (screen.kind === 'failure' && screen.journalId != null
      ? journal.get(screen.journalId)
      : null),
    [screen, journal],
  );

  /**
   * The failure page's actions. "Change the description" is always there: the describe page with
   * the words kept. Try again re-runs the attempt the page is about, from its record — a hydrated
   * ghost's (`pendingId`) or the one a live failure already settled (`recordId`, every ending that
   * went through `settleFailed`) — and is absent when there is none (a setup that failed before any
   * record existed). Try again is a data-sending action (spec ai-data-consent "The first action that
   * would send data asks for consent at that moment"), gated like the other entry points through
   * `openWithConsent`. Discard is offered ONLY when there is an attempt to discard, and goes through
   * `onDiscardFromFailure`, the purge window Home's Discard uses, so record and journal die together
   * in the shell's single deletion path (`completePurge`).
   * Leaving is the sheet's close, which leaves the attempt as it is.
   */
  const failureActions = (s: Extract<Screen, { kind: 'failure' }>) => {
    const ghost = s.pendingId != null ? pending.readCurrent(s.pendingId)?.record ?? null : null;
    const settled = s.recordId != null ? pending.readCurrent(s.recordId)?.record ?? null : null;
    const attempt = ghost ?? settled;
    return {
      onChange: () => openCompose(s.editing, s.prompt),
      ...(attempt != null
        ? { onRetry: () => openWithConsent({ kind: 'retry', record: attempt }), onDismiss: () => onDiscardFromFailure(attempt) }
        : {}),
    };
  };

  /** Home's developer-probe entry, offered only where the dev log tools are. Decided here rather than
   *  inside `renderScreenContent`, whose complexity budget goes to the screen kinds. */
  const onOpenDevProbe = devLogOverlayEnabled(__DEV__) ? () => setScreen({ kind: 'dev' }) : undefined;

  /** The ready-gated screen switch, pulled out of `LauncherShell`'s own body (a nested
   *  closure sonarjs's cognitive-complexity rule assesses separately) purely to keep the
   *  count of `Screen` kinds this shell can render from ever competing with `LauncherShell`'s
   *  own control flow for the same budget — adding a `Screen` member costs this function one
   *  branch, never the other. */
  const renderScreenContent = (): React.ReactNode => {
    if (screen.kind === 'dev') {
      return <DevProbeScreen onExit={goHome} />;
    } else if (screen.kind === 'age' && screen.held !== undefined) {
      const { returnTo } = screen;
      return (
        <AgeScreen
          language={legalLanguage}
          onLanguageChange={onLegalLanguageChange}
          held={screen.held}
          onClose={() => onLegalDecline(returnTo)}
        />
      );
    } else if (screen.kind === 'link-missing') {
      return <AppLinkMissingScreen onBackToApps={goHome} />;
    } else if (screen.kind === 'update-required') {
      const held = screen.heldPrompt;
      return <UpdateRequiredScreen notice={screen.updateNotice} onNotNow={() => onUpdateNotNow(held)} />;
    }
    return null;
  };

  // ── The Whim sheet over a running app (app-launcher "The Whim sheet is a running app's one menu") ──

  /** Reads, for the Whim sheet opened over `on`, the version it runs and whether a newer one is current.
   *  Until the running version's id is known, the current one is taken as running. */
  const readWhimVersions = (on: AppScreen) => {
    Promise.all([listVersions(access, on.app), access.activeId(on.app)]).then(
      ([timeline, active]) => {
        const runningId = on.versionId ?? active;
        setWhimVersions({ at: on.tappedAt, version: runningVersion(timeline, runningId), newVersion: active !== null && runningId !== active });
      },
      (e: unknown) => log.debug(CHANNELS.app, 'whim sheet versions unavailable', errorFields(e)),
    );
  };

  /** The orb's tap: the Whim sheet opens over the running app. */
  const openWhimSheet = () => {
    if (screen.kind !== 'app') return;
    readWhimVersions(screen);
    setScreen((s) => (s.kind === 'app' ? { ...s, sheet: 'menu' } : s));
  };

  /** The Whim sheet's send: the same sheet grows into the plan page for a change of the running app,
   *  which keeps running under it (`under`). Where the terms or consent are due, the first-run ask
   *  comes first, as for every action that sends, and continues on Describe with the words. */
  const onWhimSend = () => {
    if (screen.kind !== 'app') return;
    const from: AppScreen = { ...screen, sheet: undefined };
    const text = whimWords?.appId === from.app.id ? whimWords.text : '';
    const editing = reachableApps().find((app) => app.id === from.app.id);
    if (text.trim() === '' || !editing) return;
    const flow: LegalFlow<Screen> = { continuation: { kind: 'compose', editing, text }, returnTo: from, refused: false };
    if (legalScreen(flow) !== undefined) {
      setWhimWords(null);
      advanceLegalFlow(flow);
      return;
    }
    if (!resolveClientOptions()) return;
    setWhimWords(null);
    setUnder(from);
    readAbout(editing, 'whimSheetSend');
    onDescribeContinue(describeStep(editing, text)).catch((e: unknown) => logGenError('clarify continuation failed', e));
  };

  // ── Changing an app while it runs (app-launcher "Changing an app keeps it running and offers Reload") ──

  /** A change to the app `on` runs landed on `installed` (that app, or its continuation): the orb's dot
   *  and the Whim sheet's row for this launch, and the toast whose Reload opens `installed` in place. */
  const changeLanded = (on: AppScreen, installed: InstalledApp) => {
    setLanded({ appId: on.app.id, at: on.tappedAt, entry: installed });
    toastRef.current?.show({
      message: changedTitle(installed.name),
      action: {
        label: COPY.actionReload,
        onPress: () => {
          if (runningRef.current?.app.id === on.app.id) reloadRef.current(installed).catch(() => undefined);
        },
      },
    });
  };

  /** The failed-change toast's See why: the change's Failure page, in the sheet over the running app.
   *  Nothing once a new change of the app is running: the failure it told of is gone, and that
   *  run's page would offer to start it again over itself. */
  const seeWhy = (id: string) => {
    const rec = pending.readCurrent(id)?.record;
    if (running === null || rec?.editingAppId !== running.app.id || pending.hasLiveAttempt(id)) return;
    keepDraft(screen);
    setUnder({ ...running, sheet: undefined });
    setScreen(failureFromRecord(rec));
  };
  const seeWhyRef = useRef(seeWhy);
  seeWhyRef.current = seeWhy;

  // A change that fails while its app runs says so once, over the app.
  const failedToast = useRef<string | null>(null);
  const failedId = runningChange.failed?.id;
  const failedAt = runningChange.failed?.updatedAt;
  useEffect(() => {
    const told = `${failedId}:${failedAt}`;
    if (failedId === undefined || failedToast.current === told) return;
    failedToast.current = told;
    toastRef.current?.show({ message: COPY.changeFailedToast, action: { label: COPY.toastSeeWhy, onPress: () => seeWhyRef.current(failedId) } });
  }, [failedId, failedAt]);

  /** "New version ready · Reload", and the crash screen's Reload: the app opens again in place, on the
   *  version that is now current. */
  const onWhimReload = () => {
    reloadRunning().catch(() => undefined);
  };

  /** The crash screen's "Ask Whim to fix it": the Whim sheet over the crashed app, its field holding the
   *  request with the error attached. It sends through the sheet's own send, so it starts nothing
   *  itself, and while a change of the app is being made the sheet shows that change instead. */
  const askWhimToFix = (attachment: string) => {
    if (screen.kind !== 'app') return;
    setWhimWords({ appId: screen.app.id, text: crashFixWords(attachment) });
    openWhimSheet();
  };

  /** The Whim sheet's page for `page` over the running app `on`: its menu, or Report a problem pushed
   *  inside it. Both fit their content. */
  const whimSheetPage = (on: AppScreen, page: WhimSheetPage): SheetContent => {
    const { app } = on;
    if (page === 'report') {
      return {
        key: `whim-report:${app.id}`,
        detent: 'fit',
        node: (
          <WhimReportPage
            app={app}
            access={access}
            options={reportOptions}
            legalLanguage={legalLanguage}
            onUpdateRequired={onReportUpdateRequired}
            onBack={() => setScreen((s) => (s.kind === 'app' && s.sheet === 'report' ? { ...s, sheet: 'menu' } : s))}
          />
        ),
      };
    }
    const read = whimVersions?.at === on.tappedAt ? whimVersions : null;
    return {
      key: `whim:${app.id}`,
      detent: 'fit',
      node: (
        <WhimSheet
          app={app}
          version={read?.version ?? null}
          newVersion={runningChange.landed !== undefined || (read?.newVersion ?? false)}
          changing={runningChange.changing !== undefined}
          onStopChange={() => {
            if (runningChange.changing) onCancelPending(runningChange.changing);
          }}
          text={whimWords?.appId === app.id ? whimWords.text : ''}
          onChangeText={(text) => setWhimWords({ appId: app.id, text })}
          onSend={onWhimSend}
          onReload={onWhimReload}
          onHistory={() => onHistory(app, 'app')}
          onReport={() => setScreen((s) => (s.kind === 'app' ? { ...s, sheet: 'report' } : s))}
          onExit={goHome}
        />
      ),
    };
  };

  /** Closing the sheet by any route (the close control, the scrim, a drag, Android back): on Making the
   *  run keeps going and the sheet collapses into its tile; on Describe and Plan the in-flight
   *  clarify or rewrite is aborted and the draft kept (`goHome` → `keepDraft`), or, over the app the
   *  Whim sheet sent the change from, the app shows again; on Ready it is Done; on Failure it leaves
   *  the attempt as it is, its tile and journal kept. The Whim sheet closes onto its running app.
   *  History has no sheet: a close there is Android back reaching the Whim sheet's window while it still
   *  slides away after its History row (the window takes the press, not History's back listener), and
   *  it means History's own Back. */
  const closeSheet = () => {
    if (screen.kind === 'history') {
      historyBack(screen)();
    } else if (screen.kind === 'making') {
      onLeaveRunning();
    } else if (screen.kind === 'app') {
      setScreen({ ...screen, sheet: undefined });
    } else if (running !== null) {
      keepDraft(screen);
      setScreen(running);
    } else {
      goHome();
    }
  };

  /** The page the making sheet shows for the current screen, with the key it is shown under; `null`
   *  closes the sheet. */
  const renderSheetPage = (): SheetContent | null => {
    if (screen.kind === 'app') return screen.sheet === undefined ? null : whimSheetPage(screen, screen.sheet);
    if (screen.kind === 'describe') {
      const from = screen;
      return {
        key: pageKeyOf(from),
        node: (
          <DescribePage
            text={from.text}
            editing={from.editing}
            serverUnreachable={showServerUnreachableNotice(connectivity, clientOptions != null)}
            notice={from.notice}
            onChangeText={(text) => setScreen(onlyOnStep<Screen, 'describe'>('describe', (s) => describeTextChanged(s, text)))}
            onContinue={() => onDescribeContinue(from)}
          />
        ),
      };
    }
    if (screen.kind === 'plan') {
      const from = screen;
      return {
        key: pageKeyOf(from),
        node: (
          <PlanPage
            screen={from}
            editing={from.editing}
            onBack={() => backToDescribePage(from)}
            onAnswer={(id, change) => setScreen(onlyOnStep<Screen, 'plan'>('plan', (s) => withAnswer(s, id, change)))}
            onChangeRow={(rowIndex, text) => setScreen(onlyOnStep<Screen, 'plan'>('plan', (s) => updatePlanRow(s, rowIndex, text)))}
            onMake={() => onBuildIt(from)}
            onTryAgain={() => onPlanTryAgain(from)}
            onMakeInstead={() => onBuildInstead(from)}
          />
        ),
      };
    }
    if (screen.kind === 'making' || screen.kind === 'ready' || screen.kind === 'failure') {
      return { key: pageKeyOf(screen), node: renderRunPage(screen) };
    }
    return null;
  };

  /** A run's own page: Making while it runs, Ready when it delivered, Failure when it didn't. Each
   *  reads only that run's state: its screen, its signals, its sampled activity, its journal. */
  const renderRunPage = (from: MakingScreen | Extract<Screen, { kind: 'ready' | 'failure' }>): React.ReactNode => {
    if (from.kind === 'making') {
      return (
        <MakingPage
          name={from.editing?.name ?? attemptName({ prompt: from.text, workingTitle: workingTitleFromPrompt(from.text) })}
          changing={from.editing != null}
          words={from.text}
          stage={from.stage}
          delivering={from.delivering}
          queuedPosition={from.queuedPosition}
          repairAttempt={from.repairAttempt}
          stepSince={from.stepSince}
          signals={signalsRef.current}
          now={Date.now()}
          activity={from.runId != null ? liveView.activity[from.runId] ?? 0 : 0}
          onStop={onStopMaking}
        />
      );
    }
    if (from.kind === 'ready') {
      return <ReadyPage app={from.app} words={from.text} onOpen={() => onOpen(from.app)} onDone={goHome} />;
    }
    return (
      <FailurePage
        kind={failureKindOf({
          reason: from.reason,
          rephraseHelps: from.rephraseHelps,
          repairs: from.observedRepairAttempts,
          interrupted: from.interrupted,
          refused: from.notice != null,
          cause: from.cause,
          needsUpdate: from.needsUpdate,
        })}
        reason={from.reason}
        diagnostics={from.diagnostics}
        rephraseHelps={from.rephraseHelps}
        changing={from.hasWorkingVersion}
        notice={from.notice}
        offline={showOfflineIndicator(connectivity)}
        journal={failureJournal}
        attemptStarted={from.journalId != null}
        devMode={timelineDevMode}
        onNotNow={goHome}
        {...failureActions(from)}
      />
    );
  };

  const renderHome = (): React.ReactNode => (
    <HomeScreen
      apps={apps}
      pending={pendingBuilds.map((view) => view.record)}
      purges={purges}
      onOpen={onOpen}
      onFork={onFork}
      onDelete={onDelete}
      onUndoDelete={onUndoDelete}
      onSettleDelete={onSettleDelete}
      onDiscard={onDiscard}
      onUndoDiscard={onUndoDiscard}
      onSettleDiscard={onSettleDiscard}
      appBusy={appBusy}
      canCopyData={access.canCopyData}
      draft={composerDraft}
      queued={liveView.queued}
      activity={liveView.activity}
      onHistory={(app) => onHistory(app, 'home')}
      onPromptAgain={(app) => openWithConsent({ kind: 'compose', editing: app })}
      onCreate={(idea) => openWithConsent({ kind: 'compose', text: idea })}
      onSettings={() => setScreen({ kind: 'settings' })}
      onOpenDevProbe={onOpenDevProbe}
      offline={showOfflineIndicator(connectivity)}
      onOpenPending={onOpenPending}
      onCancelPending={onCancelPending}
      onRetryPending={(rec) => openWithConsent({ kind: 'retry', record: rec })}
      onCustomizeTile={onCustomizeTile}
      onResetTile={onResetTile}
    />
  );

  /** Where leaving a stack screen lands: one handler, run by its header back, a swipe and system
   *  back alike, and always off the screen at once (`NativeStack.tsx`). History opened over an app
   *  leaves by its own Back and system back through `backFromHistoryToApp` instead. */
  const leaveFor = (from: StackScreen): (() => void) => {
    switch (from.kind) {
      case 'home':
      case 'settings':
        return goHome;
      case 'advanced':
        return () => setScreen({ kind: 'settings' });
      case 'consent':
        return onConsentReviewClose;
      case 'history':
        return () => leaveHistory(from.app, from.from);
      case 'report':
        return () => setScreen(from.from);
    }
  };

  /** A stack screen's content, given the handler that leaves it. Settings and AI features are keyed
   *  by the text size, as a sheet's frame is: iOS keeps every text measured at the size it was first
   *  laid out at, so a size changed while they show left rows at their old height with the words cut
   *  in half. They hold nothing of their own, so only their scroll position starts again; the stack
   *  under them, drafts and a running build live in this shell and are untouched. Home keys its own
   *  layout under its state (`HomeScreen`). */
  const renderStackScreen = (on: StackScreen, leave: () => void): React.ReactNode => {
    switch (on.kind) {
      case 'home':
        return renderHome();
      case 'settings':
        return (
          <SettingsScreen
            key={tokens.fontScale}
            onBack={leave}
            onOpenAIFeatures={onOpenAIFeatures}
            legalLanguage={legalLanguage}
            onLegalLanguageChange={onLegalLanguageChange}
            version={versionLabel(appInfo)}
            onReportProblem={() => setScreen({ kind: 'report', app: null, from: { kind: 'settings' } })}
            onOpenAdvanced={() => setScreen({ kind: 'advanced' })}
          />
        );
      case 'advanced':
        return (
          <AdvancedScreen
            onBack={leave}
            errorDetails={errorDetailsShown}
            onErrorDetailsChange={onErrorDetailsChange}
            deviceId={deviceId}
            onResetDeviceId={onResetDeviceId}
            serverChoice={chosenServer}
            ownServerAcknowledged={ownServerAck}
            onAcknowledgeOwnServer={onAcknowledgeOwnServer}
            onChooseServer={onChooseServer}
            savedAddress={loadServerUrl(kv)}
            onServerUrlChange={onServerUrlChange}
            canProbe={clientOptions != null}
            probe={lastProbe}
            legalLanguage={legalLanguage}
          />
        );
      case 'consent':
        return (
          <ConsentScreen
            key={tokens.fontScale}
            language={legalLanguage}
            onLanguageChange={onLegalLanguageChange}
            consentOn={consentStatus(kv).kind === 'granted'}
            onAgree={onTurnOnAIFeatures}
            onTurnOff={onConsentReviewTurnOff}
            onClose={leave}
          />
        );
      case 'history':
        return (
          <HistoryScreen
            app={on.app}
            access={access}
            onBack={historyBack(on)}
            onChangeIt={(app) => openWithConsent({ kind: 'compose', editing: app })}
            onReport={() => setScreen({ kind: 'report', app: on.app, from: on })}
            canCopyData={access.canCopyData}
            onFork={(app, versionId, opts) => onFork(app, opts, versionId)}
            onOpen={onOpen}
          />
        );
      case 'report':
        return (
          <ReportScreen
            app={on.app}
            access={access}
            options={reportOptions}
            legalLanguage={legalLanguage}
            onLeave={leave}
            onUpdateRequired={onReportUpdateRequired}
          />
        );
    }
  };

  /** One stack entry: its header, its colours and its content, all keyed to the screen it shows. */
  const stackEntry = (on: StackScreen): StackEntry => {
    const leave = leaveFor(on);
    const look = schemeFollowing(on) ? { background: tokens.colors.bg, foreground: tokens.colors.text } : { background: palette.bg, foreground: palette.text };
    return { key: on.kind, title: stackTitle(on), largeTitle: on.kind === 'settings', onLeave: leave, ...look, children: renderStackScreen(on, leave) };
  };

  /** The mini-app container, mounted under every screen once the shell is ready (design-system-v1
   *  task 18.4): hidden, with one WebView waiting, while no app is open; the open app when one is.
   *  Both branches render it at the same place, so opening and closing never remount it. The app stays
   *  open under a change's pages the Whim sheet grew into (`running`). */
  const renderMiniApp = (sheetOpen: boolean): React.ReactNode => {
    if (!ready) return null;
    if (running === null) return <MiniAppStage launch={null} onFrame={setAppFrame} />;
    const launch: MiniAppLaunch = {
      record: running.record,
      bundleSource: running.source,
      engineAppId: running.engineAppId,
      tappedAt: running.tappedAt,
      onExit: goHome,
      onOpenSheet: openWhimSheet,
      sheetOpen,
      onCloseSheet: closeSheet,
      installedApp: running.app,
      orb,
      onReload: onWhimReload,
      onAskFix: askWhimToFix,
    };
    return <MiniAppStage launch={launch} onFrame={setAppFrame} />;
  };

  // What the shell is laid out around: the running app while a change's pages sit over it, else the screen.
  const base: Screen = running ?? screen;
  const sheetPage = renderSheetPage();
  const stack = ready ? stackFor(base) : null;
  // A deeper stack is a push the platform now draws; a stack mounted afresh (History over an app)
  // is not drawn as a move, and one gone will never say a move finished.
  const stackDepth = stack?.length ?? 0;
  useLayoutEffect(() => {
    const pushes = stackPushes.current;
    if (stackDepth === 0) pushes.drawing = 0;
    else if (pushes.depth > 0 && stackDepth > pushes.depth) pushes.drawing += 1;
    pushes.depth = stackDepth;
  }, [stackDepth]);
  let content: React.ReactNode;
  if (!ready) {
    content = <HomeSkeleton count={knownAppCount} />;
  } else if (stack !== null) {
    content = <NativeStack entries={stack.map(stackEntry)} onSettled={onStackSettled} />;
  } else {
    content = renderScreenContent();
  }

  // Task 15.2 (design-system-v1 D12): the shell root, not HomeScreen's layout, ends the launch-screen
  // hold, on the frame after the first real screen (Home, or a link's landing) commits; the skeleton
  // before `ready` stays under the ember. Once per shell; `hideLaunchScreen` is idempotent anyway.
  const hideLaunchScreenRef = useRef<(() => void) | null>(hideLaunchScreen);
  useEffect(() => {
    const hide = hideLaunchScreenRef.current;
    if (!ready || hide === null) return undefined;
    const frame = requestAnimationFrame(() => {
      hideLaunchScreenRef.current = null;
      hide();
    });
    return () => cancelAnimationFrame(frame);
  }, [ready]);

  // The boundary wraps the screen switch's `content` and NOTHING above it (design D1): a screen
  // that throws loses its own subtree, while the safe-area frame and the status-bar inset — the
  // blank-screen failure mode this exists to remove — still render. `screen.kind` is both the
  // failing-screen identifier in the log record and the reset key, so navigating away and back
  // re-attempts a screen that failed once.
  const exit = SCREEN_EXITS[screen.kind];
  const frame = shellFrame(base, stack?.at(-1), ready, tokens, appFrame);

  return (
    <HighlightingProvider enabled={highlighting}>
      <SafeAreaView edges={frameEdgesFor(base.kind, stack !== null)} style={[styles.root, { backgroundColor: frame.background }]}>
        <StatusBar barStyle={frame.barStyle} />
        <ToastHost bottomOffset={toastOffset(base.kind)}>
          <ToastBridge api={toastRef} />
          <ScreenBoundary
            screen={screen.kind}
            FallbackComponent={ScreenErrorFallback}
            onLeave={exit.back === 'root' ? undefined : goHome}
          >
            {renderMiniApp(sheetPage !== null)}
            {content}
            <MakingSheet content={sheetPage} onClose={closeSheet} />
            {checkingAge !== undefined && <AgeCheckBack onLeave={() => onLegalDecline(checkingAge.returnTo)} />}
            <FirstRunHost
              ask={firstRunAskOf(screen)}
              language={legalLanguage}
              onLanguageChange={onLegalLanguageChange}
              outdatedFrom={outdatedGrantVersion(consentStatus(kv))}
              consentDue={grantDue}
              onAgree={onFirstRunAgree}
              onDecline={onLegalDecline}
            />
          </ScreenBoundary>
        </ToastHost>
        <DevLogTools />
      </SafeAreaView>
    </HighlightingProvider>
  );
}

/** Hands the one toast host's API to the shell that mounts it, which cannot call `useToast` above
 *  its own `ToastHost`. Renders nothing. */
function ToastBridge({ api }: Readonly<{ api: React.MutableRefObject<ToastApi | null> }>) {
  const toast = useToast();
  useEffect(() => {
    api.current = toast;
    return () => {
      api.current = null;
    };
  }, [api, toast]);
  return null;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  devLogBtn: {
    position: 'absolute',
    right: SPACING.md,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    borderWidth: 1,
    borderRadius: RADIUS.chip,
  },
});
