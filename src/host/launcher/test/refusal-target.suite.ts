/**
 * refusal-target Node suite (store-launch-compliance review fix M3) — `rewriteRefusalTarget`
 * against the real `sentFrom` a compose-continue and a clarify-continue rewrite each carry, per
 * spec `service-refusals` "A refusal of what the user wrote lands where they can change it" / "An
 * availability or limit refusal lands on the step whose action sent the request".
 *
 * The regression this guards: `openPlan`'s caller must pass the step whose OWN `Continue` fired
 * the rewrite, never `prev.kind` — a zero-question clarify exchange opens plan from a loading
 * `clarify` screen the user never acted on, so a sender-landing refusal on THAT path must return
 * to compose, not to the clarify screen it was never sent from.
 */
import { Harness } from './harness';
import { rewriteRefusalTarget } from '../refusal-target';
import type { PlanScreen } from '../prompt-flow';
import type { ServiceRefusal } from '../service-refusal';

const PLAN: PlanScreen = {
  kind: 'plan',
  text: 'a dice roller',
  questions: [],
  answers: {},
  rewritten: '',
  rows: [],
  loading: false,
  edited: false,
};

const SENDER_REFUSAL: ServiceRefusal = { code: 'server_busy', hint: 'Whim is busy right now.' };
const TEXT_REFUSAL: ServiceRefusal = { code: 'content_policy', hint: 'That request cannot be built.' };
const NOTICE = { hint: SENDER_REFUSAL.hint, tone: 'neutral' as const };

export async function runRefusalTargetTests(h: Harness): Promise<void> {
  await h.test('rewriteRefusalTarget: a sender-landing refusal sent by compose lands on compose, not clarify', () => {
    const target = rewriteRefusalTarget('compose', PLAN, SENDER_REFUSAL, NOTICE);
    h.eq(target.kind, 'compose', 'compose fired this rewrite (the zero-question clarify-skip path)');
    h.eq(target.text, PLAN.text, 'carrying the plan’s own text');
    h.eq(target.notice, NOTICE);
  });

  await h.test('rewriteRefusalTarget: a sender-landing refusal sent by clarify lands back on clarify', () => {
    const target = rewriteRefusalTarget('clarify', PLAN, SENDER_REFUSAL, NOTICE);
    h.eq(target.kind, 'clarify', 'clarify’s own Continue fired this rewrite');
    if (target.kind === 'clarify') {
      h.eq(target.questions, PLAN.questions);
      h.eq(target.answers, PLAN.answers);
    }
  });

  await h.test('rewriteRefusalTarget: a text-landing refusal always lands on compose, whichever step sent it', () => {
    h.eq(rewriteRefusalTarget('compose', PLAN, TEXT_REFUSAL, NOTICE).kind, 'compose');
    h.eq(rewriteRefusalTarget('clarify', PLAN, TEXT_REFUSAL, NOTICE).kind, 'compose');
  });
}
