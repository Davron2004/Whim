/**
 * copy — every user-facing string on the LAUNCHER surface, in one place (launcher-shell / #5).
 *
 * The spec requires the launcher surface to speak PRODUCT VERBS only: no git terminology, no
 * mechanism names (realm, lineage, snapshot ids in hash form), no internal identifiers.
 * Centralizing the copy here makes that checkable — `product-verbs.suite.ts` asserts this table
 * carries no forbidden vocabulary (the "product-verbs guard"). "Fork", "Delete", "Open" are
 * PRODUCT verbs (the spec names them); they are allowed.
 *
 * v2 (shell-redesign-v2 / group B): the whole redesigned shell's copy is seeded here in one pass,
 * verbatim from `docs/design/README.md` and the prototypes, so the screen chains READ strings
 * rather than writing them. Every string is voice-checked: sentence case, no exclamation marks,
 * outcome not mechanism, and unambiguous when rendered flat (Whim Syntax discipline rule 5 —
 * `whim-prose.suite.ts` asserts it).
 *
 * Whim Syntax rule 7: these are what the product is OFFERING, not what it is TELLING you, so the
 * renderer never marks them (`render.ts#isOffering`). Agent prose — summaries, the user's own
 * prompts — is not in this table and never should be.
 *
 * (The DevProbeScreen — a __DEV__-only surface — deliberately shows mechanism diagnostics; it is
 * NOT the launcher surface and is out of this table's scope.)
 */
