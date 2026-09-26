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
import type { WideningId } from '@whim/contract';
import type { LegalLanguage } from './legal-language';

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
  /** Under a question that takes several picks (beta-1 D18). */
  clarifyPickMany: 'Pick any that fit.',
  /** The pill every question carries, which hands that question to Whim (beta-1 D18). */
  clarifyDecide: 'Decide for me',
  /** The typed "Other" answer's placeholder, on a question that allows one. */
  clarifyOtherPlaceholder: 'Or type your own answer',
  /** The clarify step when the request can't be built as asked (beta-1 D9): the reason follows in
   *  the server's own words, then the alternative to build instead (`clarifyBuildInstead`). */
  clarifyLimitHeadline: 'Whim can’t build this as asked',
  clarifyLimitChangeIdea: 'Change my idea',
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
  /** The build screen while every build slot is taken and this one is first in line (beta-1 D8);
   *  further back, `buildQueuedLine` counts the builds ahead. */
  buildQueuedNext: 'You’re next in line.',
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
  reportDeviceIdLine: 'This phone’s Whim ID goes with your report. The report goes to AnyCognition, the company that makes Whim.',
  reportSend: 'Send report',
  reportSendBusy: 'One moment',
  reportShowMore: 'Show more',
  reportShowLess: 'Show less',
  reportThanksTitle: 'Thanks. We’ll look into it.',
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

  // ── AI-data consent (ai-data-consent, consent version 2; legal-surface-v2) ───
  // The consent screen's disclosure, shared verbatim between ask and review mode (design D5) —
  // only the bottom actions below differ by mode. Screen order is `ConsentScreen.tsx`'s; which key
  // carries each manifest category and recipient role is `CONSENT_SCREEN_COVERAGE` below.
  consentTitle: 'Before Whim builds apps for you',
  consentLead:
    'To build or change an app, Whim sends what you ask for to our server. AI companies that work for us write the code.',
  consentSentTitle: 'What gets sent',
  consentSentRequest: 'What you ask for: your description, your answers and the plan you approve',
  consentSentEdit: 'When you change an app: its name, code and description, and the layout of its data, never the data itself',
  consentSentDevice: 'An ID Whim makes for this phone, used for daily limits and usage totals.',
  consentSentErrors: 'Error details when something goes wrong. They’re technical only, not what you typed or saved.',
  consentWhyTitle: 'Why',
  consentWhy: 'To build your apps and run Whim: daily limits, stopping abuse, keeping costs in check, and finding and fixing problems.',
  consentWhoTitle: 'Who gets it',
  // "Who gets it" is one paragraph on screen, kept as one key per screen-named recipient role so
  // the coverage check can tell a dropped role from a reworded one.
  consentWho:
    'AnyCognition, the company that makes Whim, and companies that do work for us, like cloud hosting and AI providers. Some of them are outside Canada. They can’t train AI on it or use it for their own products, though some may keep it for a short time for security and legal reasons.',
  consentWhoPlatform: 'Apple or Google may also check that requests come from the real Whim app.',
  consentWhoAuthorities: 'We give information to authorities when the law requires it.',
  consentStaysTitle: 'What you save in your apps',
  // Says what Whim does with saved data, not where it can go: "It stays on your phone" may return
  // once platform-release-readiness 13.6/13.7 (the network-deny device runs, legal-surface-v2 task
  // 11.8) pass. Wording only: the consent version doesn't move.
  consentStays:
    'Nobody at Whim can read it. Whim doesn’t send it anywhere, and anything Whim ever syncs or backs up for you is encrypted on your phone with a key Whim never has.',
  consentNeverTitle: 'What we never do',
  consentNever: 'Show ads, sell your data or share it for advertising, or track you across other apps and websites.',
  consentAskFirst:
    'If we ever want to collect a new kind of information, use it for a new purpose, keep it longer, or give it to a new kind of company, we’ll ask you first.',
  consentFootnote: 'You can turn AI features and error details off in Settings. Apps you already have keep working either way.',
  // Shown above the title only when the stored grant is outdated, followed by that grant version's
  // `CONSENT_WHATS_NEW` line (spec "Consent grants are versioned").
  consentOutdatedLine: 'This has changed since you last agreed.',
  consentAgree: 'Agree and continue',
  consentDecline: 'Not now',
  // ── refusals about this phone itself (request-envelope; design D5/D7) ──────
  // What the phone says for these two refusals in place of the server's hint
  // (`service-refusal.ts#REFUSAL_RULES`). The permission line also heads the consent screen a
  // `consent_required` refusal opens, so the user knows why it is back. It is screen chrome, not
  // disclosure, so its key stays off the `consent` prefix the privacy page must quote verbatim
  // (`server/test/web-site.suite.ts`).
  updateRequiredLine: 'Update Whim to keep making and changing apps.',
  permissionRequiredLine: 'Whim needs your permission again before it can send this.',
  // The update screen (app-update-gate; design D5): what an `update_required` refusal or a build
  // below the launch-time minimum opens. It blocks the AI features only, so it says the apps stay.
  updateTitle: 'Whim needs an update',
  updateBody: 'Making and changing apps needs the latest version of Whim. The apps you already have keep working.',
  updateAction: 'Update Whim',
  updateNotNow: 'Not now',
  // Review mode's action set (spec "Settings shows consent and can review or turn it off"): the
  // large button is always the safe one — keeping AI features on, or turning them on from off.
  consentReviewKeepOn: 'Keep AI features on',
  consentReviewTurnOff: 'Turn off AI features',
  consentReviewTurnOn: 'Turn on AI features',
  // Shared by every privacy policy link (the consent screen, the report sheet, the Settings About
  // row) — one key, so they can never read differently.
  privacyPolicyLabel: 'Privacy policy',
  supportLabel: 'Support',
  // The Settings About row that opens the terms of use (terms-acceptance "The terms are reachable
  // from Settings").
  termsOfUseLabel: 'Terms of use',

  // ── terms step (terms-acceptance; legal-surface-v2 design D5) ───────────────
  // Shown before the consent screen while the terms aren't accepted. It says nothing about data:
  // what is sent, to whom and why is the consent screen's alone (Play's prominent-disclosure rule).
  termsTitle: 'Terms of use',
  termsLead:
    'Whim’s AI features come with a few rules: what you can build, what AI gets wrong, and what we’re responsible for.',
  // Shown in place of `termsLead` when the stored acceptance is of another terms version.
  termsUpdatedLine: 'We’ve updated the terms of use.',
  termsLabel: 'Read the terms of use',
  termsAccept: 'Accept',
  termsDecline: 'Not now',
  // ── store age check (store-age-signals; legal-surface-v2 design D11) ─────────
  // Shown in place of the terms step when the store says the user is a minor without a parent's
  // approval (`ageBlocked*`) or under 13 (`ageUnder13*`). The AI features stay off; the apps on
  // the phone keep working. `ageBack` also leaves the brief screen shown while the store is asked.
  ageBlockedTitle: 'A parent needs to approve Whim',
  ageBlockedBody:
    'Whim’s AI features need a parent’s approval on this account. A parent can approve Whim through the App Store or Google Play, then you can try again. The apps you already have keep working.',
  ageUnder13Title: 'Whim’s AI features are for people 13 and over',
  ageUnder13Body:
    'The App Store or Google Play says this account belongs to someone under 13, so Whim can’t make new apps for you. The apps you already have keep working.',
  ageBack: 'Back',
  // The one-tap switch the terms step and the consent screen show (legal-text-localization): it
  // names the OTHER language, in that language, so English's own entry is the French label.
  legalLanguageSwitch: 'Continuer en français',

  // ── settings ────────────────────────────────────────────────────────────────
  settingsAISectionTitle: 'AI features',
  settingsAIOff: 'Off',
  settingsAboutSectionTitle: 'About',
  settingsAdvancedSectionTitle: 'Advanced',
  settingsUseDefaultServer: 'Use Whim’s server',
  // AI features section (legal-surface-v2 design D10; spec privacy-settings).
  settingsErrorDetailsTitle: 'Send error details',
  settingsErrorDetailsHint: 'When something goes wrong, Whim sends technical details so we can fix it. Not what you typed or saved.',
  // About section: the ID sent as `x-whim-device`, and the confirm step before replacing it.
  settingsDeviceIdTitle: 'This phone’s ID',
  settingsDeviceIdHint: 'The ID Whim made for this phone. Include it if you ask us about your data.',
  settingsDeviceIdReset: 'Make a new ID',
  settingsDeviceIdResetConfirm:
    'Whim will use a new ID from now on. Records tied to the old one are kept for up to 12 months, then deleted. Write to us if you want them deleted sooner.',
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

  // ── the keyboard (beta-1 D3) ────────────────────────────────────────────────
  /** The iOS keyboard bar's one action on a multiline field: puts the keyboard away and submits
   *  nothing. */
  keyboardDone: 'Done',
} as const;

