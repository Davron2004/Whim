/**
 * refusal-target — where a refused rewrite lands, rebuilt fresh (design D9; spec
 * `service-refusals` "A refusal of what the user wrote lands where they can change it" / "An
 * availability or limit refusal lands on the step whose action sent the request"). Pulled out of
 * `LauncherRoot.tsx`'s `rewriteRefusalTarget`, which imports react-native and so cannot be
 * exercised under the launcher's Node acceptance suite.
 *
 * `sentFrom` is the step whose OWN primary action actually fired the rewrite request — never
 * `prev.kind`, which a zero-question clarify exchange leaves reading `'clarify'` even when it was
 * compose's Continue that sent it (a clarify skip opens plan straight from the loading `clarify`
 * screen `onComposeContinue` built, not from a clarify step the user ever saw or acted on).
 * `LauncherRoot.tsx` passes the real sender through explicitly rather than reading it off `prev`.
 */
import type { ClarifyScreen, ComposeScreen, FlowNotice, PlanScreen } from './prompt-flow';
import type { ServiceRefusal } from './service-refusal';
import { refusalLanding } from './refusal-landing';
import type { RefusalSentFrom } from './refusal-landing';

export type { RefusalSentFrom };

/** Builds the landing screen fresh from the plan's OWN text/answers/editing scope — never
 *  `prev`'s — since a plan-started rewrite can itself follow either step. */
export function rewriteRefusalTarget(
  sentFrom: RefusalSentFrom,
  plan: PlanScreen,
  refusal: ServiceRefusal,
  notice: FlowNotice,
): ComposeScreen | ClarifyScreen {
  const editing = plan.editing ? { editing: plan.editing } : {};
  if (refusalLanding('rewrite', sentFrom, refusal.code) === 'clarify') {
    return { kind: 'clarify', ...editing, text: plan.text, questions: plan.questions, answers: plan.answers, loading: false, notice };
  }
  return { kind: 'compose', ...editing, text: plan.text, notice };
}