export const COPY = {
  // ── home (2a) ───────────────────────────────────────────────────────────────
  homeTitle: 'Whim',
  homeSubtitle: 'Your apps',
  homeComposerPlaceholder: 'Describe an app…',
  exampleBadge: 'Example',
  actionOpen: 'Open',
  actionFork: 'Fork',
  actionPromptAgain: 'Prompt again',
  actionDelete: 'Delete',
  /** The Fork/Delete rows while that app's operation is running (`app-launcher` "Fork and delete
   *  show a busy state and cannot be re-triggered mid-operation"): the row says what it is doing
   *  rather than what it offers, so the disabled row never reads as an unregistered tap. */
  actionForkBusy: 'Forking…',
  actionDeleteBusy: 'Deleting…',
  cancel: 'Cancel',
  // ── ghost tiles (launcher-ghost-tiles) ──────────────────────────────────────
  /** A ghost/rebuild tile's state caption — names its own state, distinguishing `building` from
   *  the shared `failed`/`interrupted` alert treatment (spec "Building and failed/interrupted
   *  ghosts are visually distinct"). */
  ghostCaptionBuilding: 'Building…',
  ghostCaptionFailed: 'Didn’t finish',
  ghostCaptionInterrupted: 'Interrupted',
  /** Long-press quick actions (spec "Long-press on a ghost tile offers Cancel or Dismiss, never
   *  both"). Named distinctly from the sheet's own closing `cancel` row so the two never collide
   *  in the same menu. */
  actionCancelBuild: 'Cancel build',
  actionDismissBuild: 'Dismiss',
  /** What an `interrupted` pending-build record's failure screen says: it carries no failure
   *  payload, because nothing failed — the process that owned the stream went away. Stated
   *  plainly rather than borrowed from a generic stream-error string, which would claim a failure
   *  that never happened. */
  interruptedBuildReason: 'This build stopped when the app closed. You can try it again.',
  deleteTitle: 'Delete this app?',
  deleteConfirm: 'Delete',
  emptyTitle: 'No apps yet',
  settingsTitle: 'Settings',
  backLabel: 'Back',
  highlightingSectionTitle: 'Highlighting',
  highlightingHint: 'Colours and marks in what Whim tells you.',

  // ── the five-step prompt flow (2a) ──────────────────────────────────────────
  flowContinue: 'Continue',
  composeHeadline: 'What should it do?',
  /** The edit flow's compose headline — "Prompt again"/"Change it" on an app that already
   *  exists, never the new-app question (`editingEyebrow`/`composeHeadline` "the edit flow reads
   *  as editing, on every step"). */
  composeHeadlineEdit: 'What should change?',
  composeHelper: 'Plain words are enough. Whim will ask if something is unclear.',
  /** The edit flow's compose field placeholder — `homeComposerPlaceholder` stays the new-app one
   *  (it is shared with the home screen's own composer row). */
  composePlaceholderEdit: 'Add, change, or remove something…',
  composeChipsEyebrow: 'Or start from',
  composeChipTimer: 'a timer with my pour-over recipe',
  composeChipTracker: 'a tracker for how often I water the plants',
  composeChipDice: 'a dice roller for game night',
  clarifyHeadlineOne: 'One quick thing',
  clarifyHeadlineTwo: 'Two quick things',
  clarifyHeadlineThree: 'Three quick things',
  clarifyHelper: 'Skip these and Whim will pick sensible answers.',
  /** The one-line liveness phrase under the clarify skeleton (`WorkingLine`, `flow-working.tsx`). */
  workingClarify: 'Thinking about what to ask',
  planHeadline: 'Here’s the plan',
  /** The edit flow's plan headline — the SAME approval gate, over a change instead of a new app. */
  planHeadlineEdit: 'Here’s the change',
  planSubhead: 'Tap anything to change it before building.',
  planFooter: 'Nothing here is final — you can keep changing the app after it’s built.',
  planBuild: 'Build it',
  /** The edit flow's plan primary action. */
  planBuildEdit: 'Make the change',
  planRowSave: 'Save',
  /** The liveness phrase under the plan skeleton, new-app and edit variants. */
  workingPlan: 'Writing the plan',
  workingPlanEdit: 'Writing up the change',
  buildTitle: 'Making it',
  /** The edit flow's build title — copy only; `BuildStep.tsx` is placed by another task. */
  buildTitleEdit: 'Changing it',
  buildSubtitle: 'This takes about a minute. You can leave and come back.',
  buildStepReading: 'Reading your plan',
  buildStepWriting: 'Writing the app',
  buildStepChecking: 'Checking it runs safely',
  buildStepInstalling: 'Putting it on your home screen',
  buildLeaveRunning: 'Leave it running',
  /** Opens the run timeline for the attempt on screen. */
  buildDetails: 'Details',
  // ── the run timeline (generation-observability, design D7) ──────────────────
  /** The timeline's heading, on the build screen's details view and on the failure screen. */
  timelineTitle: 'What happened',
  /** No journal survived for this attempt — the section says so rather than inventing a run. */
  timelineEmpty: 'Nothing was recorded for this attempt.',
  timelineClose: 'Close',
  /** A stage the attempt was still in when the journal stops — no duration is invented for it. */
  timelineStillGoing: 'still going',
  // One plain-words label per generation stage. `check`, `run` and `repair` share ONE named build
  // step on the progress screen, but the timeline is a list of what happened in order, so each
  // stage the device actually saw gets its own line.
  timelineStagePlan: 'Read the plan',
  timelineStageGenerate: 'Wrote the app',
  timelineStageCheck: 'Checked it',
  timelineStageRun: 'Tried it out',
  timelineStageRepair: 'Fixed what didn’t work',
  doneBody: 'It’s on your home screen. Open it, or tell Whim what to change.',
  doneOpen: 'Open it',
  doneBackToApps: 'Back to your apps',

  // ── history (4a) ────────────────────────────────────────────────────────────
  actionHistory: 'History',
  /** The header reads "<app name, in its own hue> history" — the name is a coloured span the
   *  screen composes, so only the trailing word lives here. */
  historyTitleSuffix: 'history',
  historyOriginYouSaid: 'You said',
  historyOriginUnprompted: 'Whim, on its own',
  historyCurrentMarker: '↑ you’re on this one',
  historyTouchedEyebrow: 'What it touched',
  historyChangeFromHere: 'Change it from here',
  historyGoBackToThis: 'Go back to this',
  historyStartCopyHere: 'Start a copy here',
  historyFilterWhatItDoes: 'What it does',
  historyFilterLook: 'Look',
  historyFilterFixes: 'Fixes',
  historyKindAdded: 'Added',
  historyKindChanged: 'Changed',
  historyKindRemoved: 'Removed',
  historyKindLook: 'Look',
  historyKindFixed: 'Fixed',
  historyKindStart: 'Start',
  historyInstallLabel: 'Where this app began',
  historyReassurance: 'Nothing is deleted — this data returns when you move to a newer version.',
  historyRestoreConfirm: 'Go back to it',
  historyCopyConfirm: 'Make the copy',
  historyCopyToast: 'Copy made — it’s on your home screen',
  /** The three history wait states (`version-history`, flow-wait-hygiene): the first-load
   *  skeleton's screen-reader name, the two confirm buttons' in-flight labels, and the name of
   *  the muted placeholder standing in for the reassurance line while it is computed. */
  historyLoadingLabel: 'Looking up this app’s history',
  historyRestoreConfirmBusy: 'Going back…',
  historyCopyConfirmBusy: 'Making the copy…',
  historyReassurancePending: 'Checking what this changes',
  forkShareData: 'Use the same saved data',
  forkStartFresh: 'Start fresh',

  // ── inside a running app: the orb menu (3a) ─────────────────────────────────
  // `versions` opens the real History screen and `change` opens the real compose step (review
  // fix-pass, shell-redesign-v2) — there is no orb-local sheet left to title, so those two keys
  // and the placeholder `copy` action's label are gone with it.
  orbActionChangeIt: 'Change it',
  orbActionHome: 'Home',
  orbActionVersions: 'Versions',
  orbActionReport: 'Report this app',
  orbMenuOpenLabel: 'Open the app menu',
  orbMenuCloseLabel: 'Close the app menu',
  orbMenuDismissLabel: 'Dismiss the app menu',

  // ── the report sheet (content-reporting; design D13/D14) ────────────────────
  reportSheetTitle: 'Report this app',
  /** The done step's plain-text entry point, below its two fixed destinations. */
  doneReportThisApp: 'Report this app',
  /** The history header's entry point — reports the version the user is currently on. */
  historyReportAction: 'Report',
  reportReasonEyebrow: 'What went wrong?',
  reportReasonBroken: 'Doesn’t work',
  reportReasonWrongResult: 'Wrong result',
  reportReasonHardToUse: 'Hard to use',
  reportReasonHarmful: 'Unsafe',
  reportReasonOffensive: 'Offensive',
  reportReasonOther: 'Something else',
  reportNotePlaceholder: 'Add a note (optional)',
  reportPreviewTitle: 'What gets sent',
  reportFieldReason: 'Reason',
  reportFieldNote: 'Note',
  reportFieldAppName: 'App',
  reportFieldPrompt: 'The prompt',
  reportFieldSource: 'The code',
  reportIncludePrompt: 'Include the prompt for this version',
  reportCodeDisclosure: 'Your report includes this app’s code so we can investigate what went wrong.',
  reportNoCodeDisclosure: 'This version has no saved code to include.',
  reportAnonIdLine: 'An anonymous ID for this phone travels with this report, which goes to AnyCognition.',
  reportSend: 'Send report',
  reportSendBusy: 'One moment',
  reportShowMore: 'Show more',
  reportShowLess: 'Show less',
  reportThanksTitle: 'Thanks. The Whim team reads every report.',
  reportThanksDone: 'Done',
  reportSendFailedGeneric: 'Couldn’t send the report. Check your connection and try again.',
  reportTooLarge: 'This report is too large to send. You can try leaving out the prompt.',

  // ── mini-app boot state (`app-launcher` "The mini-app container shows a boot state before
  //    first paint") ──────────────────────────────────────────────────────────
  /** Shown under the app's own name while its realm loads, so the wait before first paint reads
   *  as Whim opening the app rather than as a blank screen. */
  appBootLabel: 'Opening…',
  /** The boot overlay's accessibility label — the screen reader gets the same fact the sighted
   *  user gets from the breathing mark. */
  appBootA11yLabel: 'Opening this app',

  // ── failure surfaces ────────────────────────────────────────────────────────
  launchFailedTitle: 'Couldn’t open this app',
  launchFailedBody:
    'Something about this app doesn’t match what’s already saved here, so it can’t open right now.',
  launchFailedBack: 'Back to your apps',
  appErrorTitle: 'This app ran into a problem',
  appErrorBody: 'It stopped and can’t carry on right now. Try again, or go back to your apps.',
  appErrorRetry: 'Try again',
  failureTitle: 'Couldn’t build this app',
  // What a delivered bundle that defines no app reads as (bundle-validity guard): the generation
  // came back with nothing usable, so it is refused at delivery rather than stored and only
  // discovered broken the next time the app is opened.
  failureEmptyBuild: 'The app came back empty. Try again.',
  failureHintsTitle: 'What to try',
  failureRephrase: 'Try rephrasing',
  // The failure screen's two exits are deliberately NOT interchangeable: `failureBack` leaves the
  // attempt exactly where it is, `failureDismiss` deletes it. A destructive action is never
  // labelled as plain navigation (`prompt-flow` "Failure screens hydrate from the persisted
  // failure payload").
  failureBack: 'Back to your apps',
  failureDismiss: 'Discard this attempt',
  // The recoverable error screen the launcher's screen boundary renders (obs-v1) — plain
  // English, never the thrown error itself.
  screenErrorTitle: 'This screen stopped working',
  screenErrorBody: 'Nothing you made was lost. Try again, and it should come back.',
  screenErrorRetry: 'Try again',
  // Shown only when the failed screen is not Home (design D7; spec launcher-screen-exits "A screen
  // without a declared exit fails the fast gate") — a screen that throws on every render would
  // otherwise be a dead end with only `Try again` to press.
  screenErrorBack: 'Back to your apps',
  // The `3b` failure checklist (obs-v1) — the two rows the screen writes itself. Every other row
  // is a diagnostic's own `hint`, so no mechanism vocabulary can reach the panel.
  failureRecoveredTitle: 'Fixed it',
  failureRowLastVersionWorks: 'The version you already had still works and is still installed',
  failureRowSayItDifferently: 'Describing it differently usually gets past this',

  // ── AI-data consent (ai-data-consent; design D4/D5) ─────────────────────────
  // The consent screen's disclosure, shared verbatim between ask and review mode (design D5) —
  // only the bottom actions below differ by mode.
  consentTitle: 'Before Whim makes apps for you',
  consentLead:
    'To make or change an app, Whim sends your request to AnyCognition’s server. The server uses AI models from other companies, reached through OpenRouter, to write the app.',
  consentWhatSentTitle: 'What gets sent',
  consentWhatSentRequest: 'What you ask for: your description, your answers to Whim’s questions, and the plan you approve',
  consentWhatSentEdit: 'When you change an app: its name, its code, its current description, and the layout of its saved data',
  consentWhatSentDevice: 'An anonymous ID for this phone, used for daily limits',
  consentWhatNeverSentTitle: 'What never gets sent',
  consentWhatNeverSent: 'Anything you save inside your apps',
  consentFootnote: 'You can turn this off in Settings. Apps you already have keep working either way.',
  // Shown above the disclosure only when the stored grant is outdated (spec "A policy change asks again").
  consentOutdatedLine: 'What Whim sends has changed since you last agreed.',
  consentAgree: 'Agree and continue',
  consentDecline: 'Not now',
  // Review mode's action set (spec "Settings shows consent and can review or turn it off"): the
  // large button is always the safe one — keeping AI features on, or turning them on from off.
  consentReviewKeepOn: 'Keep AI features on',
  consentReviewTurnOff: 'Turn off AI features',
  consentReviewTurnOn: 'Turn on AI features',
  // Shared between the consent screen's own link and the Settings About row (identical text, two
  // surfaces) — one key, so the two can never read differently.
  privacyPolicyLabel: 'Privacy policy',
  supportLabel: 'Support',

  // ── settings ────────────────────────────────────────────────────────────────
  settingsAISectionTitle: 'AI features',
  settingsAIOff: 'Off',
  settingsAboutSectionTitle: 'About',
  settingsAdvancedSectionTitle: 'Advanced',
  settingsUseDefaultServer: 'Use Whim’s server',
  // Shown in place of the save-time probe result while AI features are off (server-connectivity
  // "Without a current consent grant the system SHALL NOT probe").
  settingsProbeNeutral: 'Checked once AI features are on',
  serverAddressSectionTitle: 'Server address',
  serverAddressHint: 'Where Whim sends your prompts to build apps.',
  // The debounced save-time probe's three-way inline result (server-connectivity, design.md
  // decision 3) — shown under the server-address field a moment after the user stops typing.
  serverProbeVerified: 'Verified — this is a Whim server.',
  serverProbeUnverified: 'Something answered, but it doesn’t look like a Whim server.',
  serverProbeUnreachable: 'Can’t reach this address.',

  // ── connectivity (offline UX surfaces, design.md decision 7) ────────────────
  // The home screen's quiet indicator and the compose entry point's advisory notice, both keyed
  // off the session's `connectivity` state (server-connectivity spec "The home screen shows a
  // quiet connectivity indicator" / "The compose entry point shows a server-unreachable notice
  // without blocking generation") — the compose step opens only once AI-data consent is granted,
  // so there is no separate "no address configured" message any more (a server address always
  // exists, per `release-config`).
  homeOfflineIndicator: 'Can’t reach the server',
  promptServerUnreachable: 'Can’t reach your server right now — you can still try.',

  // ── app links (app-links; design D15/D16) ───────────────────────────────────
  actionAppLink: 'App link',
  appLinkMissingTitle: 'This app lives on another phone',
  appLinkMissingBody:
    'Apps made with Whim stay on the phone that made them, so this link only opens there.',
  appLinkMissingBack: 'Back to your apps',
  appLinkSheetClose: 'Done',
} as const;