/** One what's-new line (legal-surface-v2 design D4): shown under `consentOutdatedLine` when the
 *  stored grant is from an older consent version. `covers` maps every widening from that version to
 *  the current one to the phrase of `text` that names it; the disclosure release check fails unless
 *  the ids equal the manifest's widenings and every phrase occurs in `text`. */
export interface ConsentWhatsNewLine {
  readonly text: string;
  readonly covers: Readonly<Record<string, string>>;
}

/** `phrase` as the covering phrase of every id in `ids`: one sentence often names several widenings. */
function naming(phrase: string, ids: readonly WideningId[]): Readonly<Record<string, string>> {
  return Object.fromEntries(ids.map((id) => [id, phrase]));
}

/** Widenings since consent version 1 that repeat per category: for each of the five categories
 *  version 1 already sent, version 2 adds a legal purpose, the authorities, a new owner and the
 *  companies that run Whim's servers, logs and email. */
const V1_CATEGORIES = ['connection-logs', 'phone-id', 'reports', 'request-material', 'usage-records'] as const;
const LEGAL_SINCE_V1 = V1_CATEGORIES.map((c): WideningId => `purpose:${c}:legal`);
const AUTHORITIES_SINCE_V1: readonly WideningId[] = ['role:authorities', ...V1_CATEGORIES.map((c): WideningId => `recipient:${c}:authorities`)];
const SUCCESSOR_SINCE_V1: readonly WideningId[] = ['role:successor', ...V1_CATEGORIES.map((c): WideningId => `recipient:${c}:successor`)];
const HOSTING_SINCE_V1: readonly WideningId[] = ['role:hosting-providers', ...V1_CATEGORIES.map((c): WideningId => `recipient:${c}:hosting-providers`)];

