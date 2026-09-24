/**
 * service-refusal Node suite (store-launch-compliance chain-2, task 2.2) — `serviceRefusalOf`,
 * `retryAtOf` and `retryLine` against `GenerationClientError` fixtures, no real HTTP.
 *
 * Covers spec `service-refusals`:
 *   - "A refusal is recognised by the contract's closed refusal vocabulary" — all seven codes
 *     recognised, an out-of-vocabulary identifier and a hint-less body are not refusals, and the
 *     table's keys are checked against the real `ServiceRefusalCode.options`.
 *   - "Retry-After holds the retry action until the window passes" — the line-format thresholds
 *     only (seconds, minutes, same local day, tomorrow), per this chain's declared read scope.
 */
import { Harness } from './harness';
import { refusalText, retryAtOf, retryLine, serviceRefusalOf } from '../service-refusal';
import { GenerationClientError } from '../transport-shared';
import { ServiceRefusalCode } from '@whim/contract';

const HINT = 'Whim is busy right now. Try again in a bit.';

function httpError(code: string, opts: { hint?: string; status?: number; retryAfterSeconds?: number } = {}): GenerationClientError {
  return new GenerationClientError('http', {
    status: opts.status ?? 429,
    hint: opts.hint === undefined ? HINT : opts.hint,
    code,
    retryAfterSeconds: opts.retryAfterSeconds,
  });
}