/** The AI features row's status line (design D7): the date it was granted when on, or `Off` —
 *  `outdated` reads the same as `absent` here, since neither currently authorizes a request. */
export function aiFeaturesStatusLine(kind: 'granted' | 'absent' | 'outdated', sinceLabel?: string): string {
  return kind === 'granted' && sinceLabel != null ? `On since ${sinceLabel}` : COPY.settingsAIOff;
}

/** "Forked from Water Counter" — fork provenance for a tile (product vocabulary). */
export function forkedFromLabel(name: string): string {
  return `Forked from ${name}`;
}

/** The App link reveal sheet's one line of copy (design D16): "Opens Water Counter on this phone.
 *  Press and hold the link to copy it." — the selectable `<Text>` itself carries the link. */
export function appLinkSheetLine(name: string): string {
  return `Opens ${name} on this phone. Press and hold the link to copy it.`;
}

/** A ghost/rebuild tile's state caption, by `PendingBuildRecord.state` (kept as the bare literal
 *  union rather than importing `PendingBuildState` — `copy.ts` stays free of any non-`react` /
 *  non-`react-native` module dependency). */
export function ghostStateCaption(state: 'building' | 'failed' | 'interrupted'): string {
  if (state === 'building') return COPY.ghostCaptionBuilding;
  if (state === 'failed') return COPY.ghostCaptionFailed;
  return COPY.ghostCaptionInterrupted;
}

