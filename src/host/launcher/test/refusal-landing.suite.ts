/**
 * refusal-landing Node suite (store-launch-compliance chain-4, task 4.2; fix-notice-window) —
 * `refusalLanding` against every `ServiceRefusalCode` across the four request/sender shapes the
 * flow can actually produce, `retryWindowState`'s pure disabled/enabled arithmetic, and
 * `noticeExpiredAt`'s pure D12 clear-at-window-end predicate.
 *
 * Covers spec `service-refusals`:
 *   - "A refusal of what the user wrote lands where they can change it" — `content_policy`/
 *     `payload_too_large` always return to compose (or plan for a plan-started generate).
 *   - "An availability or limit refusal lands on the step whose action sent the request" — the
 *     other five codes return to `sentFrom`, except a generate request, always plan-started.
 *   - "Retry-After holds the retry action until the window passes" — the disabled/enabled split,
 *     not the copy-table line (covered in `service-refusal.suite.ts`).
 *
 * Covers design D12 ("A sender refusal clears when its window ends"): a `neutral`-tone notice
 * expires the instant its `retryAt` passes; a `danger`-tone notice, or one with no window at all,
 * never expires this way.
 */
import { Harness } from './harness';
import { noticeExpiredAt, refusalLanding, retryWindowState } from '../refusal-landing';
import { ServiceRefusalCode } from '@whim/contract';

// Expectations come from the service-refusals spec, independently of the production table.
const TEXT_LANDING_CODES = ['content_policy', 'payload_too_large'] as const;
const SENDER_LANDING_CODES = [
  'policy_unavailable',
  'budget_exhausted',
  'daily_limit',
  'device_busy',
  'server_busy',
  'update_required',
  'consent_required',
] as const;

export async function runRefusalLandingTests(h: Harness): Promise<void> {
  await h.test('refusalLanding: a text-landing code always returns to compose for clarify or rewrite', () => {
    for (const code of TEXT_LANDING_CODES) {
      h.eq(refusalLanding('clarify', 'compose', code), 'compose', `clarify-from-compose, ${code}`);
      h.eq(refusalLanding('rewrite', 'compose', code), 'compose', `rewrite-from-compose, ${code}`);
      h.eq(refusalLanding('rewrite', 'clarify', code), 'compose', `rewrite-from-clarify, ${code}`);
    }
  });

  await h.test('refusalLanding: a sender-landing code returns to whichever step sent the request', () => {
    for (const code of SENDER_LANDING_CODES) {
      h.eq(refusalLanding('clarify', 'compose', code), 'compose', `clarify-from-compose, ${code}`);
      h.eq(refusalLanding('rewrite', 'compose', code), 'compose', `rewrite-from-compose, ${code}`);
      h.eq(refusalLanding('rewrite', 'clarify', code), 'clarify', `rewrite-from-clarify, ${code}`);
    }
  });

  await h.test('refusalLanding: a generate request always lands on plan, whichever way the code lands', () => {
    for (const code of ServiceRefusalCode.options) {
      h.eq(refusalLanding('generate', 'plan', code), 'plan', `generate-from-plan, ${code}`);
    }
  });

  await h.test('refusalLanding: expected landings cover every contract code exactly once', () => {
    h.eq(
      [...TEXT_LANDING_CODES, ...SENDER_LANDING_CODES].sort((left, right) => left.localeCompare(right)),
      [...ServiceRefusalCode.options].sort((left, right) => left.localeCompare(right)),
      'the independent expected groups contain every code, with no duplicates or extras',
    );
  });

  await h.test('retryWindowState: disabled with the remaining milliseconds, while retryAt is still ahead', () => {
    h.eq(retryWindowState(1_000_500, 1_000_000), { disabled: true, msUntilEnable: 500 }, 'still open');
  });

  await h.test('retryWindowState: enabled the instant retryAt has passed', () => {
    h.eq(retryWindowState(1_000_000, 1_000_000), { disabled: false, msUntilEnable: 0 }, 'exactly at the boundary reads enabled');
    h.eq(retryWindowState(999_999, 1_000_000), { disabled: false, msUntilEnable: 0 }, 'already past reads enabled');
  });

  await h.test('retryWindowState: enabled with nothing to wait for when the refusal carried no window', () => {
    h.eq(retryWindowState(undefined, 1_000_000), { disabled: false, msUntilEnable: 0 }, 'no Retry-After means no gate at all');
  });

  // `noticeExpiredAt` (design D12: "A sender refusal clears when its window ends") — `ServiceNotice.tsx`'s
  // `useNoticeWindowClear` is a thin live-timer wrapper around this pure predicate.
  await h.test('noticeExpiredAt: a sender (neutral-tone) notice expires once its window ends', () => {
    h.eq(noticeExpiredAt({ tone: 'neutral', retryAt: 1_000_000 }, 999_999), false, 'still inside the window');
    h.eq(noticeExpiredAt({ tone: 'neutral', retryAt: 1_000_000 }, 1_000_000), true, 'exactly at the boundary has ended');
    h.eq(noticeExpiredAt({ tone: 'neutral', retryAt: 1_000_000 }, 1_000_001), true, 'already past the boundary has ended');
  });

  await h.test('noticeExpiredAt: a text (danger-tone) notice never expires by window, whatever the clock reads', () => {
    h.eq(noticeExpiredAt({ tone: 'danger', retryAt: 1_000_000 }, 1_000_001), false, 'a text-landing notice only clears on edit');
  });

  await h.test('noticeExpiredAt: a notice with no window at all never expires, and neither does no notice', () => {
    h.eq(noticeExpiredAt({ tone: 'neutral' }, 1_000_000), false, 'no retryAt means nothing to end');
    h.eq(noticeExpiredAt(undefined, 1_000_000), false, 'no notice means nothing to end');
  });
}
