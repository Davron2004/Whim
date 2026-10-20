/**
 * product-verbs guard (task 6.2, spec "The launcher surface speaks product verbs only").
 * Asserts the centralized launcher copy + derived tile visuals carry NO git terminology or
 * mechanism/internal vocabulary, and that the lines `copy.ts` composes from values use the
 * glossary's one name per concept (system.md §8): "Make a copy", never fork; "Use this version",
 * never restore. The `COPY` table's own glossary and first-person lint, by key, is
 * `checks/test/repo/design-system.suite.ts`.
 */

import { Harness } from './harness';
import {
  COPY,
  CONSENT_WHATS_NEW,
  LEGAL_COPY,
  addedFieldsLine,
  appCrashedTitle,
  changedTitle,
  composerContinueLine,
  copyQuestionDataSubtitle,
  crashFixWords,
  deletedToast,
  discardedManyToast,
  editingEyebrow,
  failureCouldntRunLine,
  historyRowMeta,
  historyVersionCount,
  makingQueueLine,
  makingRepairLine,
  makingStallLine,
  makingTitle,
  readyTitle,
  reportCodeLine,
  reportCodeSizeLabel,
  reportRecipientLine,
  reportThanksLine,
  tileOlderLine,
  timelineGrowthLine,
  timelineStageLine,
  versionSwitchToast,
  whimSheetVersionLine,
} from '../copy';
import { monogram, tileColor } from '../tiles';

// Mechanism / git vocabulary that must never reach the launcher surface. A raw lineage id
// ("fork-1") is forbidden here; the word "fork" itself is a retired glossary word (below).
const FORBIDDEN: RegExp[] = [
  /\bgit\b/i, /\bcommit\b/i, /\boid\b/i, /\bsha\b/i, /\bhash\b/i, /\bref\b/i, /\bblob\b/i,
  /\btree\b/i, /gitdir/i, /\bHEAD\b/, /\brealm\b/i, /generation/i, /dispatcher/i, /iframe/i,
  /webview/i, /\blineage\b/i, /\bsnapshot\b/i, /fork-\d/i, /[0-9a-f]{40}/i,
  /\bschema\b/i, /\bdatabase\b/i, /\bstorage\b/i, /\bclone\b/i,
];

// The glossary's retired words (system.md §8; app-launcher "Shell copy has one name per concept").
const RETIRED: RegExp[] = [
  /\bmini[- ]?apps?\b/i, /\bbuil(?:d|ds|ding|t)\b/i, /\bgenerat\w*/i, /\bfork\w*/i, /\bsnapshots?\b/i,
  /\brestor\w*/i, /\brevert\w*/i, /\bprompt again\b/i,
];

const NOW = Date.UTC(2026, 9, 20, 12);
const DAY = 24 * 60 * 60 * 1000;

/** Every line `copy.ts` composes, with the values that make each one say something. */
function composedLines(): string[] {
  return [
    copyQuestionDataSubtitle('Water Counter'),
    deletedToast('Tip Splitter'),
    discardedManyToast(2),
    tileOlderLine(2),
    addedFieldsLine(['notes (text)']),
    makingTitle('Water Counter', true),
    makingTitle('Water Counter', false),
    makingRepairLine(2, 3),
    makingQueueLine(3),
    makingStallLine(40),
    failureCouldntRunLine(3, true),
    readyTitle('Pour Timer'),
    changedTitle('Pour Timer'),
    appCrashedTitle('Pour Timer'),
    crashFixWords('Error: x is undefined'),
    composerContinueLine('A timer for my'),
    editingEyebrow('Water Counter'),
    whimSheetVersionLine(4, NOW - 2 * DAY, NOW),
    historyVersionCount(4),
    historyRowMeta('v4', NOW - 3 * 60 * 60 * 1000, NOW),
    versionSwitchToast(3, 4),
    versionSwitchToast(4, 3),
    reportRecipientLine(),
    reportRecipientLine('devbox:8787'),
    reportCodeLine(),
    reportCodeLine('devbox:8787'),
    reportThanksLine(),
    reportThanksLine('devbox:8787'),
    reportCodeSizeLabel(1204),
    timelineGrowthLine(1204, 300),
    timelineStageLine(COPY.timelineStageGenerate, 1500),
  ];
}

export async function runProductVerbsTests(h: Harness): Promise<void> {
  await h.test('product-verbs: launcher copy carries no mechanism/git vocabulary', async () => {
    const strings: string[] = [
      ...Object.values(COPY),
      ...Object.values(LEGAL_COPY.fr),
      ...Object.values(CONSENT_WHATS_NEW).flatMap((lines) => Object.values(lines).map((line) => line.text)),
      ...composedLines(),
      monogram('Water Counter'),
      tileColor('Water Counter'),
    ];
    for (const str of strings) {
      for (const bad of FORBIDDEN) {
        h.ok(!bad.test(str), `"${str}" must not contain mechanism term ${bad}`);
      }
    }
  });

  await h.test('product-verbs: every line copy.ts composes uses the glossary, never a retired word', async () => {
    const lines = composedLines();
    h.ok(lines.length >= 30 && lines.every((line) => line.length > 0), `the composed lines render (${lines.length})`);
    for (const line of lines) {
      for (const bad of RETIRED) {
        h.ok(!bad.test(line), `"${line}" must not say the retired word ${bad}`);
      }
    }
  });
}