/** The Settings screen's save-time probe result (server-connectivity, design.md decision 1;
 *  `server-probe.ts`'s `ProbeResult`). Kept as the bare literal union rather than importing
 *  `ProbeResult` — `copy.ts` stays free of any non-`react`/non-`react-native` module dependency,
 *  the same discipline `ghostStateCaption` keeps. */
export function serverProbeLabel(result: 'verified' | 'unverified' | 'unreachable'): string {
  if (result === 'verified') return COPY.serverProbeVerified;
  if (result === 'unverified') return COPY.serverProbeUnverified;
  return COPY.serverProbeUnreachable;
}

/** The delete confirmation body for a named app. */
export function deleteBody(name: string): string {
  return `“${name}” and all its data will be removed. This can’t be undone.`;
}

/** The History screen's data-shape annotation line (design D5): "Added: notes (text)". `fields`
 *  are already formatted as "<display name> (<type>)" by `history-logic.ts`. */
export function addedFieldsLine(fields: readonly string[]): string {
  return `Added: ${fields.join(', ')}`;
}

/** The done step's title: "<App name> is ready". */
export function readyTitle(name: string): string {
  return `${name} is ready`;
}

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

/** Elapsed wall time as `m:ss`, independent of `prompt-flow.ts#elapsedLabel` — the same
 *  standalone-arithmetic discipline `timelineDurationLabel` below keeps, and for the same reason:
 *  `prompt-flow.ts` imports `COPY` from HERE, so the reverse import would be a cycle. */
