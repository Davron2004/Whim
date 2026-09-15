/**
 * report-payload Node suite (store-launch-compliance chain-2, task 2.5) — `buildReportRequest`,
 * `reportPreview`, and `reportLogFields` against `ReportDraft` fixtures.
 *
 * Covers spec `content-reporting`:
 *   - "The report sheet collects a reason and an optional note" — the note's 1000-character and
 *     the app name's 200-character bounds.
 *   - "The sheet previews exactly the body that Send transmits" — preview rows equal the built
 *     request's own fields; a switched-off or absent prompt/source is omitted from both.
 *   - "Report content never reaches device logs" — `reportLogFields` carries no note, prompt,
 *     source, or app name text.
 *
 * `reportDraftFor` (task 5.6, store-launch-compliance chain-5), which needs a real `StoreAccess`,
 * is exercised at the bottom of this file, over a real MemoryFs-backed store — the same harness
 * idiom `store-access.suite.ts` uses.
 */
import { Harness } from './harness';
import { buildReportRequest, reportDraftFor, reportLogFields, reportPreview } from '../report-payload';
import type { ReportDraft } from '../report-payload';
import { ReportRequest as ReportRequestSchema } from '@whim/contract';
import { createMemoryStore, MapKVBackend } from '../../version-store';
import { AppIndex } from '../app-index';
import { StoreAccess } from '../store-access';
import type { AppRecord } from '../../bridge/contract';

const FULL_DRAFT: ReportDraft = {
  reason: 'offensive',
  note: '  This app said something upsetting.  ',
  appName: 'Habit Tracker',
  prompt: 'a habit tracker that nags me nicely',
  promptIncluded: true,
  source: 'export default function App() {}',
  sourceIncluded: true,
};