/** Language → the consent version a grant was given under → its what's-new line. Kept beside
 *  `COPY` rather than in it: every `COPY` value is a string its readers iterate as one. Each
 *  language names every widening in its own words, so each has its own `covers` phrases. */
export const CONSENT_WHATS_NEW: Readonly<Record<string, Readonly<Record<number, ConsentWhatsNewLine>>>> = {
  en: {
    1: {
      text: 'New: error details when something goes wrong, and checks by Apple or Google that requests come from the real Whim app. We may keep reports for up to 12 months, and usage records for up to 12 months after last use, instead of 90 days. We now also say that companies that run our servers, logs and email handle your requests, your phone ID, usage records, connection logs and reports; that we use your requests, usage records and connection logs to run Whim and keep it safe; and when we’d share data with authorities, because the law requires it or for fraud, security or safety problems, or with a new owner if Whim changes hands.',
      covers: {
        'category:error-details': 'error details when something goes wrong',
        'category:app-integrity': 'checks by Apple or Google that requests come from the real Whim app',
        'role:platform': 'checks by Apple or Google',
        'keep:reports': 'keep reports for up to 12 months',
        'keep:usage-records': 'usage records for up to 12 months after last use',
        ...naming('companies that run our servers, logs and email handle your requests, your phone ID, usage records, connection logs and reports', HOSTING_SINCE_V1),
        'purpose:request-material:operate': 'we use your requests',
        'purpose:usage-records:operate': 'usage records and connection logs to run Whim',
        'purpose:usage-records:safety': 'usage records and connection logs to run Whim and keep it safe',
        'purpose:connection-logs:operate': 'connection logs to run Whim',
        'purpose:connection-logs:safety': 'connection logs to run Whim and keep it safe',
        ...naming('share data with authorities', AUTHORITIES_SINCE_V1),
        ...naming('because the law requires it', LEGAL_SINCE_V1),
        ...naming('with a new owner if Whim changes hands', SUCCESSOR_SINCE_V1),
      },
    },
  },
  fr: {
    1: {
      text: 'Nouveau\u00a0: les détails d’erreur quand quelque chose ne va pas, et les vérifications par Apple ou Google que les demandes proviennent de la véritable app Whim. Nous pouvons conserver les signalements jusqu’à 12 mois, et les registres d’utilisation jusqu’à 12 mois après la dernière utilisation, au lieu de 90 jours. Nous précisons aussi maintenant que des entreprises qui exploitent nos serveurs, nos journaux et nos courriels traitent vos demandes, l’identifiant de votre téléphone, les registres d’utilisation, les données de connexion et les signalements\u00a0; que nous utilisons vos demandes, les registres d’utilisation et les données de connexion pour faire fonctionner Whim et le garder sûr\u00a0; et dans quels cas nous communiquerions des renseignements aux autorités, parce que la loi l’exige ou pour des problèmes de fraude, de sécurité ou de sûreté, ou à un nouveau propriétaire si Whim change de mains.',
      covers: {
        'category:error-details': 'détails d’erreur quand quelque chose ne va pas',
        'category:app-integrity': 'vérifications par Apple ou Google que les demandes proviennent de la véritable app Whim',
        'role:platform': 'vérifications par Apple ou Google',
        'keep:reports': 'conserver les signalements jusqu’à 12 mois',
        'keep:usage-records': 'registres d’utilisation jusqu’à 12 mois après la dernière utilisation',
        ...naming(
          'des entreprises qui exploitent nos serveurs, nos journaux et nos courriels traitent vos demandes, l’identifiant de votre téléphone, les registres d’utilisation, les données de connexion et les signalements',
          HOSTING_SINCE_V1,
        ),
        'purpose:request-material:operate': 'nous utilisons vos demandes',
        'purpose:usage-records:operate': 'registres d’utilisation et les données de connexion pour faire fonctionner Whim',
        'purpose:usage-records:safety': 'registres d’utilisation et les données de connexion pour faire fonctionner Whim et le garder sûr',
        'purpose:connection-logs:operate': 'données de connexion pour faire fonctionner Whim',
        'purpose:connection-logs:safety': 'données de connexion pour faire fonctionner Whim et le garder sûr',
        ...naming('communiquerions des renseignements aux autorités', AUTHORITIES_SINCE_V1),
        ...naming('parce que la loi l’exige', LEGAL_SINCE_V1),
        ...naming('à un nouveau propriétaire si Whim change de mains', SUCCESSOR_SINCE_V1),
      },
    },
  },
};