function livenessElapsedLabel(startedAt: number, now: number): string {
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / MS_PER_SECOND));
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * The build screen's ONE liveness line (build-liveness B1/B3, replacing the old "quiet for Ns"
 * heartbeat the user reported as misleading — see the module-level rationale in `prompt-flow.ts`'s
 * `livenessOf`). `s`/`now` are typed structurally rather than importing `RunSignals` from
 * `prompt-flow.ts` — this module imports nothing else, the same discipline `timelineDurationLabel`
 * already keeps. `liveness` is the bare literal union for the same reason `ghostStateCaption`'s
 * `state` parameter is.
 *
 * No word here is "model" or "server" (`product-verbs.suite.ts` "the launcher surface speaks
 * product verbs only" — mechanism words, not merely git vocabulary, are the ones this line has to
 * dodge): a wait that is thinking reads as "thinking", never "the model is thinking".
 */
export function buildLivenessLine(
  liveness: 'writing' | 'thinking' | 'connected' | 'stalled',
  s: { readonly startedAt: number; readonly aggregates: { readonly chars: number }; readonly lastFrameAt: number },
  now: number,
): string {
  if (liveness === 'writing') {
    return `Writing · ${s.aggregates.chars.toLocaleString()} characters`;
  }
  if (liveness === 'thinking') {
    return `Thinking it through · ${livenessElapsedLabel(s.startedAt, now)}`;
  }
  if (liveness === 'connected') {
    return `Connected, waiting for a reply · ${livenessElapsedLabel(s.startedAt, now)}`;
  }
  const quietSeconds = Math.max(0, Math.floor((now - s.lastFrameAt) / MS_PER_SECOND));
  return `Nothing has arrived for ${quietSeconds}s`;
}

