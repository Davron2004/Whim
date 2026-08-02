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
  createTileLabel: 'make your first app',
  actionOpen: 'Open',
  actionFork: 'Fork',
  actionPromptAgain: 'Prompt again',
  actionDelete: 'Delete',
  cancel: 'Cancel',
  deleteTitle: 'Delete this app?',
  deleteConfirm: 'Delete',
  emptyTitle: 'No apps yet',
  emptyBody: 'Tap “make your first app” to get started.',
  settingsTitle: 'Settings',
  backLabel: 'Back',
  highlightingSectionTitle: 'Highlighting',
  highlightingHint: 'Colours and marks in what Whim tells you.',

  // ── the five-step prompt flow (2a) ──────────────────────────────────────────
  /** Every forward step's primary action while its request is in flight. Never a bare spinner. */
  flowBusy: 'One moment',
  flowContinue: 'Continue',
  composeHeadline: 'What should it do?',
  composeHelper: 'Plain words are enough. Whim will ask if something is unclear.',
  composeChipsEyebrow: 'Or start from',
  composeChipTimer: 'a timer with my pour-over recipe',
  composeChipTracker: 'a tracker for how often I water the plants',
  composeChipDice: 'a dice roller for game night',
  clarifyHeadlineOne: 'One quick thing',
  clarifyHeadlineTwo: 'Two quick things',
  clarifyHeadlineThree: 'Three quick things',
  clarifyHelper: 'Skip these and Whim will pick sensible answers.',
  planHeadline: 'Here’s the plan',
  planSubhead: 'Tap anything to change it before building.',
  planFooter: 'Nothing here is final — you can keep changing the app after it’s built.',
  planBuild: 'Build it',
  buildTitle: 'Making it',
  buildSubtitle: 'This takes about a minute. You can leave and come back.',
  buildStepReading: 'Reading your plan',
  buildStepWriting: 'Writing the app',
  buildStepChecking: 'Checking it runs safely',
  buildStepInstalling: 'Putting it on your home screen',
  buildLeaveRunning: 'Leave it running',
  doneBody: 'It’s on your home screen. Open it, or tell Whim what to change.',
  doneOpen: 'Open it',
  doneBackToApps: 'Back to your apps',

  // ── history (4a) ────────────────────────────────────────────────────────────
  actionHistory: 'History',
  historyTitle: 'History',
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
  forkShareData: 'Use the same saved data',
  forkStartFresh: 'Start fresh',

  // ── inside a running app: the orb menu (3a) ─────────────────────────────────
  orbActionChangeIt: 'Change it',
  orbActionHome: 'Home',
  orbActionVersions: 'Versions',
  orbActionCopy: 'Copy',
  orbClose: 'Close',
  orbVersionsTitle: 'How it changed',
  orbChangeTitle: 'What should change?',
  orbChangeFooter: 'Whim keeps this version until the new one works.',
  orbHomeToast: 'Back on your home screen',

  // ── failure surfaces ────────────────────────────────────────────────────────
  launchFailedTitle: 'Couldn’t open this app',
  launchFailedBody:
    'Something about this app doesn’t match what’s already saved here, so it can’t open right now.',
  launchFailedBack: 'Back to your apps',
  failureTitle: 'Couldn’t build this app',
  failureHintsTitle: 'What to try',
  failureRephrase: 'Try rephrasing',
  failureDismiss: 'Back to your apps',

  // ── settings ────────────────────────────────────────────────────────────────
  serverAddressSectionTitle: 'Server address',
  // v1 is LAN-dev/personal-use only (design D3, prompt-flow-ux) — the address is an
  // unauthenticated LAN address the user enters themselves, not a security boundary.
  // eslint-disable-next-line sonarjs/no-clear-text-protocols
  serverAddressPlaceholder: 'http://192.168.1.20:4000',
  serverAddressHint: 'Where Whim sends your prompts to build apps.',
  promptServerUnconfigured: 'Set your server’s address in Settings before making an app.',
  promptOpenSettings: 'Open Settings',

  // ── retiring with the surfaces they belong to ───────────────────────────────
  // The two-stage prompt flow (`PromptScreen`/`RewritePreviewScreen`/`GeneratingScreen`) and the
  // pin/instant-restore history surface are replaced by this redesign. Their strings stay until
  // the chain that deletes each screen deletes them with it — a key removed ahead of its screen
  // is a typecheck break, not a cleanup.
  promptTitleNew: 'Describe your app',
  promptTitleEdit: 'Prompt again',
  promptPlaceholder: 'What should this app do?',
  promptDictationHint: 'Tip: tap the microphone on your keyboard to speak instead of typing.',
  promptSubmit: 'Continue',
  rewritePreviewTitle: 'Review before building',
  rewritePreviewOriginalLabel: 'You said',
  rewritePreviewApprove: 'Build it',
  generatingTitle: 'Building your app',
  generatingWaiting: 'Getting started…',
  generatingStagePlan: 'Planning',
  generatingStageGenerate: 'Writing the code',
  generatingStageCheck: 'Checking the code',
  generatingStageRun: 'Trying it out',
  generatingStageRepair: 'Fixing a problem',
  generatingCancel: 'Cancel',
  historyCurrentLabel: 'Current version',
  historyRestoredToast: 'Restored this version',
  historyUndo: 'Undo',
  historyPinAction: 'Pin this version…',
  historyPinPlaceholder: 'Label',
  historyPinSave: 'Save',
  historyForkAction: 'Make this version its own app',
  historyMoreLabel: 'More',
} as const;

/** "Forked from Water Counter" — fork provenance for a tile (product vocabulary). */
export function forkedFromLabel(name: string): string {
  return `Forked from ${name}`;
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

/** The clarify step's headline, counted: one, two or three quick things. */
export function clarifyHeadline(questionCount: number): string {
  if (questionCount <= 1) return COPY.clarifyHeadlineOne;
  if (questionCount === 2) return COPY.clarifyHeadlineTwo;
  return COPY.clarifyHeadlineThree;
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

/** The toast after a restore: "You're on v4 now". */
export function restoredToast(version: string): string {
  return `You’re on ${version} now`;
}