/** The keys the age-check screen, the terms step and the consent screen read from the active legal
 *  language's table (spec terms-acceptance "Terms are accepted in their own step…"; spec
 *  ai-data-consent "The disclosure names what is sent…"; spec legal-text-localization "Every legal
 *  copy key exists in both languages"). A runtime list, so the coverage check can require each one
 *  in every table. */
export const LEGAL_COPY_KEYS = [
  'termsTitle',
  'termsLead',
  'termsUpdatedLine',
  'termsLabel',
  'termsAccept',
  'termsDecline',
  'ageBlockedTitle',
  'ageBlockedBody',
  'ageUnder13Title',
  'ageUnder13Body',
  'ageBack',
  'consentTitle',
  'consentLead',
  'consentSentTitle',
  'consentSentRequest',
  'consentSentEdit',
  'consentSentDevice',
  'consentSentErrors',
  'consentWhyTitle',
  'consentWhy',
  'consentWhoTitle',
  'consentWho',
  'consentWhoPlatform',
  'consentWhoAuthorities',
  'consentStaysTitle',
  'consentStays',
  'consentNeverTitle',
  'consentNever',
  'consentAskFirst',
  'consentFootnote',
  'consentOutdatedLine',
  'consentAgree',
  'consentDecline',
  'consentReviewKeepOn',
  'consentReviewTurnOff',
  'consentReviewTurnOn',
  'permissionRequiredLine',
  'privacyPolicyLabel',
  'legalLanguageSwitch',
] as const;

type LegalCopyKey = (typeof LEGAL_COPY_KEYS)[number];

/** One legal language's table: every legal key, as a string. English is `COPY` itself; another
 *  language supplies a table of just these keys. */
export type LegalCopyTable = { readonly [K in LegalCopyKey]: string };