// ── the run timeline's lines (generation-observability, design D7) ───────────
// The timeline's rows ARE copy — which words a stage reads as, how a duration is written — so they
// live here beside the checklist rows, in the one module the launcher's Node suite can import.
// `MS_PER_SECOND`/`SECONDS_PER_MINUTE` are declared above, alongside `livenessElapsedLabel`.

const TENTHS_PER_SECOND = 10;

/** A stage's plain-words label. Kept as the bare literal union rather than importing `Stage`, the
 *  same standing `ghostStateCaption` has: `copy.ts` depends on no other module. */
export function timelineStageLabel(stage: 'plan' | 'generate' | 'check' | 'run' | 'repair'): string {
  if (stage === 'plan') return COPY.timelineStagePlan;
  if (stage === 'generate') return COPY.timelineStageGenerate;
  if (stage === 'check') return COPY.timelineStageCheck;
  if (stage === 'run') return COPY.timelineStageRun;
  return COPY.timelineStageRepair;
}

/** How long a stage took: tenths of a second under a minute, `m ss` above it. A negative duration
 *  (out-of-order timestamps) reads as zero rather than as a negative. */
export function timelineDurationLabel(ms: number): string {
  const tenths = Math.round(Math.max(0, ms) / (MS_PER_SECOND / TENTHS_PER_SECOND));
  if (tenths < SECONDS_PER_MINUTE * TENTHS_PER_SECOND) return `${(tenths / TENTHS_PER_SECOND).toFixed(1)}s`;
  const totalSeconds = Math.round(Math.max(0, ms) / MS_PER_SECOND);
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  return `${minutes}m ${String(totalSeconds % SECONDS_PER_MINUTE).padStart(2, '0')}s`;
}

/** One stage transition's row: what happened, then how long it took. */
export function timelineStageLine(label: string, durationMs: number | null): string {
  return `${label} · ${durationMs == null ? COPY.timelineStillGoing : timelineDurationLabel(durationMs)}`;
}

/** The output-growth row: cumulative character COUNTS — sizes, never any of the text itself.
 *  `thinkingChars` (build-liveness B4) is a SEPARATE tally the model reasoned through before/between
 *  writing (`contract/src/index.ts`'s `thinking` event) — omitted whenever it is zero, so a run
 *  from before this change (or one whose roster model never reasoned) reads exactly as it always
 *  did. */
