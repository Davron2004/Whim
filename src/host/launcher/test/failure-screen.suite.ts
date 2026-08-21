/**
 * The `3b` failure screen (obs-v1 chain-D; prompt-flow "Failure is shown honestly, never as a
 * crash", app-launcher "The mini-app container styles its failure state from tokens").
 *
 * `FailureScreen.tsx` imports `react-native`, which the launcher runner bundles rather than
 * externalizes, so it cannot be rendered here. Its decisions therefore live in `copy.ts` — an
 * RN-free module — and are exercised for real: which rows the checklist gets, which segments the
 * attempt row gets, and what the attempt label reads. Only the two properties that are genuinely
 * about the `.tsx` files (the attempt row being conditional, and both stylesheets carrying no
 * style literals) are asserted from source, the idiom `launch-failure-ui.suite.ts` established.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Harness } from './harness';
import {
  COPY,
  REPAIR_ATTEMPT_LIMIT,
  attemptSegments,
  attemptsUsedLabel,
  failureChecklistRows,
} from '../copy';
import { WEBVIEW_ERROR_MESSAGE, logWebViewError } from '../webview-error';
import { createSeam } from '../../logging';
import { CHANNELS } from '../../logging/channels';
import { REDACTED } from '../../logging/redact';

function readSource(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8');
}

const HEX = /#[0-9a-f]{3,8}\b/i;
const FONT_SIZE_LITERAL = /fontSize\s*:\s*\d/;
const RADIUS_LITERAL = /borderRadius\s*:\s*\d/;

export async function runFailureScreenTests(h: Harness): Promise<void> {
  // ── the attempt row: only what the device actually watched go past ──────────

  await h.test('attempts: two observed repairs spend two segments, and the run sits on the third', () => {
    const segments = attemptSegments(2);
    h.eq(segments.length, REPAIR_ATTEMPT_LIMIT, 'one segment per permitted attempt');
    h.eq([...segments], ['spent', 'spent', 'current'], 'the observed attempts are spent; the run was on the next one');
    h.eq([...attemptSegments(1)], ['spent', 'current', 'remaining'], 'one observed attempt leaves the rest unreached');
    h.eq([...attemptSegments(REPAIR_ATTEMPT_LIMIT)], ['spent', 'spent', 'spent'], 'an exhausted run has no current segment');
  });

  await h.test('attempts: a count is never invented — zero observed attempts spends nothing', () => {
    h.eq([...attemptSegments(0)], ['current', 'remaining', 'remaining'], 'nothing is spent for a run that never repaired');
    h.eq([...attemptSegments(-4)], [...attemptSegments(0)], 'a nonsense count cannot spend segments');
    h.eq([...attemptSegments(99)], [...attemptSegments(REPAIR_ATTEMPT_LIMIT)], 'the row never grows past the permitted attempts');
  });

  await h.test('attempts: the label names the attempts used, not the ones left', () => {
    h.eq(attemptsUsedLabel(1), 'Tried once', 'one attempt reads as words, not a numeral');
    h.eq(attemptsUsedLabel(3), 'Tried 3 times', 'more than one is counted');
    h.ok(!/left|remaining|of \d/i.test(attemptsUsedLabel(2)), 'the label never counts down');
  });

  await h.test('attempts: the row is rendered only when the caller reports observed attempts', () => {
    const src = readSource('src/host/launcher/FailureScreen.tsx');
    h.ok(/observedRepairAttempts\?: number/.test(src), 'the observed count is an optional prop');
    h.ok(/observedRepairAttempts \?\? 0/.test(src), 'an absent count means zero, never a default of one');
    h.ok(/\{attempts > 0 && \(/.test(src), 'the whole attempt row is behind a positive-count guard');
    h.eq(
      (src.match(/attemptSegments\(/g) ?? []).length,
      1,
      'the segments are computed in exactly one place — the guarded row',
    );
  });

  // ── the checklist: hints and copy strings, nothing else ────────────────────

  await h.test('checklist: reassurance, then one row per hint, then the advisory line', () => {
    const rows = failureChecklistRows({
      diagnostics: [{ hint: 'The sound change is the part that fails' }],
      hasWorkingVersion: true,
    });
    h.eq(rows.map(r => r.kind), ['done', 'bad', 'wait'], 'the design’s three row kinds, in order');
    h.eq(rows[0].text, COPY.failureRowLastVersionWorks, 'the reassurance row is the copy string');
    h.eq(rows[1].text, 'The sound change is the part that fails', 'the failed row is the diagnostic’s own hint');
    h.eq(rows[2].text, COPY.failureRowSayItDifferently, 'the advisory row is the copy string');
  });

  await h.test('checklist: every hint gets its own bad row, and none is prefixed with a bullet', () => {
    const rows = failureChecklistRows({
      diagnostics: [{ hint: 'first thing' }, { hint: 'second thing' }],
      hasWorkingVersion: false,
    });
    h.eq(rows.filter(r => r.kind === 'bad').map(r => r.text), ['first thing', 'second thing'], 'one bad row per hint');
    for (const row of rows) h.ok(!/^[•\-*]/.test(row.text), `"${row.text}" carries no bullet character`);
  });

  await h.test('checklist: the reassurance row is omitted when there is no working version to keep', () => {
    const rows = failureChecklistRows({ diagnostics: [{ hint: 'it broke' }], hasWorkingVersion: false });
    h.eq(rows.map(r => r.kind), ['bad', 'wait'], 'nothing claims a working version exists');
    h.ok(
      !rows.some(r => r.text === COPY.failureRowLastVersionWorks),
      'the reassurance copy is absent, not merely restyled',
    );
    h.ok(
      failureChecklistRows({ diagnostics: [], hasWorkingVersion: true }).some(r => r.kind === 'done'),
      'and it IS present when there is one (the omission is non-vacuous)',
    );
  });

  await h.test('checklist: no row can carry a diagnostic’s kind, symbol or message', () => {
    const diagnostic = { hint: 'Describing the sound differently helps', kind: 'sdk-misuse', symbol: 'useAudio', message: 'TS2554: expected 1 argument' };
    const rows = failureChecklistRows({ diagnostics: [diagnostic], hasWorkingVersion: true });
    const allowed = new Set<string>([...Object.values(COPY), diagnostic.hint]);
    for (const row of rows) {
      h.ok(allowed.has(row.text), `"${row.text}" is a hint or a copy.ts string`);
      for (const leak of [diagnostic.kind, diagnostic.symbol, diagnostic.message]) {
        h.ok(!row.text.includes(leak), `"${row.text}" must not carry the diagnostic’s ${leak}`);
      }
    }
    h.ok(!allowed.has('sdk-misuse'), 'the leak fixtures are genuinely outside the allowed set');
  });

  // ── both surfaces: tokens only ─────────────────────────────────────────────

  await h.test('tokens: the failure screen and the mini-app container carry no style literals', () => {
    for (const file of ['src/host/launcher/FailureScreen.tsx', 'src/host/launcher/MiniAppView.tsx']) {
      const src = readSource(file);
      h.ok(!HEX.test(src), `${file}: no hex colour literal`);
      h.ok(!FONT_SIZE_LITERAL.test(src), `${file}: no numeric font-size literal — faces come from TYPE_SCALE`);
      h.ok(!RADIUS_LITERAL.test(src), `${file}: no numeric radius literal — radii come from RADIUS`);
      h.ok(/TYPE_SCALE/.test(src) && /SPACING/.test(src) && /RADIUS/.test(src), `${file}: the v2 tokens are what it styles from`);
      h.ok(/shellPalette\(theme\)/.test(src), `${file}: colours come from shellPalette, not a second palette`);
    }
    // Non-vacuity: the three scans do fire on the shapes they are meant to catch.
    h.ok(HEX.test('color: #fef2f2'), 'the hex scan matches a hex colour');
    h.ok(FONT_SIZE_LITERAL.test('{ fontSize: 18 }'), 'the font-size scan matches a numeric size');
    h.ok(RADIUS_LITERAL.test('{ borderRadius: 12 }'), 'the radius scan matches a numeric radius');
  });

  await h.test('container: the WebView error reaches the seam with its diagnostic code intact', () => {
    const seam = createSeam({ console: false });
    logWebViewError(
      seam,
      { code: -6, description: 'net::ERR_CONNECTION_REFUSED', domain: 'about:blank', url: 'about:blank' },
      { appId: 'tip-splitter' },
    );

    const [record] = seam.buffer.snapshot();
    h.eq(record.channel, CHANNELS.app, 'the failure is recorded on the mini-app container channel');
    h.eq(record.level, 'error', 'a load failure is an error');
    h.eq(record.message, WEBVIEW_ERROR_MESSAGE, 'the message is the constant; the payload rides as fields');
    h.eq(record.fields.errorCode, -6, 'the native code survives redaction — it is the most diagnostic field');
    h.eq(record.fields.detail, 'net::ERR_CONNECTION_REFUSED', 'the native description is a named field');
    h.eq(record.fields.domain, 'about:blank', 'the native domain is a named field');
    h.eq(record.fields.url, 'about:blank', 'the native url is a named field');
    h.eq(record.fields.appId, 'tip-splitter', 'the caller’s context rides alongside');
    h.ok(!Object.hasOwn(record.fields, 'code'), 'nothing is emitted under the sensitive name `code`');

    // Control: redaction is still on for this very record — `errorCode` survives because it is
    // outside the sensitive set, not because the seam stopped censoring.
    seam.error(CHANNELS.app, WEBVIEW_ERROR_MESSAGE, { code: -6 });
    const control = seam.buffer.snapshot()[1];
    h.eq(control.fields.code, REDACTED, 'a genuinely sensitive field name WOULD have been redacted');
  });

  await h.test('container: both WebView surfaces route onError through the seam, never console', () => {
    for (const file of ['src/host/launcher/MiniAppView.tsx', 'src/host/launcher/DevProbeScreen.tsx']) {
      const src = readSource(file);
      h.ok(!/console\.\w+\(/.test(src), `${file}: no console call survives`);
      h.ok(/onError=\{\(ev\) => logWebViewError\(log, ev\.nativeEvent,/.test(src), `${file}: onError goes through the one helper`);
      h.ok(!/JSON\.stringify\(ev\.nativeEvent\)/.test(src), `${file}: the payload is structured, not stringified`);
    }
  });
}
