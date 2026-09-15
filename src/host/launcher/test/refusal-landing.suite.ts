/**
 * refusal-landing Node suite (store-launch-compliance chain-4, task 4.2) — `refusalLanding`
 * against every `ServiceRefusalCode` across the four request/sender shapes the flow can actually
 * produce, and `retryWindowState`'s pure disabled/enabled arithmetic.
 *
 * Covers spec `service-refusals`:
 *   - "A refusal of what the user wrote lands where they can change it" — `content_policy`/
 *     `payload_too_large` always return to compose (or plan for a plan-started generate).
 *   - "An availability or limit refusal lands on the step whose action sent the request" — the
 *     other five codes return to `sentFrom`, except a generate request, always plan-started.
 *   - "Retry-After holds the retry action until the window passes" — the disabled/enabled split,
 *     not the copy-table line (covered in `service-refusal.suite.ts`).
 */
import { Harness } from './harness';
import { REFUSAL_RULES } from '../service-refusal';
import { refusalLanding, retryWindowState } from '../refusal-landing';
import { ServiceRefusalCode } from '../contract-mirror';

const TEXT_LANDING_CODES = ServiceRefusalCode.options.filter((code) => REFUSAL_RULES[code].landing === 'text');
const SENDER_LANDING_CODES = ServiceRefusalCode.options.filter((code) => REFUSAL_RULES[code].landing === 'sender');

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

  await h.test('refusalLanding: the table has both landings represented, so this suite is not vacuous', () => {
    h.ok(TEXT_LANDING_CODES.length > 0, 'at least one text-landing code exists');
    h.ok(SENDER_LANDING_CODES.length > 0, 'at least one sender-landing code exists');
    h.eq(TEXT_LANDING_CODES.length + SENDER_LANDING_CODES.length, ServiceRefusalCode.options.length, 'every code is exactly one or the other');
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
}