export function timelineGrowthLine(chars: number, thinkingChars = 0): string {
  const written = chars === 1 ? 'Wrote 1 character' : `Wrote ${chars} characters`;
  if (thinkingChars <= 0) return written;
  const thinking = thinkingChars === 1 ? '1 character' : `${thinkingChars} characters`;
  return `${written} after thinking through ${thinking}`;
}

/** The clarify step's headline, counted: one, two or three quick things. */
export function clarifyHeadline(questionCount: number): string {
  if (questionCount <= 1) return COPY.clarifyHeadlineOne;
  if (questionCount === 2) return COPY.clarifyHeadlineTwo;
  return COPY.clarifyHeadlineThree;
}

// ── the edit flow reads as editing, on every step (C1) ────────────────────────
// One function per branching string, so a step screen reads through a function rather than an
// inline ternary — `prompt-flow-screens.suite.ts`'s static check pins that every gated step
// actually calls these, so the branch cannot silently regress back to one un-branched string.

/** The compose step's headline: the new-app question, or the edit flow's own. */
export function composeHeadline(editing: boolean): string {
  return editing ? COPY.composeHeadlineEdit : COPY.composeHeadline;
}

/** The compose field's placeholder: the new-app prompt, or the edit flow's own. */
export function composePlaceholder(editing: boolean): string {
  return editing ? COPY.composePlaceholderEdit : COPY.homeComposerPlaceholder;
}

/** The plan step's headline: "the plan" for a new app, "the change" for an edit — the SAME
 *  approval gate either way. */
export function planHeadline(editing: boolean): string {
  return editing ? COPY.planHeadlineEdit : COPY.planHeadline;
}

/** The build step's title (copy only — `BuildStep.tsx` is out of this change's boundary; another
 *  task wires this in). */
export function buildTitle(editing: boolean): string {
  return editing ? COPY.buildTitleEdit : COPY.buildTitle;
}

/** The plan skeleton's liveness phrase (`WorkingLine`): what the wait says while the rewrite is
 *  still in flight. */
export function workingPlanPhrase(editing: boolean): string {
  return editing ? COPY.workingPlanEdit : COPY.workingPlan;
}

/** The shared "you are changing this app" eyebrow line, shown above every gated step's headline
 *  while `editing` is present (`flow-chrome.tsx#EditingEyebrow`). Sentence case here; the eyebrow
 *  style itself renders it uppercase. */
export function editingEyebrow(name: string): string {
  return `Changing ${name}`;
}

/** The history header's subtitle: "7 versions · started 3 days ago". */
export function historySubtitle(versionCount: number, startedWhen: string): string {
  const versions = versionCount === 1 ? '1 version' : `${versionCount} versions`;
  return `${versions} · started ${startedWhen}`;
}

/** The all-versions filter pill, whose count is live: "All 7". */
export function historyFilterAll(versionCount: number): string {
  return `All ${versionCount}`;
}

/** The copy-this-version confirm sheet's title. */
export function copySheetTitle(version: string): string {
  return `Start a second app from ${version}?`;
}

/** The copy-this-version confirm sheet's body: two apps, and the one in use is untouched. */
export function copySheetBody(name: string): string {
  return `You’ll have two ${name}s. The one you’re using now stays exactly as it is.`;
}

/** The go-back-to-this confirm sheet's title. */
export function restoreSheetTitle(version: string): string {
  return `Go back to ${version}?`;
}

/**
 * The go-back-to-this confirm sheet's body: what comes off, what is kept, and that the user can
 * come forward again from this list. `losing` names the specific thing when the screen knows it
 * (e.g. "the bigger numbers") and otherwise stays generic.
 */
export function restoreSheetBody(version: string, losing = 'the last few changes'): string {
  return `Everything after ${version} comes off — including ${losing}. Your saved data stays. You can come forward again from this list.`;
}

// ── the `3b` failure checklist and attempt row (obs-v1) ──────────────────────
// The failure screen's rows ARE copy: which table strings and which diagnostic hints become the
// checklist, in what order. It lives here rather than in `FailureScreen.tsx` for the same reason
// `home-grid.ts` holds the grid arithmetic — this module imports no `react-native`, so the
// composition is exercised under Node (`test/failure-screen.suite.ts`) instead of grepped for.

/** A checklist row's outcome (design `3b`, html:943): a completed check, a failed check, or a
 *  muted advisory line. The design's fourth kind, `run`, belongs to the in-flight build states,
 *  which this terminal screen never shows. */