/** The French legal table (legal-surface-v2 design D6): Canadian French, "vous", plain register.
 *  Every `consent` key the privacy page must quote is quoted word for word by `/fr/privacy`
 *  (`server/test/web-site.suite.ts`). A non-breaking space goes before a colon, so the colon
 *  never starts a line. */
const FRENCH: LegalCopyTable = {
  termsTitle: 'Conditions d’utilisation',
  termsLead:
    'Les fonctions d’IA de Whim s’accompagnent de quelques règles\u00a0: ce que vous pouvez créer, là où l’IA se trompe et ce dont nous sommes responsables.',
  termsUpdatedLine: 'Nous avons mis à jour les conditions d’utilisation.',
  termsLabel: 'Lire les conditions d’utilisation',
  termsAccept: 'Accepter',
  termsDecline: 'Pas maintenant',
  ageBlockedTitle: 'Un parent doit approuver Whim',
  ageBlockedBody:
    'Les fonctions d’IA de Whim nécessitent l’approbation d’un parent pour ce compte. Un parent peut approuver Whim dans l’App Store ou Google Play, puis vous pourrez réessayer. Les apps que vous avez déjà continuent de fonctionner.',
  ageUnder13Title: 'Les fonctions d’IA de Whim sont réservées aux personnes de 13\u00a0ans et plus',
  ageUnder13Body:
    'Selon l’App Store ou Google Play, ce compte appartient à une personne de moins de 13\u00a0ans, donc Whim ne peut pas créer de nouvelles apps pour vous. Les apps que vous avez déjà continuent de fonctionner.',
  ageBack: 'Retour',
  consentTitle: 'Avant que Whim crée des apps pour vous',
  consentLead:
    'Pour créer ou modifier une app, Whim envoie ce que vous demandez à notre serveur. Des entreprises d’IA qui travaillent pour nous écrivent le code.',
  consentSentTitle: 'Ce qui est envoyé',
  consentSentRequest: 'Ce que vous demandez\u00a0: votre description, vos réponses et le plan que vous approuvez',
  consentSentEdit:
    'Lorsque vous modifiez une app\u00a0: son nom, son code et sa description, et la structure de ses données, jamais les données elles-mêmes',
  consentSentDevice: 'Un identifiant que Whim crée pour ce téléphone, utilisé pour les limites quotidiennes et les totaux d’utilisation.',
  consentSentErrors:
    'Des détails d’erreur quand quelque chose ne va pas. Ils sont uniquement techniques, jamais ce que vous avez tapé ou enregistré.',
  consentWhyTitle: 'Pourquoi',
  consentWhy:
    'Pour créer vos apps et faire fonctionner Whim\u00a0: limites quotidiennes, prévention des abus, maîtrise des coûts, et détection et correction des problèmes.',
  consentWhoTitle: 'Qui les reçoit',
  consentWho:
    'AnyCognition, l’entreprise qui conçoit Whim, et des entreprises qui travaillent pour nous, comme des hébergeurs infonuagiques et des fournisseurs d’IA. Certaines sont à l’extérieur du Canada. Elles ne peuvent pas utiliser ces renseignements pour entraîner des modèles d’IA ni pour leurs propres produits, mais certaines peuvent les conserver brièvement pour des raisons de sécurité ou juridiques.',
  consentWhoPlatform: 'Apple ou Google peuvent aussi vérifier que les demandes proviennent de la véritable app Whim.',
  consentWhoAuthorities: 'Nous communiquons des renseignements aux autorités lorsque la loi l’exige.',
  consentStaysTitle: 'Ce que vous enregistrez dans vos apps',
  consentStays:
    'Personne chez Whim ne peut le lire. Whim ne l’envoie nulle part, et tout ce que Whim pourrait un jour synchroniser ou sauvegarder pour vous est chiffré sur votre téléphone avec une clé que Whim n’a jamais.',
  consentNeverTitle: 'Ce que nous ne faisons jamais',
  consentNever:
    'Afficher des publicités, vendre vos données ou les communiquer à des fins publicitaires, ou vous suivre dans d’autres apps et sites Web.',
  consentAskFirst:
    'Si nous voulons un jour recueillir un nouveau type de renseignements, les utiliser à une nouvelle fin, les conserver plus longtemps ou les confier à un nouveau type d’entreprise, nous vous le demanderons d’abord.',
  consentFootnote:
    'Vous pouvez désactiver les fonctions d’IA et les détails d’erreur dans les réglages de Whim (Settings). Les apps que vous avez déjà continuent de fonctionner dans les deux cas.',
  consentOutdatedLine: 'Ce texte a changé depuis que vous l’avez accepté.',
  consentAgree: 'Accepter et continuer',
  consentDecline: 'Pas maintenant',
  consentReviewKeepOn: 'Garder les fonctions d’IA activées',
  consentReviewTurnOff: 'Désactiver les fonctions d’IA',
  consentReviewTurnOn: 'Activer les fonctions d’IA',
  permissionRequiredLine: 'Whim a de nouveau besoin de votre permission pour envoyer ceci.',
  privacyPolicyLabel: 'Politique de confidentialité',
  legalLanguageSwitch: 'Continue in English',
};