export async function runServiceRefusalTests(h: Harness): Promise<void> {

  await h.test('every contract code is recognised as a refusal carrying that code and hint', () => {
    for (const code of ServiceRefusalCode.options) {
      const refusal = serviceRefusalOf(httpError(code));
      h.ok(refusal !== undefined, `${code} is recognised`);
      if (refusal) {
        h.eq(refusal.code, code, 'the code round-trips');
        h.eq(refusal.hint, HINT, 'the hint round-trips');
      }
    }
  });

  // request-envelope: the two refusals about the phone itself speak in the phone's own words; every
  // other code keeps showing the server's hint exactly as it arrived.
  await h.test('refusalText: the server’s hint verbatim, except the two refusals about the phone itself', () => {
    const aboutThePhone = new Set(['update_required', 'consent_required']);
    for (const code of ServiceRefusalCode.options) {
      const refusal = serviceRefusalOf(httpError(code));
      if (!refusal) continue;
      const text = refusalText(refusal);
      if (aboutThePhone.has(code)) {
        h.ok(text !== HINT && text.length > 0, `${code}: the phone’s own words, not the server’s hint`);
      } else {
        h.eq(text, HINT, `${code}: the server’s hint, byte for byte`);
      }
    }
  });

  await h.test('an identifier outside the vocabulary is not a refusal', () => {
    const refusal = serviceRefusalOf(httpError('rate_limited'));
    h.eq(refusal, undefined, 'rate_limited takes the existing failure handling, not a refusal one');
  });

  await h.test('a body without a hint is not a refusal', () => {
    const refusal = serviceRefusalOf(httpError('content_policy', { hint: '' }));
    h.eq(refusal, undefined, 'an empty hint means no refusal, even with a vocabulary code');
  });

  await h.test('a non-http-kind error, and a plain Error, are never refusals', () => {
    h.eq(serviceRefusalOf(new GenerationClientError('network', { hint: 'offline' })), undefined, 'network kind is never a refusal');
    h.eq(serviceRefusalOf(new Error('boom')), undefined, 'a non-GenerationClientError value is never a refusal');
  });

  await h.test('retryAtOf derives the re-enable moment from receivedAt + seconds, or is absent without a window', () => {
    const receivedAt = 1_000_000;
    const withWindow = serviceRefusalOf(httpError('daily_limit', { retryAfterSeconds: 5400 }));
    const withoutWindow = serviceRefusalOf(httpError('device_busy'));
    h.ok(withWindow !== undefined && withoutWindow !== undefined, 'both fixtures are recognised refusals');
    if (withWindow) {
      h.eq(retryAtOf(withWindow, receivedAt), receivedAt + 5400 * 1000, 'retryAt is receivedAt plus the window in ms');
    }
    if (withoutWindow) {
      h.eq(retryAtOf(withoutWindow, receivedAt), undefined, 'no Retry-After means no retryAt');
    }
  });

  const fixedTime = (date: Date) => `${date.getUTCHours()}:00`;
  // Formats by absolute instant rather than a wall-clock field, so these two checks stay correct
  // under any machine timezone: `retryLine`'s same-day/tomorrow branch reads LOCAL date fields
  // (design D11 — "the same local day"), and only the branch choice, not a specific hour string,
  // is what these two checks pin.
  const markTime = (date: Date) => `TIME(${date.getTime()})`;

  await h.test('retryLine: under a minute reads in seconds', () => {
    const now = Date.parse('2026-09-14T10:00:00Z');
    h.eq(retryLine(now + 45_000, now, fixedTime), 'in about 45 seconds', 'seconds bucket');
  });

  await h.test('retryLine: under an hour reads in minutes', () => {
    const now = Date.parse('2026-09-14T10:00:00Z');
    h.eq(retryLine(now + 90_000, now, fixedTime), 'in about 2 minutes', 'rounds to the nearest minute');
    h.eq(retryLine(now + 30 * 60_000, now, fixedTime), 'in about 30 minutes', 'minutes bucket');
  });

  await h.test('retryLine: later the same local day reads "after <time>"', () => {
    // Local-constructed (not `Date.parse(...Z)`) so "same local day" holds under any timezone.
    const now = new Date(2026, 8, 14, 10, 0, 0).getTime();
    const retryAt = now + 90 * 60_000;
    h.eq(retryLine(retryAt, now, markTime), `after ${markTime(new Date(retryAt))}`, 'same-day bucket uses the injected formatter');
  });

  await h.test('retryLine: beyond the same local day reads "tomorrow after <time>"', () => {
    // 23:00 local plus three hours always crosses local midnight, regardless of timezone.
    const now = new Date(2026, 8, 14, 23, 0, 0).getTime();
    const retryAt = now + 3 * 60 * 60_000;
    h.eq(
      retryLine(retryAt, now, markTime),
      `tomorrow after ${markTime(new Date(retryAt))}`,
      'crossing local midnight',
    );
  });

  await h.test('retryLine: singular seconds/minutes read grammatically, plural stays plural', () => {
    const now = Date.parse('2026-09-14T10:00:00Z');
    h.eq(retryLine(now + 1_000, now, fixedTime), 'in about 1 second', 'one second, not "1 seconds"');
    h.eq(retryLine(now + 2_000, now, fixedTime), 'in about 2 seconds', 'plural seconds unaffected');
    h.eq(retryLine(now + 60_000, now, fixedTime), 'in about 1 minute', 'one minute, not "1 minutes"');
    h.eq(retryLine(now + 2 * 60_000, now, fixedTime), 'in about 2 minutes', 'plural minutes unaffected');
  });

  await h.test('retryLine: a window that has already ended reads "shortly", never a stale or negative bucket', () => {
    const now = Date.parse('2026-09-14T10:00:00Z');
    h.eq(retryLine(now, now, fixedTime), 'shortly', 'retryAt exactly now is elapsed');
    h.eq(retryLine(now - 90_000, now, fixedTime), 'shortly', 'retryAt in the past is elapsed');
  });

  await h.test('retryLine: falls back to hours when Intl is missing', () => {
    const now = Date.parse('2026-09-14T10:00:00Z');
    const globals = globalThis as unknown as { Intl?: unknown };
    const realIntl = globals.Intl;
    globals.Intl = undefined;
    try {
      h.eq(retryLine(now + 90 * 60_000, now, fixedTime), 'in about 2 hours', 'no Intl means the hours fallback, not a formatted time');
      h.eq(retryLine(now + 61 * 60_000, now, fixedTime), 'in about 1 hour', 'one hour, not "1 hours"');
    } finally {
      globals.Intl = realIntl;
    }
  });
}