export type FailureRowKind = 'done' | 'bad' | 'wait';

/** One checklist row. `text` is ALWAYS a diagnostic's `hint` or a `COPY` string — a diagnostic's
 *  `kind`, `symbol` or `message` never reaches it. */
export interface FailureRow {
  readonly kind: FailureRowKind;
  readonly text: string;
}

/**
 * The terminal failure state's rows (design `3b` RP[5]): the reassurance that the last working
 * version survived — OMITTED when the app has none, because there is nothing honest to reassure
 * about — then one row per diagnostic hint, then the advisory line.
 */
export function failureChecklistRows(input: {
  readonly diagnostics: readonly { hint: string }[];
  readonly hasWorkingVersion: boolean;
}): readonly FailureRow[] {
  const rows: FailureRow[] = [];
  if (input.hasWorkingVersion) rows.push({ kind: 'done', text: COPY.failureRowLastVersionWorks });
  for (const diagnostic of input.diagnostics) rows.push({ kind: 'bad', text: diagnostic.hint });
  rows.push({ kind: 'wait', text: COPY.failureRowSayItDifferently });
  return rows;
}

/** How many repair attempts a run is permitted — one attempt-row segment each (design `3b`). */
export const REPAIR_ATTEMPT_LIMIT = 3;

/** A segment of the attempt row: an attempt already spent, the one the run was on when it ended,
 *  or one that was never reached. */
export type AttemptSegment = 'spent' | 'current' | 'remaining';

/** The attempt row, one segment per permitted attempt (html:1001): the attempts the device
 *  actually observed are spent, the next one is the current one, the rest were never reached. */
export function attemptSegments(observed: number, limit = REPAIR_ATTEMPT_LIMIT): readonly AttemptSegment[] {
  const spent = Math.max(0, Math.min(Math.floor(observed), limit));
  return Array.from({ length: limit }, (_unused, i) => {
    if (i < spent) return 'spent';
    return i === spent ? 'current' : 'remaining';
  });
}

/** The attempt row's label — how many attempts were used, never how many are left. */
export function attemptsUsedLabel(observed: number): string {
  const spent = Math.max(0, Math.floor(observed));
  return spent === 1 ? 'Tried once' : `Tried ${spent} times`;
}

/** The toast after a restore: "You're on v4 now". */
export function restoredToast(version: string): string {
  return `You’re on ${version} now`;
}

/** The report sheet's collapsed code row (content-reporting "the app's code (its size, with the
 *  full text expandable)"): "482 characters" — never the code itself until expanded. */
export function reportCodeSizeLabel(chars: number): string {
  return chars === 1 ? '1 character' : `${chars} characters`;
}

// ── the refusal notice's retry-window line (service-refusals; design D11) ────
// `service-refusal.ts#retryLine` owns the bucket ARITHMETIC (which of these five applies, and any
// rounding); this module owns only the WORDING, the same split `timelineStageLine` already keeps
// between `prompt-flow.ts`'s counts and its own phrasing.

export function retryLineSeconds(n: number): string {
  return n === 1 ? 'in about 1 second' : `in about ${n} seconds`;
}

export function retryLineMinutes(n: number): string {
  return n === 1 ? 'in about 1 minute' : `in about ${n} minutes`;
}

/** The `Intl`-missing fallback — an hours-only estimate when no formatter could exist to build a
 *  local-time string at all. */
export function retryLineHoursFallback(n: number): string {
  return n === 1 ? 'in about 1 hour' : `in about ${n} hours`;
}

/** The window had already ended by the moment this line was read: naming a bucket ("in about 0
 *  seconds") would just be a stale estimate restated, so this names no number at all. */
export function retryLineElapsed(): string {
  return 'shortly';
}

/** Later the same local day: "after 4:30 PM". `time` is already formatted by the caller's
 *  injected `Intl.DateTimeFormat`-backed formatter. */
export function retryLineSameDay(time: string): string {
  return `after ${time}`;
}

/** Beyond the same local day: "tomorrow after 9:00 AM". */
export function retryLineTomorrow(time: string): string {
  return `tomorrow after ${time}`;
}
