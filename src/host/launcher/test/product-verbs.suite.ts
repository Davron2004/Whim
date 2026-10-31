/**
 * product-verbs guard (task 6.2, spec "The launcher surface speaks product verbs only").
 * Asserts the centralized launcher copy + derived tile visuals carry NO git terminology or
 * mechanism/internal vocabulary, and that the lines `copy.ts` composes from values use the
 * glossary's one name per concept (system.md §8): "Make a copy", never fork; "Use this version",
 * never restore. The `COPY` table's own glossary and first-person lint, by key, is
 * `checks/test/repo/design-system.suite.ts`.
 */

import { Harness } from './harness';
import * as copyModule from '../copy';
import {
  COMPOSED_KINDS,
  COPY,
  CONSENT_WHATS_NEW,
  LEGAL_COPY,
  addedFieldsLine,
  appCrashedTitle,
  changedTitle,
  composeHeadline,
  composePlaceholder,
  composerContinueLine,
  copyQuestionDataSubtitle,
  crashFixWords,
  deletedToast,
  discardedManyToast,
  editingEyebrow,
  failureCouldntRunLine,
  historyQuotedPrompt,
  historyRowMeta,
  historyVersionCount,
  makingQueueLine,
  makingRepairLine,
  makingStallLine,
  makingTitle,
  planHeadline,
  planMakeHeader,
  quotedWords,
  readyTitle,
  reportCodeLine,
  reportCodeSizeLabel,
  reportRecipientLine,
  reportThanksLine,
  retryLineElapsed,
  retryLineHoursFallback,
  retryLineMinutes,
  retryLineSameDay,
  retryLineSeconds,
  retryLineTomorrow,
  serverProbeLabel,
  tileOlderLine,
  timelineDurationLabel,
  timelineGrowthLine,
  timelineStageLabel,
  timelineStageLine,
  versionSwitchToast,
  whimSheetVersionLine,
  workingPlanPhrase,
} from '../copy';
import { tileColor } from '../tiles';
import { lineFindings } from '../../../../checks/test/repo/copy-glossary';

// Mechanism / git vocabulary that must never reach the launcher surface. A raw lineage id
// ("fork-1") is forbidden here; the word "fork" itself is a retired glossary word (below).
const FORBIDDEN: RegExp[] = [
  /\bgit\b/i, /\bcommit\b/i, /\boid\b/i, /\bsha\b/i, /\bhash\b/i, /\bref\b/i, /\bblob\b/i,
  /\btree\b/i, /gitdir/i, /\bHEAD\b/, /\brealm\b/i, /generation/i, /dispatcher/i, /iframe/i,
  /webview/i, /\blineage\b/i, /\bsnapshot\b/i, /fork-\d/i, /[0-9a-f]{40}/i,
  /\bschema\b/i, /\bdatabase\b/i, /\bstorage\b/i, /\bclone\b/i,
];

const NOW = Date.UTC(2026, 9, 20, 12);
const DAY = 24 * 60 * 60 * 1000;

/** Every line `copy.ts` composes, by the function that composes it, with the values that make each
 *  one say something. */
function composedLines(): Readonly<Record<string, readonly string[]>> {
  return {
    copyQuestionDataSubtitle: [copyQuestionDataSubtitle('Water Counter')],
    deletedToast: [deletedToast('Tip Splitter')],
    discardedManyToast: [discardedManyToast(2)],
    tileOlderLine: [tileOlderLine(2)],
    serverProbeLabel: (['verified', 'unverified', 'unreachable'] as const).map(serverProbeLabel),
    addedFieldsLine: [addedFieldsLine(['notes (text)'])],
    makingTitle: [makingTitle('Water Counter', true), makingTitle('Water Counter', false)],
    makingRepairLine: [makingRepairLine(2, 3)],
    makingQueueLine: [makingQueueLine(3)],
    makingStallLine: [makingStallLine(40)],
    failureCouldntRunLine: [failureCouldntRunLine(3, true), failureCouldntRunLine(3, false)],
    readyTitle: [readyTitle('Pour Timer')],
    changedTitle: [changedTitle('Pour Timer')],
    appCrashedTitle: [appCrashedTitle('Pour Timer')],
    crashFixWords: [crashFixWords('Error: x is undefined')],
    quotedWords: [quotedWords('  go   faster ')],
    composeHeadline: [composeHeadline(false), composeHeadline(true)],
    composePlaceholder: [composePlaceholder(false), composePlaceholder(true)],
    planHeadline: [planHeadline(false), planHeadline(true)],
    planMakeHeader: [planMakeHeader(false), planMakeHeader(true)],
    workingPlanPhrase: [workingPlanPhrase(false), workingPlanPhrase(true)],
    composerContinueLine: [composerContinueLine('A timer for my')],
    editingEyebrow: [editingEyebrow('Water Counter')],
    whimSheetVersionLine: [whimSheetVersionLine(4, NOW - 2 * DAY, NOW)],
    historyVersionCount: [historyVersionCount(1), historyVersionCount(4)],
    historyRowMeta: [historyRowMeta('v4', NOW - 3 * 60 * 60 * 1000, NOW)],
    historyQuotedPrompt: [historyQuotedPrompt('make the numbers bigger')],
    versionSwitchToast: [versionSwitchToast(3, 4), versionSwitchToast(4, 3)],
    reportRecipientLine: [reportRecipientLine(), reportRecipientLine('devbox:8787')],
    reportCodeLine: [reportCodeLine(), reportCodeLine('devbox:8787')],
    reportThanksLine: [reportThanksLine(), reportThanksLine('devbox:8787')],
    reportCodeSizeLabel: [reportCodeSizeLabel(1204)],
    timelineStageLabel: (['plan', 'generate', 'check', 'run', 'repair'] as const).map(timelineStageLabel),
    timelineDurationLabel: [timelineDurationLabel(1500), timelineDurationLabel(125_000)],
    timelineStageLine: [timelineStageLine(COPY.timelineStageGenerate, 1500), timelineStageLine(COPY.timelineStageRun, null, true)],
    timelineGrowthLine: [timelineGrowthLine(1204, 300)],
    retryLineSeconds: [retryLineSeconds(1), retryLineSeconds(30)],
    retryLineMinutes: [retryLineMinutes(1), retryLineMinutes(5)],
    retryLineHoursFallback: [retryLineHoursFallback(1), retryLineHoursFallback(3)],
    retryLineElapsed: [retryLineElapsed()],
    retryLineSameDay: [retryLineSameDay('14:30')],
    retryLineTomorrow: [retryLineTomorrow('09:00')],
  };
}