/** Every legal language's copy table. The terms step and the consent screen read
 *  `LEGAL_COPY[language]` for the launcher's active legal language; the consent coverage check
 *  (`checks/test/repo/consent-coverage.suite.ts`) reads every table here. */
export const LEGAL_COPY: Readonly<Record<LegalLanguage, LegalCopyTable>> = { en: COPY, fr: FRENCH };

/** Which keys put each disclosure-manifest category and recipient role on the consent screen
 *  (legal-surface-v2 design D4). Plain manifest ids: the app never imports the manifest. The
 *  coverage check requires an entry for every on-screen category and screen-named role of the
 *  current manifest, each key non-empty in every `LEGAL_COPY` table; the consent UI suite requires
 *  the screen to render every key named here. */
export const CONSENT_SCREEN_COVERAGE: {
  readonly categories: Readonly<Record<string, readonly LegalCopyKey[]>>;
  readonly roles: Readonly<Record<string, readonly LegalCopyKey[]>>;
} = {
  categories: {
    'request-material': ['consentSentRequest', 'consentSentEdit'],
    'phone-id': ['consentSentDevice'],
    'error-details': ['consentSentErrors'],
  },
  roles: {
    anycognition: ['consentWho'],
    'ai-providers': ['consentWho'],
    'hosting-providers': ['consentWho'],
    platform: ['consentWhoPlatform'],
    authorities: ['consentWhoAuthorities'],
  },
};

/** The what's-new line for a grant given under `grantVersion`, in `language`, or `undefined` when
 *  that version has none (a grant from a newer build than this one). */
export function consentWhatsNewText(language: LegalLanguage, grantVersion: number): string | undefined {
  return CONSENT_WHATS_NEW[language]?.[grantVersion]?.text;
}

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
    // en-CA, not the phone's locale (#89): this is English copy, and a French-locale phone would
    // otherwise render the count with a non-breaking space and no comma (e.g. "1 204").
    return `Writing · ${s.aggregates.chars.toLocaleString('en-CA')} characters`;
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

/** The build screen's place in line (beta-1 D8), from the `queued` event's `position` — the builds
 *  ahead plus one: "You’re next in line." at the front, otherwise how many builds are ahead. */
export function buildQueuedLine(position: number): string {
  const ahead = position - 1;
  if (ahead < 1) return COPY.buildQueuedNext;
  return ahead === 1 ? 'You’re in line, 1 build ahead.' : `You’re in line, ${ahead} builds ahead.`;
}

/** The limit step's primary action (beta-1 D9): the alternative clarify suggested, as plain words. */
export function clarifyBuildInstead(alternative: string): string {
  return `Build ${alternative} instead`;
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
 * about — then one row per diagnostic hint, then the advisory line, OMITTED when rewording can't
 * get past the failure (`rephraseHelps: false`: a refusal, a message this build can't use).
 */
export function failureChecklistRows(input: {
  readonly diagnostics: readonly { hint: string }[];
  readonly hasWorkingVersion: boolean;
  readonly rephraseHelps?: boolean;
}): readonly FailureRow[] {
  const rows: FailureRow[] = [];
  if (input.hasWorkingVersion) rows.push({ kind: 'done', text: COPY.failureRowLastVersionWorks });
  for (const diagnostic of input.diagnostics) rows.push({ kind: 'bad', text: diagnostic.hint });
  if (input.rephraseHelps !== false) rows.push({ kind: 'wait', text: COPY.failureRowSayItDifferently });
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
