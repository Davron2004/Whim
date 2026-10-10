/**
 * refusal-landing Node suite (store-launch-compliance chain-4, task 4.2; fix-notice-window) —
 * `retryWindowState`'s pure disabled/enabled arithmetic and `noticeExpiredAt`'s pure D12
 * clear-at-window-end predicate. Where each refusal lands (Describe for a clarify or rewrite, Plan
 * for a generate) is driven through the rendered shell in `prompt-flow-ui.suite.tsx`.
 *
 * Covers spec `service-refusals`:
 *   - "Retry-After holds the retry action until the window passes" — the disabled/enabled split,
 *     not the copy-table line (covered in `service-refusal.suite.ts`).
 *
 * Covers design D12 ("A sender refusal clears when its window ends"): a `neutral`-tone notice
 * expires the instant its `retryAt` passes; a `danger`-tone notice, or one with no window at all,
 * never expires this way.
 */
import { Harness } from './harness';
import { noticeExpiredAt, retryWindowState } from '../refusal-landing';

export async function runRefusalLandingTests(h: Harness): Promise<void> {
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