/** The functions `copy.ts` exports that compose no shell line of their own, each with the reason. */
const NOT_COMPOSED: Readonly<Record<string, string>> = {
  formatCount: 'a number, no words',
  formatClockTime: 'a clock time, no words',
  firstRunSentText: 'legal copy: joins first-run keys whose words are versioned with consent',
  consentWhatsNewText: 'legal copy: a what’s-new line, versioned with consent',
  legalLanguageName: 'a language’s own name',
};

export async function runProductVerbsTests(h: Harness): Promise<void> {
  await h.test('product-verbs: launcher copy carries no mechanism/git vocabulary', async () => {
    const strings: string[] = [
      ...Object.values(COPY),
      ...Object.values(LEGAL_COPY.fr),
      ...Object.values(CONSENT_WHATS_NEW).flatMap((lines) => Object.values(lines).map((line) => line.text)),
      ...Object.values(composedLines()).flat(),
      tileColor('Water Counter'),
    ];
    for (const str of strings) {
      for (const bad of FORBIDDEN) {
        h.ok(!bad.test(str), `"${str}" must not contain mechanism term ${bad}`);
      }
    }
  });

  await h.test('product-verbs: every line copy.ts composes uses the glossary, and a composed control has no Whim "I"', async () => {
    const composed = Object.entries(composedLines());
    const lines = composed.flatMap(([, texts]) => texts);
    h.ok(lines.length >= 30 && lines.every((line) => line.length > 0), `the composed lines render (${lines.length})`);
    for (const [name, texts] of composed) {
      for (const line of texts) h.eq(lineFindings(name, line, COMPOSED_KINDS[name]), [], `"${line}" uses the glossary`);
    }
  });

  await h.test('product-verbs: a composed control in Whim’s "I", or a prefixed retired word in a composed line, fails naming the function', async () => {
    const placeholder = lineFindings('composePlaceholder', 'I’ll write it for you', COMPOSED_KINDS.composePlaceholder);
    h.ok(placeholder.length === 1 && placeholder[0].startsWith('composePlaceholder: Whim\'s "I" on a control'), `a composed placeholder: ${placeholder.join('; ')}`);
    const fix = lineFindings('crashFixWords', 'I’ll fix the error', COMPOSED_KINDS.crashFixWords);
    h.ok(fix.length === 1 && fix[0].startsWith('crashFixWords: Whim\'s "I"'), `the person's words with the maker's "I’ll": ${fix.join('; ')}`);
    const toast = lineFindings('versionSwitchToast', 'Regenerated version 3', COMPOSED_KINDS.versionSwitchToast);
    h.ok(toast.length === 1 && toast[0].startsWith('versionSwitchToast: retired word "generate"'), `a prefixed retired word: ${toast.join('; ')}`);
    h.eq(lineFindings('makingTitle', 'I’m making Pour Timer', COMPOSED_KINDS.makingTitle), [], 'the maker may say "I" in prose');
  });

  await h.test('product-verbs: every function copy.ts exports is sampled above, or named as composing no line', async () => {
    const sampled = composedLines();
    const unsampled = Object.entries(copyModule)
      .filter(([name, value]) => typeof value === 'function' && !(name in sampled) && !(name in NOT_COMPOSED))
      .map(([name]) => name);
    h.eq(unsampled, [], 'a new composer gets samples in composedLines, so the glossary check reads its words');
    const stale = [...Object.keys(sampled), ...Object.keys(NOT_COMPOSED)].filter(
      (name) => typeof (copyModule as Record<string, unknown>)[name] !== 'function',
    );
    h.eq(stale, [], 'every name listed is still a function copy.ts exports');
    h.eq(Object.keys(sampled).filter((name) => !(name in COMPOSED_KINDS)), [], 'every composer says who speaks in COMPOSED_KINDS');
    h.eq(Object.keys(COMPOSED_KINDS).filter((name) => !(name in sampled)), [], 'COMPOSED_KINDS names only sampled composers');
  });
}
