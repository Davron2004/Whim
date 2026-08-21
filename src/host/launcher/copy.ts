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
  planRowSave: 'Save',
  buildTitle: 'Making it',
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
  forkShareData: 'Use the same saved data',
  forkStartFresh: 'Start fresh',

  // ── inside a running app: the orb menu (3a) ─────────────────────────────────
  // `versions` opens the real History screen and `change` opens the real compose step (review
  // fix-pass, shell-redesign-v2) — there is no orb-local sheet left to title, so those two keys
  // and the placeholder `copy` action's label are gone with it.
  orbActionChangeIt: 'Change it',
  orbActionHome: 'Home',
  orbActionVersions: 'Versions',
  orbMenuOpenLabel: 'Open the app menu',
  orbMenuCloseLabel: 'Close the app menu',
  orbMenuDismissLabel: 'Dismiss the app menu',

  // ── failure surfaces ────────────────────────────────────────────────────────
  launchFailedTitle: 'Couldn’t open this app',
  launchFailedBody:
    'Something about this app doesn’t match what’s already saved here, so it can’t open right now.',
  launchFailedBack: 'Back to your apps',
  appErrorTitle: 'This app ran into a problem',
  appErrorBody: 'It stopped and can’t carry on right now. Try again, or go back to your apps.',
  appErrorRetry: 'Try again',
  failureTitle: 'Couldn’t build this app',
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
  // The `3b` failure checklist (obs-v1) — the two rows the screen writes itself. Every other row
  // is a diagnostic's own `hint`, so no mechanism vocabulary can reach the panel.
  failureRecoveredTitle: 'Fixed it',
  failureRowLastVersionWorks: 'The version you already had still works and is still installed',
  failureRowSayItDifferently: 'Describing it differently usually gets past this',

  // ── settings ────────────────────────────────────────────────────────────────
  serverAddressSectionTitle: 'Server address',
  // v1 is LAN-dev/personal-use only (design D3, prompt-flow-ux) — the address is an
  // unauthenticated LAN address the user enters themselves, not a security boundary.
  // eslint-disable-next-line sonarjs/no-clear-text-protocols
  serverAddressPlaceholder: 'http://192.168.1.20:4000',
  serverAddressHint: 'Where Whim sends your prompts to build apps.',
  promptServerUnconfigured: 'Set your server’s address in Settings before making an app.',
  promptOpenSettings: 'Open Settings',
} as const;

/** "Forked from Water Counter" — fork provenance for a tile (product vocabulary). */
export function forkedFromLabel(name: string): string {
  return `Forked from ${name}`;
}

/** A ghost/rebuild tile's state caption, by `PendingBuildRecord.state` (kept as the bare literal
 *  union rather than importing `PendingBuildState` — `copy.ts` stays free of any non-`react` /
 *  non-`react-native` module dependency). */
export function ghostStateCaption(state: 'building' | 'failed' | 'interrupted'): string {
  if (state === 'building') return COPY.ghostCaptionBuilding;
  if (state === 'failed') return COPY.ghostCaptionFailed;
  return COPY.ghostCaptionInterrupted;
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

/**
 * The build screen's activity line: how long the attempt has been running, and how much output has
 * come back so far. `elapsed` is the `m:ss` clock; `chars` is a cumulative character COUNT — a
 * size, never any of the generated text itself.
 */
export function buildActivityLine(elapsed: string, chars: number): string {
  const written = chars === 1 ? '1 character' : `${chars} characters`;
  return `${elapsed} · ${written} so far`;
}

/** The stall heartbeat's statement, shown only once the quiet threshold has been exceeded. */
export function buildQuietLine(seconds: number): string {
  return `Quiet for ${seconds}s`;
}

// ── the run timeline's lines (generation-observability, design D7) ───────────
// The timeline's rows ARE copy — which words a stage reads as, how a duration is written — so they
// live here beside the checklist rows, in the one module the launcher's Node suite can import.

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
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

/** The output-growth row: a cumulative character COUNT — a size, never any of the text itself. */
export function timelineGrowthLine(chars: number): string {
  return chars === 1 ? '1 character written' : `${chars} characters written`;
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