export async function runReportPayloadTests(h: Harness): Promise<void> {
  await h.test('buildReportRequest: no reason means no request', () => {
    h.eq(buildReportRequest({ ...FULL_DRAFT, reason: null }), null, 'a draft with no chosen reason builds nothing');
  });

  await h.test('buildReportRequest: a full draft builds a request that parses with the real (mirrored) ReportRequest', () => {
    const request = buildReportRequest(FULL_DRAFT);
    h.ok(request !== null, 'a chosen reason builds a request');
    if (request) {
      const parsed = ReportRequestSchema.safeParse(request);
      h.ok(parsed.success, `the built request validates against the contract schema: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`);
      h.eq(request.note, 'This app said something upsetting.', 'the note is trimmed');
    }
  });

  await h.test('buildReportRequest: an empty (or whitespace-only) note is trimmed away entirely', () => {
    const request = buildReportRequest({ ...FULL_DRAFT, note: '   ' });
    h.ok(request !== null, 'still builds — the reason is chosen');
    h.ok(request !== null && !('note' in request), 'a whitespace-only note is omitted, not sent as an empty string');
  });

  await h.test('buildReportRequest: the note is cut to 1000 characters', () => {
    const long = 'x'.repeat(1500);
    const request = buildReportRequest({ ...FULL_DRAFT, note: long });
    h.ok(request !== null, 'builds');
    if (request) {
      h.eq(request.note?.length, 1000, 'the note is cut at exactly 1000 characters');
      const parsed = ReportRequestSchema.safeParse(request);
      h.ok(parsed.success, 'the cut note still validates against the mirrored 1000-character bound');
    }
  });

  await h.test('buildReportRequest: the app name is cut to 200 characters', () => {
    const long = 'y'.repeat(300);
    const request = buildReportRequest({ ...FULL_DRAFT, appName: long });
    h.ok(request !== null, 'builds');
    if (request) {
      h.eq(request.appName.length, 200, 'the app name is cut at exactly 200 characters');
      const parsed = ReportRequestSchema.safeParse(request);
      h.ok(parsed.success, 'the cut app name still validates against the mirrored 200-character bound');
    }
  });

  await h.test('buildReportRequest: a switched-off prompt or source is omitted from the request', () => {
    const request = buildReportRequest({ ...FULL_DRAFT, promptIncluded: false, sourceIncluded: false });
    h.ok(request !== null, 'builds');
    h.ok(request !== null && !('prompt' in request), 'prompt is dropped when its switch is off');
    h.ok(request !== null && !('source' in request), 'source is dropped when its switch is off');
  });

  await h.test('buildReportRequest: an absent prompt or source is omitted even with the switch on', () => {
    const request = buildReportRequest({ ...FULL_DRAFT, prompt: undefined, source: undefined });
    h.ok(request !== null, 'builds');
    h.ok(request !== null && !('prompt' in request), 'no prompt to include means no prompt key');
    h.ok(request !== null && !('source' in request), 'no source to include means no source key (a legacy app with no stored source)');
  });

  await h.test('reportPreview: rows carry exactly the same values as the request they were built from', () => {
    const request = buildReportRequest(FULL_DRAFT);
    h.ok(request !== null, 'builds');
    if (request) {
      const rows = reportPreview(request);
      const byField = Object.fromEntries(rows.map(r => [r.field, r.value]));
      h.eq(byField.reason, request.reason, 'the reason row matches the request');
      h.eq(byField.note, request.note, 'the note row matches the request');
      h.eq(byField.appName, request.appName, 'the appName row matches the request');
      h.eq(byField.prompt, request.prompt, 'the prompt row matches the request');
      h.eq(byField.source, request.source, 'the source row matches the request');
    }
  });

  await h.test('reportPreview: an omitted field produces no row, matching the omitted request key', () => {
    const request = buildReportRequest({ ...FULL_DRAFT, promptIncluded: false, sourceIncluded: false, note: '' });
    h.ok(request !== null, 'builds');
    if (request) {
      const fields = reportPreview(request).map(r => r.field);
      h.eq(fields, ['reason', 'appName'], 'only the fields the request actually carries get a row');
    }
  });

  await h.test('reportLogFields: carries only the reason, byte sizes, and outcome — never note, prompt, source, or app name text', () => {
    const request = buildReportRequest(FULL_DRAFT);
    h.ok(request !== null, 'builds');
    if (request) {
      const fields = reportLogFields(request, '202');
      h.eq(
        Object.keys(fields).sort((a, b) => a.localeCompare(b)),
        ['outcome', 'promptBytes', 'reason', 'sourceBytes'],
        'only these named fields exist',
      );
      h.eq(fields.reason, 'offensive', 'the reason is carried');
      h.eq(fields.outcome, '202', 'the caller-supplied outcome is carried');
      h.eq(fields.promptBytes, new TextEncoder().encode(request.prompt ?? '').length, 'promptBytes is the UTF-8 byte size, not the text');
      h.eq(fields.sourceBytes, new TextEncoder().encode(request.source ?? '').length, 'sourceBytes is the UTF-8 byte size, not the text');
      const serialized = JSON.stringify(fields);
      h.ok(!serialized.includes(request.note ?? ' never'), 'the note text is nowhere in the log fields');
      h.ok(!serialized.includes(request.prompt ?? ' never'), 'the prompt text is nowhere in the log fields');
      h.ok(!serialized.includes(request.source ?? ' never'), 'the source text is nowhere in the log fields');
      h.ok(!serialized.includes(request.appName), 'the app name text is nowhere in the log fields');
    }
  });

  await h.test('reportLogFields: omits promptBytes/sourceBytes when the request carries neither field', () => {
    const request = buildReportRequest({ ...FULL_DRAFT, promptIncluded: false, sourceIncluded: false });
    h.ok(request !== null, 'builds');
    if (request) {
      const fields = reportLogFields(request, 'content_policy');
      h.eq(
        Object.keys(fields).sort((a, b) => a.localeCompare(b)),
        ['outcome', 'reason'],
        'no byte-size field is invented for content that was never sent',
      );
    }
  });

  // ── reportDraftFor (task 5.6, store-launch-compliance chain-5) ─────────────
  const REC = (id: string): AppRecord => ({ appId: id, name: id, manifest: { capabilities: [] } });

  function harnessAccess() {
    let t = 1_700_000_000_000;
    const store = createMemoryStore({ autoCompact: false, now: () => (t += 1000) });
    const index = new AppIndex(new MapKVBackend());
    const access = new StoreAccess({ store, index, deleteStorage: () => {}, now: () => (t += 1000) });
    return { access };
  }

  await h.test('reportDraftFor: an app with stored source starts with both switches on and both fields present', async () => {
    const { access } = harnessAccess();
    const entry = await access.install({
      id: 'habit-tracker',
      name: 'Habit Tracker',
      record: REC('habit-tracker'),
      bundleSource: 'BUNDLE_V1',
      source: 'export default function App() {}',
      prompt: 'a habit tracker that nags me nicely',
    });
    const draft = await reportDraftFor(entry, access);
    h.eq(draft.reason, null, 'no reason is pre-chosen');
    h.eq(draft.note, '', 'the note starts empty');
    h.eq(draft.appName, 'Habit Tracker', "appName is the entry's own display name");
    h.eq(draft.prompt, 'a habit tracker that nags me nicely', 'prompt reads the active description');
    h.eq(draft.source, 'export default function App() {}', 'source reads the active source.ts artifact');
    h.ok(draft.promptIncluded, 'promptIncluded starts true');
    h.ok(draft.sourceIncluded, 'sourceIncluded starts true');
  });

  await h.test('reportDraftFor: a legacy app with no stored source has no source field at all', async () => {
    const { access } = harnessAccess();
    const entry = await access.install({
      id: 'legacy-app',
      name: 'Legacy App',
      record: REC('legacy-app'),
      bundleSource: 'BUNDLE_V1',
      prompt: 'an app from before source tracking',
    });
    const draft = await reportDraftFor(entry, access);
    h.eq(draft.source, undefined, 'no source.ts was ever written, so the draft carries none');
    h.ok(draft.sourceIncluded, 'the switch still starts true — buildReportRequest is what omits an absent field');
    const request = buildReportRequest({ ...draft, reason: 'broken' });
    h.ok(request !== null && !('source' in request), 'an absent source never reaches the built request, reason chosen or not');
  });
}
